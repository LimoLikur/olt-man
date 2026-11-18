import type { Prisma } from '@olt/db';
import type { OnuOpticalRow } from '../snmp/olt-snmp.client.js';
import type { PollerDeps } from './context.js';

const posKey = (slot: number, port: number, onuId: number) => `${slot}/${port}:${onuId}`;

/**
 * Applies the ONU history rules of SPEC §7. An active row is identified by (OLT, port, index):
 * same name + new SN -> same row, `device_replaced`; new name -> old row archived, new row;
 * gone from the OLT -> `removed_at`. History is never deleted.
 */
export async function syncInventory(deps: PollerDeps, oltId: number, rows: readonly OnuOpticalRow[]): Promise<Map<string, number>> {
  const { prisma, publisher } = deps;
  const ts = deps.now();
  const events: { onuId: number; kind: 'created' | 'device_replaced' | 'archived' | 'removed' }[] = [];

  const ids = await prisma.$transaction(async (tx) => {
    const ports = new Map<string, number>();
    const portId = async (slot: number, port: number) => {
      const k = `${slot}/${port}`;
      let id = ports.get(k);
      if (id === undefined) {
        id = (await tx.ponPort.upsert({ where: { oltId_slot_port: { oltId, slot, port } }, create: { oltId, slot, port }, update: {}, select: { id: true } })).id;
        ports.set(k, id);
      }
      return id;
    };

    const active = await tx.onu.findMany({ where: { oltId, archivedAt: null, removedAt: null }, include: { ponPort: true } });
    const byPos = new Map(active.map((o) => [posKey(o.ponPort.slot, o.ponPort.port, o.onuIndex), o]));
    const seen = new Set<string>();
    const result = new Map<string, number>();

    for (const r of rows) {
      const key = posKey(r.slot, r.port, r.onuId);
      seen.add(key);
      const current = byPos.get(key);
      const fields = { type: r.type, description: r.description };
      if (!r.sn) continue; // cannot track an ONU without SN
      if (current && current.name === r.name) {
        const data: Prisma.OnuUpdateInput = {};
        if (current.sn !== r.sn) {
          data.sn = r.sn;
          await tx.onuEvent.create({ data: { onuId: current.id, ts, kind: 'device_replaced', detail: { fromSn: current.sn, toSn: r.sn } } });
          events.push({ onuId: current.id, kind: 'device_replaced' });
        }
        if (current.type !== r.type || current.description !== r.description) Object.assign(data, fields);
        if (Object.keys(data).length) await tx.onu.update({ where: { id: current.id }, data });
        result.set(key, current.id);
        continue;
      }
      if (current) {
        await tx.onu.update({ where: { id: current.id }, data: { archivedAt: ts } });
        await tx.onuEvent.create({ data: { onuId: current.id, ts, kind: 'archived', detail: { reason: 'name_changed', fromName: current.name, toName: r.name } } });
        events.push({ onuId: current.id, kind: 'archived' });
      }
      const created = await tx.onu.create({ data: { oltId, ponPortId: await portId(r.slot, r.port), onuIndex: r.onuId, sn: r.sn, name: r.name, ...fields } });
      events.push({ onuId: created.id, kind: 'created' });
      result.set(key, created.id);
    }

    for (const [key, o] of byPos) {
      if (seen.has(key)) continue;
      await tx.onu.update({ where: { id: o.id }, data: { removedAt: ts } });
      await tx.onuEvent.create({ data: { onuId: o.id, ts, kind: 'removed' } });
      events.push({ onuId: o.id, kind: 'removed' });
    }
    return result;
  });

  for (const e of events) await publisher.publish({ type: 'onu.inventory', oltId, ...e, ts: ts.toISOString() });
  return ids;
}

/** Active ONU ids by position. */
export async function activeOnuIds(deps: PollerDeps, oltId: number): Promise<Map<string, number>> {
  const active = await deps.prisma.onu.findMany({ where: { oltId, archivedAt: null, removedAt: null }, include: { ponPort: true } });
  return new Map(active.map((o) => [posKey(o.ponPort.slot, o.ponPort.port, o.onuIndex), o.id]));
}

export { posKey };
