import type { AllowedCommand } from '@olt/olt-spec';
import { UnrecoverableError } from 'bullmq';
import { quarantineOlt } from '../../identity/quarantine.js';
import { CliAuthError, CliError, CliNegotiationError, CliUnavailableError, HostKeyMismatchError } from '../errors.js';
import { OltCliSession, type OltCliSessionOptions } from '../olt-cli.session.js';
import { cliSessionOptions } from '../ssh-algorithms.js';
import type { CliDeps } from './onu-detail.js';

/** A job-level outcome thrown by the work function, e.g. output that does not parse. */
export class ReadJobFailure extends Error {
  constructor(
    readonly error: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(error);
    this.name = 'ReadJobFailure';
  }
}

/**
 * Runs a read-only CLI job (cli.list-sync, cli.uncfg-scan): checks the OLT, opens a read session
 * (identity checked in the handshake), lets `work` run its `show` commands, and records the
 * outcome on the job row. One attempt: every exit path is final.
 */
export async function runReadJob(
  deps: CliDeps,
  jobId: number,
  oltId: number,
  work: (run: (cmd: AllowedCommand) => Promise<string>) => Promise<Record<string, unknown>>,
): Promise<void> {
  const { prisma } = deps;
  const olt = await prisma.olt.findUniqueOrThrow({ where: { id: oltId }, include: { identities: { where: { kind: 'ssh_hostkey', status: 'pinned' } } } });
  const fail = async (status: 'failed' | 'blocked', error: string, extra: Record<string, unknown> = {}): Promise<never> => {
    await prisma.job.update({ where: { id: jobId }, data: { status, result: { error, ...extra } as object } });
    throw new UnrecoverableError(error);
  };

  if (!olt.cliEnabled || !olt.cliCredEnc) return fail('failed', 'cli_disabled');
  if (olt.status === 'quarantined' || olt.status === 'pending_pin' || olt.status === 'disabled') return fail('blocked', `olt_${olt.status}`);
  if (olt.identities.length === 0) return fail('blocked', 'host_key_not_pinned');
  let options: OltCliSessionOptions;
  try {
    options = cliSessionOptions(deps.cliOptions, olt.sshAlgorithms);
  } catch {
    return fail('failed', 'ssh_algorithms_invalid');
  }

  await prisma.job.update({ where: { id: jobId }, data: { status: 'running' } });
  const credential = deps.decryptor.cli(olt.name, olt.cliCredEnc);
  const session = new OltCliSession(
    { name: olt.name, ip: olt.mgmtIp, port: deps.sshPort?.(oltId) ?? 22, credential, hostKeyPins: olt.identities.map((i) => i.value) },
    deps.guard,
    options,
  );
  try {
    await session.open('read');
    const result = await work((cmd) => session.run(cmd));
    await prisma.job.update({ where: { id: jobId }, data: { status: 'succeeded', result: result as object } });
  } catch (error) {
    if (error instanceof UnrecoverableError) throw error;
    if (error instanceof ReadJobFailure) return await fail('failed', error.error, error.extra);
    if (error instanceof HostKeyMismatchError) {
      await quarantineOlt(deps, oltId, { kind: 'ssh_hostkey', expected: olt.identities.map((i) => i.value).join(','), observed: error.observed });
      return await fail('blocked', 'host_key_mismatch');
    }
    if (error instanceof CliAuthError) {
      await prisma.securityEvent.create({ data: { oltId, kind: 'cli_auth_failed', severity: 'warning', detail: { jobId } } });
      return await fail('failed', 'cli_auth_failed');
    }
    if (error instanceof CliNegotiationError) return await fail('failed', 'ssh_negotiation_failed', { detail: error.detail });
    // Reason, last screen text and SSH trace, as for cli.onu-detail (SPEC §8.3): enough to tell e.g. a prompt the session does not know.
    if (error instanceof CliUnavailableError)
      return await fail('failed', 'cli_unavailable', { reason: error.reason, ...(error.screen ? { screen: error.screen } : {}), ...(error.trace?.length ? { trace: error.trace } : {}) });
    if (error instanceof CliError) return await fail('failed', 'command_failed', { message: error.line });
    return await fail('failed', (error as Error).name);
  } finally {
    await session.close();
  }
}
