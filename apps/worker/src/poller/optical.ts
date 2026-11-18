import { quarantineOlt } from '../identity/quarantine.js';
import { IdentityMismatchError, withVerifiedIdentity } from '../identity/snmp-identity.js';
import { openOlt, POLLED, type PollerDeps, type PollOptions } from './context.js';
import { posKey, syncInventory } from './inventory.js';
import type { PollOutcome } from './status.js';

/**
 * poll.optical (SPEC §6.3): inventory + ONU-side and OLT-side Rx, one onu_metric row per ONU.
 * Timeouts here never change the OLT status; that is the status cycle's job. `opts.checkpoint`
 * may abandon the cycle between column walks (PollYieldedError); nothing is written then.
 */
export async function pollOptical(deps: PollerDeps, oltId: number, opts: PollOptions = {}): Promise<PollOutcome> {
  const { prisma } = deps;
  const { olt, pin, client } = await openOlt(deps, oltId);
  if (!POLLED.has(olt.status)) {
    client.close();
    return { ok: false, error: `olt status ${olt.status} is not polled`, oltStatus: olt.status };
  }
  const run = await prisma.pollRun.create({ data: { oltId, kind: 'optical', startedAt: deps.now() } });
  try {
    const rows = await withVerifiedIdentity(olt.name, client, pin, () => client.onuOptical(opts));
    const ids = await syncInventory(deps, oltId, rows);
    const ts = deps.now();
    const data = rows.flatMap((r) => {
      const onuId = ids.get(posKey(r.slot, r.port, r.onuId));
      return onuId === undefined ? [] : [{ onuId, ts, rxDbm: r.rxOnuDbm, oltRxDbm: r.rxOltDbm }];
    });
    await prisma.$transaction(async (tx) => {
      await tx.onuMetric.createMany({ data });
      for (const m of data) {
        await tx.onuState.updateMany({ where: { onuId: m.onuId }, data: { rxDbm: m.rxDbm, oltRxDbm: m.oltRxDbm } });
      }
      await tx.pollRun.update({ where: { id: run.id }, data: { finishedAt: ts, ok: true } });
    });
    return { ok: true, changes: data.length };
  } catch (error) {
    await prisma.pollRun.update({ where: { id: run.id }, data: { finishedAt: deps.now(), ok: false, error: (error as Error).name } });
    if (error instanceof IdentityMismatchError && error.kind !== 'missing_pin') {
      await quarantineOlt(deps, oltId, { kind: error.kind as 'snmp_engine_id' | 'snmp_sysinfo', expected: error.expected, observed: error.observed });
      return { ok: false, error: (error as Error).name, oltStatus: 'quarantined' };
    }
    return { ok: false, error: (error as Error).name, oltStatus: olt.status };
  } finally {
    client.close();
  }
}
