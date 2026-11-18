import type { PollerDeps } from '../poller/context.js';

export interface Mismatch {
  kind: 'ssh_hostkey' | 'snmp_engine_id' | 'snmp_sysinfo' | 'snmp_auth';
  expected: string;
  /** The value now presented by the device; empty for repeated auth failures. */
  observed: string;
}

export interface QuarantineDeps extends Pick<PollerDeps, 'prisma' | 'now'> {
  uiBaseUrl?: string;
  /** Stops schedulers and drops queued jobs of the OLT (runner). */
  onOltStatusChanged?: (oltId: number) => Promise<void>;
}

/**
 * CLAUDE.md rule 7 / SPEC §8.4 step 4: identity changed -> stop. The OLT becomes quarantined
 * (no SNMP, no CLI until an admin accepts the change), the observed value is kept as a
 * candidate for that decision, and a security event, an alarm and a Telegram message follow.
 */
export async function quarantineOlt(deps: QuarantineDeps, oltId: number, m: Mismatch): Promise<boolean> {
  const { prisma } = deps;
  const now = deps.now();
  const changed = await prisma.$transaction(async (tx) => {
    const olt = await tx.olt.findUniqueOrThrow({ where: { id: oltId } });
    if (olt.status === 'quarantined') return false;
    await tx.olt.update({ where: { id: oltId }, data: { status: 'quarantined' } });
    if (m.observed && m.kind !== 'snmp_auth') {
      await tx.oltIdentity.deleteMany({ where: { oltId, kind: m.kind, status: 'candidate' } });
      await tx.oltIdentity.create({ data: { oltId, kind: m.kind, value: m.observed, status: 'candidate', reason: 'observed at mismatch' } });
    }
    await tx.securityEvent.create({
      data: { oltId, kind: m.kind === 'snmp_auth' ? 'snmp_auth_failure' : 'identity_mismatch', severity: 'critical', detail: { kind: m.kind, expected: m.expected, observed: m.observed } },
    });
    const alarm = await tx.alarm.create({ data: { oltId, key: 'olt_identity_mismatch', kind: 'olt_identity_mismatch', severity: 'critical', firstAt: now, lastAt: now, detail: { kind: m.kind } } });
    const what = m.kind === 'ssh_hostkey' ? 'host key SSH' : m.kind === 'snmp_auth' ? 'autentikasi SNMPv3 (gagal 2 siklus)' : m.kind === 'snmp_engine_id' ? 'engine ID SNMPv3' : 'sysName/sysObjectID';
    const link = deps.uiBaseUrl ? `\n${deps.uiBaseUrl.replace(/\/$/, '')}/olts/${oltId}` : '';
    await tx.notification.createMany({
      data: [{ dedupeKey: `alarm:${alarm.id}:start`, payload: { text: `🚨 KEAMANAN: identitas OLT ${olt.name} berubah (${what}). OLT dikarantina: polling dan CLI dihentikan sampai admin menerima perubahan.${link}`, oltId, alarmId: alarm.id, phase: 'start' } }],
      skipDuplicates: true,
    });
    return true;
  });
  if (changed) await deps.onOltStatusChanged?.(oltId);
  return changed;
}

/** SnmpAuthError on 2 consecutive status cycles counts as an identity mismatch (SPEC §2.2 no. 11). */
export async function authFailuresInARow(deps: Pick<PollerDeps, 'prisma'>, oltId: number): Promise<number> {
  const runs = await deps.prisma.pollRun.findMany({ where: { oltId, kind: 'status', finishedAt: { not: null } }, orderBy: { id: 'desc' }, take: 5 });
  let n = 0;
  for (const r of runs) {
    if (r.error !== 'SnmpAuthError') break;
    n++;
  }
  return n;
}
