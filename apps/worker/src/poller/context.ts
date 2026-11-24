import { OID_PROFILES, type OidProfileId } from '@olt/olt-spec';
import type { PrismaClient } from '@olt/db';
import type { CredentialDecryptor } from '../crypto/credential.decryptor.js';
import type { EventPublisher } from '../events/publisher.js';
import type { TargetGuard } from '../guards/target.guard.js';
import type { SnmpPin } from '../identity/snmp-identity.js';
import { OltSnmpClient, type OltSnmpClientOptions, type SnmpLogEntry } from '../snmp/olt-snmp.client.js';

export interface PollerDeps {
  prisma: PrismaClient;
  decryptor: CredentialDecryptor;
  guard: TargetGuard;
  publisher: EventPublisher;
  now: () => Date;
  /** SNMP port per OLT; 161 everywhere except in-process tests. */
  snmpPort?: (oltId: number) => number;
  snmpTimeoutMs?: number;
  /** Receives the SNMP operations that failed or were slow (snmpLogWorthy), with their column walk times. */
  snmpLog?: (entry: SnmpLogEntry) => void;
  /** For links in messages (quarantine notifications). */
  uiBaseUrl?: string;
  /** Called after the worker itself changed an OLT's status (quarantine): schedulers follow. */
  onOltStatusChanged?: (oltId: number) => Promise<void>;
}

export const POLLED = new Set(['ok', 'stale', 'unreachable']);

/** poll_run.error and PollOutcome.error of a cycle that gave way to an on-demand job. */
export const POLL_YIELDED = 'PollYieldedError';

/**
 * Thrown by a poll's checkpoint while an on-demand job waits for the OLT's queue (SPEC §6.4).
 * The cycle is abandoned like a failed one, so nothing is written; it is not a timeout, so the
 * OLT status, the alarms and the quarantine counters ignore it.
 */
export class PollYieldedError extends Error {
  constructor() {
    super('poll gave way to a waiting on-demand job');
    this.name = POLL_YIELDED;
  }
}

export interface PollOptions {
  /** Awaited before each SNMP column walk, after the identity check; may throw PollYieldedError. */
  checkpoint?: () => Promise<void>;
}

/** A successful SNMP operation this slow is still logged, so slow columns show before they time out. */
export const SLOW_SNMP_MS = 1000;

/**
 * Which SNMP operations get a log line: failed and slow ones. A cycle that gave way to an
 * on-demand job is not a failure (the runner logs it already); fast operations stay silent.
 */
export function snmpLogWorthy(entry: SnmpLogEntry): boolean {
  if (entry.error === POLL_YIELDED) return false;
  return entry.error !== undefined || entry.ms >= SLOW_SNMP_MS;
}

/** Loads an OLT, its pinned SNMP identity, and opens a guarded SNMP client. */
export async function openOlt(deps: PollerDeps, oltId: number) {
  const olt = await deps.prisma.olt.findUniqueOrThrow({
    where: { id: oltId },
    include: { identities: { where: { status: 'pinned', kind: { in: ['snmp_engine_id', 'snmp_sysinfo'] } } } },
  });
  const pinRow = olt.identities[0];
  const pin: SnmpPin | undefined = pinRow ? { kind: pinRow.kind as SnmpPin['kind'], value: pinRow.value } : undefined;
  const profile = OID_PROFILES[olt.oidProfile as OidProfileId];
  if (!profile) throw new Error(`unknown OID profile ${olt.oidProfile}`);
  const { snmpLog } = deps;
  const options: OltSnmpClientOptions = {
    ...(deps.snmpTimeoutMs ? { timeoutMs: deps.snmpTimeoutMs } : {}),
    ...(snmpLog
      ? {
          log: (entry: SnmpLogEntry) => {
            if (snmpLogWorthy(entry)) snmpLog(entry);
          },
        }
      : {}),
  };
  const client = new OltSnmpClient(
    { name: olt.name, ip: olt.mgmtIp, port: deps.snmpPort?.(olt.id) ?? 161, profile, credential: deps.decryptor.snmp(olt.name, olt.snmpCredEnc) },
    deps.guard,
    options,
  );
  return { olt, pin, client };
}
