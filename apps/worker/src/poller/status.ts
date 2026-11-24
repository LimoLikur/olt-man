import type { Prisma } from '@olt/db';
import { authFailuresInARow, quarantineOlt } from '../identity/quarantine.js';
import { IdentityMismatchError, withVerifiedIdentity } from '../identity/snmp-identity.js';
import { SnmpAuthError, SnmpTimeoutError } from '../snmp/errors.js';
import { openOlt, POLLED, type PollerDeps, type PollOptions } from './context.js';
import { activeOnuIds, posKey, syncInventory } from './inventory.js';

export type PollOutcome = { ok: true; changes: number } | { ok: false; error: string; oltStatus: string };

/**
 * poll.status (SPEC §8.1): identity first, then the complete status table. A failed or partial
 * cycle changes no ONU state; timeouts move the OLT ok -> stale -> unreachable. ONU events are
 * written only on change, timestamped with the worker's observation time. A cycle abandoned by
 * `opts.checkpoint` (PollYieldedError) is a failed cycle that leaves the OLT status as it is.
 */
export async function pollStatus(deps: PollerDeps, oltId: number, opts: PollOptions = {}): Promise<PollOutcome> {
  const { prisma } = deps;
  const startedAt = deps.now();
  const { olt, pin, client } = await openOlt(deps, oltId);
  if (!POLLED.has(olt.status)) {
    client.close();
    return { ok: false, error: `olt status ${olt.status} is not polled`, oltStatus: olt.status };
  }
  const run = await prisma.pollRun.create({ data: { oltId, kind: 'status', startedAt } });

  try {
    const rows = await withVerifiedIdentity(olt.name, client, pin, () => client.onuStatus(opts));
    let ids = await activeOnuIds(deps, oltId);
    if (rows.some((r) => !ids.has(posKey(r.slot, r.port, r.onuId)))) {
      // New positions: read inventory (same walk as poll.optical) before writing states.
      ids = await syncInventory(deps, oltId, await client.onuOptical(opts));
    }

    const ts = deps.now();
    const afterGap = olt.status !== 'ok';
    const previous = new Map((await prisma.onuState.findMany({ where: { onuId: { in: [...ids.values()] } } })).map((s) => [s.onuId, s]));
    const firstRx = await latestRx(deps, [...ids.values()].filter((id) => !previous.has(id)));
    const changes: { onuId: number; from: string | null; to: string }[] = [];

    await prisma.$transaction(async (tx) => {
      for (const r of rows) {
        const onuId = ids.get(posKey(r.slot, r.port, r.onuId));
        if (onuId === undefined) continue;
        const prev = previous.get(onuId);
        const changed = prev !== undefined && prev.phaseState !== r.phase;
        const state = { phaseState: r.phase, adminState: r.adminEnabled ? 'enable' : 'disable', omccState: r.omccEnabled ? 'enable' : 'disable', updatedAt: ts };
        await tx.onuState.upsert({
          where: { onuId },
          create: { onuId, ...state, lastChangeAt: ts, ...firstRx.get(onuId) },
          update: { ...state, ...(changed ? { lastChangeAt: ts } : {}) },
        });
        if (changed) {
          await tx.onuEvent.create({ data: { onuId, ts, kind: 'state_change', fromState: prev.phaseState, toState: r.phase, observedAfterGap: afterGap } });
          changes.push({ onuId, from: prev.phaseState, to: r.phase });
        }
      }
      await tx.pollRun.update({ where: { id: run.id }, data: { finishedAt: ts, ok: true } });
      await tx.olt.update({ where: { id: oltId }, data: { status: 'ok', lastPollOkAt: ts } });
    });

    for (const c of changes) await deps.publisher.publish({ type: 'onu.state', oltId, ...c, ts: ts.toISOString(), observedAfterGap: afterGap });
    if (olt.status !== 'ok') await deps.publisher.publish({ type: 'olt.status', oltId, from: olt.status, to: 'ok', ts: ts.toISOString() });
    return { ok: true, changes: changes.length };
  } catch (error) {
    const ts = deps.now();
    const name = (error as Error).name;
    await prisma.pollRun.update({ where: { id: run.id }, data: { finishedAt: ts, ok: false, error: name } });
    let oltStatus: string = olt.status;
    if (error instanceof SnmpTimeoutError) {
      // 1 failed cycle -> stale, 2 consecutive -> unreachable (SPEC §8.2).
      oltStatus = olt.status === 'ok' ? 'stale' : 'unreachable';
      if (oltStatus !== olt.status) {
        await prisma.olt.update({ where: { id: oltId }, data: { status: oltStatus as 'stale' | 'unreachable' } });
        await deps.publisher.publish({ type: 'olt.status', oltId, from: olt.status, to: oltStatus, ts: ts.toISOString() });
      }
    }
    if (error instanceof IdentityMismatchError && error.kind !== 'missing_pin') {
      await quarantineOlt(deps, oltId, { kind: error.kind as 'snmp_engine_id' | 'snmp_sysinfo', expected: error.expected, observed: error.observed });
      oltStatus = 'quarantined';
    } else if (error instanceof SnmpAuthError && (await authFailuresInARow(deps, oltId)) >= 2) {
      await quarantineOlt(deps, oltId, { kind: 'snmp_auth', expected: '', observed: '' });
      oltStatus = 'quarantined';
    }
    // ONU state stays untouched on every failure.
    return { ok: false, error: name, oltStatus };
  } finally {
    client.close();
  }
}

/**
 * Latest Rx per ONU from onu_metric, for ONUs that get their onu_state row now. An ONU first
 * seen by poll.optical (inventory) has its Rx in onu_metric only: that cycle had no state row
 * to update, and without this the Rx stays empty until the next successful optical cycle.
 */
async function latestRx(deps: PollerDeps, onuIds: number[]): Promise<Map<number, { rxDbm: Prisma.Decimal | null; oltRxDbm: Prisma.Decimal | null }>> {
  if (onuIds.length === 0) return new Map();
  const { prisma } = deps;
  const latest = await prisma.onuMetric.groupBy({ by: ['onuId'], where: { onuId: { in: onuIds } }, _max: { ts: true } });
  const at = latest.flatMap((l) => (l._max.ts ? [{ onuId: l.onuId, ts: l._max.ts }] : []));
  if (at.length === 0) return new Map();
  const rows = await prisma.onuMetric.findMany({ where: { OR: at }, select: { onuId: true, rxDbm: true, oltRxDbm: true } });
  return new Map(rows.map(({ onuId, rxDbm, oltRxDbm }) => [onuId, { rxDbm, oltRxDbm }]));
}
