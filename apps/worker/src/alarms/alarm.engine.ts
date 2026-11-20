import type { PhaseState } from '@olt/olt-spec';
import type { PollerDeps } from '../poller/context.js';
import { alarmMessage } from './messages.js';
import { type ActiveAlarm, evaluate, type OnuSnapshot, resolveAlarmSettings, type Transition } from './rules/index.js';

const RULE_KINDS = ['onu_los', 'onu_dying_gasp', 'onu_flapping', 'onu_rx_low', 'pon_mass_los', 'pon_mass_power', 'olt_unreachable'] as const;

export interface AlarmEngineDeps extends Pick<PollerDeps, 'prisma' | 'now'> {
  uiBaseUrl: string;
}

export interface EvaluationResult {
  raised: number;
  cleared: number;
  notifications: number;
}

/**
 * Turns poller output into alarms (SPEC §8.2): builds a snapshot from the database, runs the
 * pure rules, and applies the difference. Telegram goes through the outbox with one
 * dedupe_key per alarm transition, so re-running an evaluation never sends twice.
 */
export async function evaluateOlt(deps: AlarmEngineDeps, oltId: number): Promise<EvaluationResult> {
  const { prisma } = deps;
  const now = deps.now();
  const olt = await prisma.olt.findUniqueOrThrow({ where: { id: oltId } });
  const settings = resolveAlarmSettings(olt.alarmSettings);
  const since = new Date(now.getTime() - Math.max(settings.flapWindowMs, settings.massWindowMs, settings.flapQuietMs));

  const onus = await prisma.onu.findMany({
    where: { oltId, archivedAt: null, removedAt: null },
    include: { ponPort: true, state: true, events: { where: { kind: 'state_change', ts: { gte: since } }, orderBy: { ts: 'asc' } } },
  });
  const snapshots: OnuSnapshot[] = onus.map((o) => ({
    onuId: o.id,
    port: `${o.ponPort.slot}/${o.ponPort.port}`,
    phase: (o.state?.phaseState ?? 'unknown') as PhaseState,
    rxDbm: o.state?.rxDbm === null || o.state?.rxDbm === undefined ? null : Number(o.state.rxDbm),
    transitions: o.events.map((e): Transition => ({ ts: e.ts.getTime(), from: e.fromState as PhaseState, to: e.toState as PhaseState })),
  }));

  const runs = await prisma.pollRun.findMany({ where: { oltId, kind: 'status', finishedAt: { not: null } }, orderBy: { id: 'desc' }, take: 10 });
  let timeouts = 0;
  for (const r of runs) {
    if (r.ok) break;
    if (r.error === 'SnmpTimeoutError') timeouts++;
  }

  // Only the §8.2 rule kinds are managed here; cli_unavailable and olt_identity_mismatch have
  // their own lifecycle (CLI job, quarantine) and must not be cleared by a poll.
  const activeRows = await prisma.alarm.findMany({ where: { oltId, state: 'active', kind: { in: [...RULE_KINDS] } } });
  const active: ActiveAlarm[] = activeRows.map((a) => ({ key: a.key, kind: a.kind as ActiveAlarm['kind'], severity: a.severity }));
  const desired = evaluate({ now: now.getTime(), oltTimeouts: timeouts, onus: snapshots, active }, settings);

  const byKey = new Map(activeRows.map((a) => [a.key, a]));
  const onuById = new Map(onus.map((o) => [o.id, o]));
  const link = `${deps.uiBaseUrl.replace(/\/$/, '')}/olts/${oltId}`;
  let raised = 0;
  let cleared = 0;
  let notifications = 0;

  await prisma.$transaction(async (tx) => {
    const notify = async (alarmId: number, phase: 'start' | 'end', text: string) => {
      const { count } = await tx.notification.createMany({ data: [{ dedupeKey: `alarm:${alarmId}:${phase}`, payload: { text, oltId, alarmId, phase } }], skipDuplicates: true });
      notifications += count;
    };
    const message = (a: { kind: ActiveAlarm['kind']; port?: string | undefined; onuId?: number | undefined }, phase: 'start' | 'end', extra: { count?: number; stillOffline?: number } = {}) =>
      alarmMessage({
        kind: a.kind,
        phase,
        olt: olt.name,
        ...(a.port ? { port: a.port } : {}),
        onuName: a.onuId ? (onuById.get(a.onuId)?.name ?? null) : null,
        link,
        ...extra,
      });
    const portOf = (portKey: string | undefined) => {
      if (!portKey) return undefined;
      const o = onus.find((x) => `${x.ponPort.slot}/${x.ponPort.port}` === portKey);
      return o?.ponPortId;
    };

    // 1. Create or refresh every desired alarm (parents first, so children can point at them).
    const ids = new Map<string, number>();
    const ordered = [...desired].sort((a, b) => Number(Boolean(a.parentKey)) - Number(Boolean(b.parentKey)));
    for (const d of ordered) {
      const existing = byKey.get(d.key);
      if (existing) {
        await tx.alarm.update({ where: { id: existing.id }, data: { severity: d.severity, lastAt: now } });
        ids.set(d.key, existing.id);
        continue;
      }
      const created = await tx.alarm.create({
        data: { oltId, key: d.key, kind: d.kind, severity: d.severity, ponPortId: portOf(d.port) ?? null, onuId: d.onuId ?? null, firstAt: now, lastAt: now },
      });
      ids.set(d.key, created.id);
      raised++;
      if (d.notify && !d.parentKey) {
        const count = d.port ? snapshots.filter((s) => s.port === d.port && s.phase === (d.kind === 'pon_mass_power' ? 'dying_gasp' : 'los')).length : undefined;
        await notify(created.id, 'start', message(d, 'start', count === undefined ? {} : { count }));
      }
    }
    // 2. Parent links (suppression may start or end without the alarm itself changing).
    for (const d of desired) {
      const parentId = d.parentKey ? (ids.get(d.parentKey) ?? null) : null;
      await tx.alarm.update({ where: { id: ids.get(d.key)! }, data: { parentAlarmId: parentId } });
    }
    // 3. Clear what is no longer desired. Ack never clears; recovery does (SPEC §8.2).
    const wanted = new Set(desired.map((d) => d.key));
    for (const a of activeRows) {
      if (wanted.has(a.key)) continue;
      await tx.alarm.update({ where: { id: a.id }, data: { state: 'cleared', clearedAt: now, parentAlarmId: null } });
      cleared++;
      const notifies = a.kind === 'pon_mass_los' || a.kind === 'pon_mass_power' || a.kind === 'onu_flapping' || a.kind === 'olt_unreachable';
      if (notifies && a.parentAlarmId === null) {
        const port = a.key.split(':port:')[1];
        const stillOffline = a.kind === 'olt_unreachable' ? snapshots.filter((s) => s.phase !== 'working').length : undefined;
        await notify(a.id, 'end', message({ kind: a.kind as ActiveAlarm['kind'], port, onuId: a.onuId ?? undefined }, 'end', stillOffline === undefined ? {} : { stillOffline }));
      }
    }
  });

  return { raised, cleared, notifications };
}
