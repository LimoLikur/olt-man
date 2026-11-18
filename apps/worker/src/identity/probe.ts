import { sshAlgorithmsSchema } from '@olt/shared/dto';
import type { Job } from 'bullmq';
import { sshAlgorithms } from '../cli/ssh-algorithms.js';
import { TargetNotAllowedError } from '../guards/target.guard.js';
import { openOlt, type PollerDeps } from '../poller/context.js';
import { quarantineOlt } from './quarantine.js';
import { probeSshHostKey } from './ssh-hostkey.js';
import { sysInfoValue } from './snmp-identity.js';

export interface IdentityProbeJobData {
  jobId: number;
  oltId: number;
}

export interface ProbeDeps extends PollerDeps {
  sshPort?: (oltId: number) => number;
}

type Kind = 'snmp_engine_id' | 'snmp_sysinfo' | 'ssh_hostkey';
interface Found {
  kind: Kind;
  value: string;
  algo?: string;
}

/**
 * identity.probe (SPEC §8.4 step 1): collects identity candidates for the admin to pin.
 * SNMP: engine ID from an authenticated GET (v3) or sysName/sysObjectID (v2c). SSH: host key
 * from a handshake aborted before authentication, with the OLT's legacy algorithms. Never
 * runs against a quarantined OLT.
 *
 * A kind that is already pinned (e.g. SNMP, when CLI is switched on later) yields no new
 * candidate when it matches; when it differs the OLT is quarantined, like in polling
 * (CLAUDE.md rule 7), and the probe stops.
 */
export async function processIdentityProbe(deps: ProbeDeps, job: Job<IdentityProbeJobData>): Promise<void> {
  const { prisma } = deps;
  const { jobId, oltId } = job.data;
  const status = (await prisma.olt.findUniqueOrThrow({ where: { id: oltId }, select: { status: true } })).status;
  if (status === 'quarantined' || status === 'disabled') {
    await prisma.job.update({ where: { id: jobId }, data: { status: 'blocked', result: { error: `olt_${status}` } } });
    return;
  }
  await prisma.job.update({ where: { id: jobId }, data: { status: 'running' } });
  try {
    await probe(deps, jobId, oltId);
  } catch (error) {
    // An error outside the per-step handling (target guard, credentials, database) must still end
    // the job, or it stays "running" for good. Only a running job changes: a mismatch already set
    // "blocked". The rethrow keeps the BullMQ failure and its "job failed" log line.
    await prisma.job
      .updateMany({ where: { id: jobId, status: 'running' }, data: { status: 'failed', result: { candidates: [], confirmed: [], errors: [probeFailure(error)] } } })
      .catch(() => undefined);
    throw error;
  }
}

/** Code for job.result.errors when the probe stops on an error (the UI explains known codes). */
export function probeFailure(error: unknown): string {
  if (error instanceof TargetNotAllowedError) return 'target_not_allowed';
  return `probe:${error instanceof Error ? error.name : 'unknown'}`;
}

async function probe(deps: ProbeDeps, jobId: number, oltId: number): Promise<void> {
  const { prisma } = deps;
  const pins = await prisma.oltIdentity.findMany({ where: { oltId, status: 'pinned' }, select: { kind: true, value: true } });
  const pinsOf = (kind: Kind) => pins.filter((p) => p.kind === kind).map((p) => (kind === 'snmp_engine_id' ? p.value.toLowerCase() : p.value));

  const found: Found[] = [];
  const errors: string[] = [];
  /** false = mismatch: quarantined, stop. */
  const check = async (f: Found): Promise<boolean> => {
    const pinned = pinsOf(f.kind);
    if (pinned.length === 0 || pinned.includes(f.value)) {
      found.push(f);
      return true;
    }
    await prisma.job.update({ where: { id: jobId }, data: { status: 'blocked', result: { error: 'identity_mismatch', kind: f.kind } } });
    await quarantineOlt(deps, oltId, { kind: f.kind, expected: pinned.join(','), observed: f.value });
    return false;
  };

  const { olt, client } = await openOlt(deps, oltId);
  let snmp: Found | undefined;
  try {
    const id = await client.identity();
    snmp = client.version === 'v3' ? { kind: 'snmp_engine_id', value: id.engineId! } : { kind: 'snmp_sysinfo', value: sysInfoValue(id) };
    await prisma.olt.update({ where: { id: oltId }, data: { firmware: id.sysDescr.slice(0, 128) } });
  } catch (error) {
    errors.push(`snmp:${(error as Error).name}`);
  } finally {
    client.close();
  }
  if (snmp && !(await check(snmp))) return;

  if (olt.cliEnabled) {
    const algorithms = sshAlgorithmsSchema.safeParse(olt.sshAlgorithms);
    if (!algorithms.success) {
      errors.push('ssh:invalid_algorithms');
    } else {
      const key = await probeSshHostKey(olt.mgmtIp, deps.sshPort?.(oltId) ?? 22, deps.guard, { algorithms: sshAlgorithms(algorithms.data) });
      if (!key.ok) errors.push(`ssh:${key.error}`);
      else if (!(await check({ kind: 'ssh_hostkey', value: key.fingerprint, algo: key.algo }))) return;
    }
  }

  // Values that are already pinned are confirmed, not offered again.
  const fresh = found.filter((f) => pinsOf(f.kind).length === 0);
  await prisma.$transaction(async (tx) => {
    // A new probe replaces earlier, unpinned candidates of the same kind.
    await tx.oltIdentity.deleteMany({ where: { oltId, status: 'candidate', kind: { in: found.map((f) => f.kind) } } });
    for (const f of fresh) await tx.oltIdentity.create({ data: { oltId, kind: f.kind, value: f.value, algo: f.algo ?? null, status: 'candidate', reason: 'identity.probe' } });
    await tx.job.update({
      where: { id: jobId },
      data: {
        status: found.length ? 'succeeded' : 'failed',
        result: { candidates: fresh.map((f) => ({ kind: f.kind, value: f.value })), confirmed: found.filter((f) => !fresh.includes(f)).map((f) => f.kind), errors },
      },
    });
  });
}
