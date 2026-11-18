import { JOB_STATUS_LABEL, time } from './format';

export type IdentityKind = 'ssh_hostkey' | 'snmp_engine_id' | 'snmp_sysinfo';

/** One identity value from GET /olts/:id/identity (admin and NOC only). */
export interface IdentityRow {
  id: number;
  kind: IdentityKind;
  value: string;
  algo: string | null;
  reason: string | null;
  pinnedAt: string | null;
  createdAt: string | null;
}

/** The identity.probe job: `errors` per step (failed/succeeded), `error` when blocked. */
export interface ProbeJob {
  status: string;
  result: { errors?: string[]; error?: string } | null;
  updatedAt: string | null;
}

export interface Identity {
  olt: { id: number; name: string; status: string };
  pinned: IdentityRow[];
  candidates: IdentityRow[];
  retired: IdentityRow[];
  lastProbe: ProbeJob | null;
}

export const IDENTITY_KIND_LABEL: Record<IdentityKind, string> = {
  ssh_hostkey: 'SSH host key',
  snmp_engine_id: 'SNMPv3 engine ID',
  snmp_sysinfo: 'sysName | sysObjectID (v2c)',
};

/** Worker error codes in words; other codes are shown as they are. */
const PROBE_ERRORS: Record<string, string> = {
  target_not_allowed: 'the OLT address is outside the worker’s OLT_TARGET_CIDRS',
  'snmp:SnmpTimeoutError': 'SNMP: no answer (timeout)',
  'snmp:SnmpAuthError': 'SNMP: authentication failed',
  'ssh:no_answer': 'SSH: no answer',
  identity_mismatch: 'the key differs from the pinned one',
};

/**
 * A probe takes well under a minute (the SSH key exchange on a C320 is about 16 s). One that is
 * still "running" after 5 minutes was cut off, e.g. by a worker restart, and will not finish.
 */
const PROBE_STALE_MS = 5 * 60_000;

export type ProbeState = 'none' | 'running' | 'stalled' | 'failed' | 'done';

export function probeState(lastProbe: ProbeJob | null, now = Date.now()): ProbeState {
  if (!lastProbe) return 'none';
  if (['confirmed', 'running', 'verifying'].includes(lastProbe.status)) {
    const since = lastProbe.updatedAt ? Date.parse(lastProbe.updatedAt) : now;
    return now - since > PROBE_STALE_MS ? 'stalled' : 'running';
  }
  return lastProbe.status === 'failed' || lastProbe.status === 'blocked' ? 'failed' : 'done';
}

/** "Last probe: failed (SNMP: no answer (timeout))", "No probe yet.", or why it never finished. */
export function probeText(lastProbe: ProbeJob | null, now = Date.now()): string {
  if (!lastProbe) return 'No probe yet.';
  if (probeState(lastProbe, now) === 'stalled') return `The last probe did not finish (started ${time(lastProbe.updatedAt)}). Probe again.`;
  const codes = [...(lastProbe.result?.errors ?? []), ...(lastProbe.result?.error ? [lastProbe.result.error] : [])];
  const details = codes.length ? ` (${codes.map((c) => PROBE_ERRORS[c] ?? c).join('; ')})` : '';
  return `Last probe: ${(JOB_STATUS_LABEL[lastProbe.status] ?? lastProbe.status).toLowerCase()}${details}`;
}
