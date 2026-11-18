import { parseAttenuation, parseDetailInfo, showAttenuation, showOnuDetail } from '@olt/olt-spec';
import { ONU_DETAIL_RETRY_MS, onuDetailDedupId, onuDetailJobOptions, type OnuDetailJobData } from '@olt/shared/jobs';
import { type Job, UnrecoverableError } from 'bullmq';
import type { PollerDeps } from '../../poller/context.js';
import type { OltQueues } from '../../scheduler/olt-queues.js';
import { quarantineOlt } from '../../identity/quarantine.js';
import { CliAuthError, CliNegotiationError, CliUnavailableError, HostKeyMismatchError } from '../errors.js';
import { OltCliSession, type OltCliSessionOptions } from '../olt-cli.session.js';
import { cliSessionOptions } from '../ssh-algorithms.js';

export { ONU_DETAIL_RETRY_MS, type OnuDetailJobData } from '@olt/shared/jobs';

export interface CliDeps extends PollerDeps {
  sshPort?: (oltId: number) => number;
  cliOptions?: OltCliSessionOptions;
  retryDelaysMs?: number[];
}

/**
 * Creates the job row and queues cli.onu-detail, at most one per ONU per 30 s (BullMQ
 * deduplication). Returns null when throttled.
 */
export async function enqueueOnuDetail(deps: CliDeps, queues: OltQueues, onuId: number, requestedBy: number | null = null): Promise<number | null> {
  const onu = await deps.prisma.onu.findUniqueOrThrow({ where: { id: onuId }, select: { oltId: true } });
  const queue = await queues.queue(onu.oltId);
  if (await queue.getDeduplicationJobId(onuDetailDedupId(onuId))) return null;
  const row = await deps.prisma.job.create({ data: { oltId: onu.oltId, kind: 'onu_detail', params: { onuId }, status: 'confirmed', requestedBy } });
  const { priority: _p, ...opts } = onuDetailJobOptions(onuId, deps.retryDelaysMs ?? ONU_DETAIL_RETRY_MS);
  await queues.add(onu.oltId, 'cli.onu-detail', { jobId: row.id, oltId: onu.oltId, onuId } satisfies OnuDetailJobData, opts);
  return row.id;
}

/** Worker setting: backoff strategy for cli.onu-detail. */
export const onuDetailBackoff = (delays: number[] = ONU_DETAIL_RETRY_MS) => (attemptsMade: number) => delays[Math.min(attemptsMade, delays.length) - 1] ?? delays.at(-1)!;

/** Processor for cli.onu-detail. */
export async function processOnuDetail(deps: CliDeps, job: Job<OnuDetailJobData>): Promise<void> {
  const { prisma } = deps;
  const { jobId, oltId, onuId } = job.data;
  const olt = await prisma.olt.findUniqueOrThrow({ where: { id: oltId }, include: { identities: { where: { kind: 'ssh_hostkey', status: 'pinned' } } } });
  const onu = await prisma.onu.findUniqueOrThrow({ where: { id: onuId }, include: { ponPort: true } });
  const fail = async (status: 'failed' | 'blocked', error: string, transcript: unknown[] = [], extra: Record<string, unknown> = {}) =>
    prisma.job.update({ where: { id: jobId }, data: { status, result: { error, ...extra, transcript } as object } });

  if (!olt.cliEnabled || !olt.cliCredEnc) {
    await fail('failed', 'cli_disabled');
    throw new UnrecoverableError('CLI not enabled for this OLT');
  }
  if (olt.status === 'quarantined' || olt.status === 'pending_pin' || olt.status === 'disabled') {
    await fail('blocked', `olt_${olt.status}`);
    throw new UnrecoverableError(`OLT is ${olt.status}`);
  }
  if (olt.identities.length === 0) {
    await fail('blocked', 'host_key_not_pinned');
    throw new UnrecoverableError('no pinned host key');
  }

  let options: OltCliSessionOptions;
  try {
    options = cliSessionOptions(deps.cliOptions, olt.sshAlgorithms);
  } catch {
    await fail('failed', 'ssh_algorithms_invalid');
    throw new UnrecoverableError('invalid olt.ssh_algorithms');
  }

  await prisma.job.update({ where: { id: jobId }, data: { status: 'running' } });
  const credential = deps.decryptor.cli(olt.name, olt.cliCredEnc);
  const session = new OltCliSession(
    { name: olt.name, ip: olt.mgmtIp, port: deps.sshPort?.(oltId) ?? 22, credential, hostKeyPins: olt.identities.map((i) => i.value) },
    deps.guard,
    options,
  );
  const ref = { slot: onu.ponPort.slot, port: onu.ponPort.port, onuId: onu.onuIndex };
  try {
    await session.open('read');
    const detail = parseDetailInfo(await session.run(showOnuDetail(ref)));
    const attenuation = parseAttenuation(await session.run(showAttenuation(ref)));
    await prisma.$transaction(async (tx) => {
      await tx.job.update({ where: { id: jobId }, data: { status: 'succeeded', result: { detail, attenuation, transcript: redact(session.transcript, credential.password) } as object } });
      await tx.alarm.updateMany({ where: { oltId, kind: 'cli_unavailable', state: 'active' }, data: { state: 'cleared', clearedAt: deps.now() } });
    });
  } catch (error) {
    const transcript = redact(session.transcript, credential.password);
    if (error instanceof CliAuthError) {
      await fail('failed', 'cli_auth_failed', transcript);
      await prisma.securityEvent.create({ data: { oltId, kind: 'cli_auth_failed', severity: 'warning', detail: { jobId } } });
      throw new UnrecoverableError('cli_auth_failed');
    }
    if (error instanceof CliNegotiationError) {
      // No common algorithm: retrying cannot help; the admin adjusts the OLT's SSH algorithms.
      await prisma.job.update({ where: { id: jobId }, data: { status: 'failed', result: { error: 'ssh_negotiation_failed', detail: error.detail, transcript } as object } });
      throw new UnrecoverableError('ssh_negotiation_failed');
    }
    if (error instanceof HostKeyMismatchError) {
      // Nothing was sent (dropped inside the handshake); the OLT is quarantined.
      await fail('blocked', 'host_key_mismatch', transcript);
      await quarantineOlt(deps, oltId, { kind: 'ssh_hostkey', expected: olt.identities.map((i) => i.value).join(','), observed: error.observed });
      throw new UnrecoverableError('host_key_mismatch');
    }
    if (error instanceof CliUnavailableError) {
      const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (lastAttempt) {
        await fail('failed', 'cli_unavailable', transcript, { reason: error.reason, ...(error.screen ? { screen: error.screen } : {}), ...(error.trace?.length ? { trace: error.trace } : {}) });
        const active = await prisma.alarm.findFirst({ where: { oltId, kind: 'cli_unavailable', state: 'active' } });
        if (!active) {
          const now = deps.now();
          await prisma.alarm.create({ data: { oltId, key: 'cli_unavailable', kind: 'cli_unavailable', severity: 'info', firstAt: now, lastAt: now, detail: { jobId } } });
        }
      }
      throw error; // BullMQ retries with the onu-detail backoff (delayed job: the queue moves on)
    }
    await fail('failed', (error as Error).name, transcript);
    throw new UnrecoverableError((error as Error).name);
  } finally {
    await session.close();
  }
}

function redact(transcript: { command: string; output: string }[], secret: string) {
  return transcript.map((t) => ({ command: t.command, output: secret ? t.output.split(secret).join('[redacted]') : t.output }));
}
