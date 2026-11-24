import { startTestDatabase, type TestDatabase } from '@olt/db/testing';
import { MOCK_SNMP_V3 } from '@olt/shared';
import { credentialAad, sealEnvelope } from '@olt/shared/crypto';
import { type RunningMock, startTestMock } from 'mock-olt/testing';
import { generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CredentialDecryptor } from '../src/crypto/credential.decryptor.js';
import { MemoryEventPublisher } from '../src/events/publisher.js';
import { TargetGuard } from '../src/guards/target.guard.js';
import { POLL_YIELDED, type PollerDeps, PollYieldedError } from '../src/poller/context.js';
import { pollOptical } from '../src/poller/optical.js';
import { pollStatus } from '../src/poller/status.js';
import { runPoll } from '../src/runner/olt-runner.js';
import type { SnmpLogEntry } from '../src/snmp/olt-snmp.client.js';

let db: TestDatabase;
let mock: RunningMock;
let deps: PollerDeps;
let publisher: MemoryEventPublisher;
let oltId: number;

const keys = generateKeyPairSync('rsa', { modulusLength: 3072, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });

beforeAll(async () => {
  db = await startTestDatabase();
  const t = await startTestMock();
  mock = t.mock;
  publisher = new MemoryEventPublisher();
  deps = {
    prisma: db.prisma,
    decryptor: CredentialDecryptor.fromPem(keys.privateKey),
    guard: new TargetGuard(['127.0.0.1/32'], ['127.0.0.1/32']),
    publisher,
    now: () => new Date(),
    snmpPort: () => t.config.MOCK_SNMP_PORT,
    snmpTimeoutMs: 500,
  };
}, 180_000);
afterAll(async () => {
  await mock?.stop();
  await db?.stop();
});

beforeEach(async () => {
  mock.runner.run('reset');
  await db.prisma.olt.deleteMany();
  const olt = await db.prisma.olt.create({
    data: {
      name: 'mock-1',
      mgmtIp: '127.0.0.1',
      isMock: true,
      oidProfile: 'zte-c320-v2.1',
      snmpVersion: 'v3',
      snmpCredEnc: new Uint8Array(sealEnvelope(keys.publicKey, Buffer.from(JSON.stringify(MOCK_SNMP_V3)), credentialAad('mock-1', 'snmp'))),
      status: 'ok',
      identities: { create: { kind: 'snmp_engine_id', value: mock.identity.engineId, status: 'pinned' } },
    },
  });
  oltId = olt.id;
  publisher.events.length = 0;
});

const stateEvents = () => db.prisma.onuEvent.count({ where: { kind: 'state_change', onu: { oltId } } });

describe('poll.status', () => {
  it('first cycle fills onu_state for every ONU (no events yet)', async () => {
    expect(await pollStatus(deps, oltId)).toEqual({ ok: true, changes: 0 });
    expect(await db.prisma.onuState.count({ where: { onu: { oltId } } })).toBe(mock.olt.onus.length);
    expect(await db.prisma.onu.count({ where: { oltId } })).toBe(mock.olt.onus.length);
    expect(await stateEvents()).toBe(0);
    const run = await db.prisma.pollRun.findFirstOrThrow({ where: { oltId, kind: 'status' } });
    expect(run.ok).toBe(true);
  });

  it('onu-los -> exactly 1 event, next cycle 0', async () => {
    await pollStatus(deps, oltId);
    mock.runner.run('onu-los');
    expect(await pollStatus(deps, oltId)).toEqual({ ok: true, changes: 1 });
    expect(await pollStatus(deps, oltId)).toEqual({ ok: true, changes: 0 });
    const events = await db.prisma.onuEvent.findMany({ where: { kind: 'state_change', onu: { oltId } } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ fromState: 'working', toState: 'los', observedAfterGap: false });
    expect(publisher.events.filter((e) => e.type === 'onu.state')).toHaveLength(1);
  });

  it('olt-down for 2 cycles -> stale then unreachable; ONU states kept; recovery marks observed_after_gap', async () => {
    await pollStatus(deps, oltId);
    mock.runner.run('olt-down');
    expect(await pollStatus(deps, oltId)).toMatchObject({ ok: false, error: 'SnmpTimeoutError', oltStatus: 'stale' });
    expect(await pollStatus(deps, oltId)).toMatchObject({ ok: false, oltStatus: 'unreachable' });
    expect((await db.prisma.olt.findUniqueOrThrow({ where: { id: oltId } })).status).toBe('unreachable');
    expect(await db.prisma.onuState.count({ where: { onu: { oltId }, phaseState: 'working' } })).toBe(mock.olt.onus.filter((o) => o.phase === 'working').length);

    mock.runner.run('olt-up');
    mock.runner.run('onu-los');
    await new Promise((r) => setTimeout(r, 50));
    expect(await pollStatus(deps, oltId)).toEqual({ ok: true, changes: 1 });
    expect((await db.prisma.olt.findUniqueOrThrow({ where: { id: oltId } })).status).toBe('ok');
    expect(await db.prisma.onuEvent.findFirstOrThrow({ where: { kind: 'state_change', onu: { oltId } } })).toMatchObject({ observedAfterGap: true });
    expect(publisher.events.filter((e) => e.type === 'olt.status').map((e) => (e as { to: string }).to)).toEqual(['stale', 'unreachable', 'ok']);
  }, 20_000);

  it('an interrupted walk -> poll_run.ok=false and no state change', async () => {
    await pollStatus(deps, oltId);
    mock.runner.run('los-mass');
    mock.olt.faults.dropAfterRequests = 2; // identity GET + one GETBULK, then silence
    const before = await db.prisma.onuState.findMany({ where: { onu: { oltId } }, orderBy: { onuId: 'asc' } });
    expect(await pollStatus(deps, oltId)).toMatchObject({ ok: false, error: 'SnmpTimeoutError' });
    const after = await db.prisma.onuState.findMany({ where: { onu: { oltId } }, orderBy: { onuId: 'asc' } });
    expect(after).toEqual(before);
    expect(await stateEvents()).toBe(0);
    const last = await db.prisma.pollRun.findFirstOrThrow({ where: { oltId, kind: 'status' }, orderBy: { id: 'desc' } });
    expect(last.ok).toBe(false);
  }, 20_000);

  it('identity mismatch reads nothing and records the failure', async () => {
    await pollStatus(deps, oltId);
    mock.runner.run('engineid-change');
    await new Promise((r) => setTimeout(r, 50));
    expect(await pollStatus(deps, oltId)).toMatchObject({ ok: false, error: 'IdentityMismatchError' });
  });
});

describe('inventory rules (SPEC §7)', () => {
  const target = () => mock.olt.onus.find((o) => o.slot === 2 && o.port === 5 && o.onuId === 5)!;

  it('name change -> old row archived, new row created', async () => {
    await pollStatus(deps, oltId);
    const old = await db.prisma.onu.findFirstOrThrow({ where: { oltId, sn: target().sn } });
    target().name = 'Pelanggan-Baru';
    mock.olt.changed();
    await pollOptical(deps, oltId);
    expect((await db.prisma.onu.findUniqueOrThrow({ where: { id: old.id } })).archivedAt).not.toBeNull();
    const fresh = await db.prisma.onu.findFirstOrThrow({ where: { oltId, archivedAt: null, onuIndex: 5, name: 'Pelanggan-Baru' } });
    expect(fresh.id).not.toBe(old.id);
    expect(await db.prisma.onuEvent.count({ where: { onuId: old.id, kind: 'archived' } })).toBe(1);
  });

  it('SN change with the same name -> same row, device_replaced', async () => {
    await pollStatus(deps, oltId);
    const row = await db.prisma.onu.findFirstOrThrow({ where: { oltId, sn: target().sn } });
    target().sn = 'ZTEGABCDEF01';
    mock.olt.changed();
    await pollOptical(deps, oltId);
    expect(await db.prisma.onu.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ sn: 'ZTEGABCDEF01', archivedAt: null });
    expect(await db.prisma.onuEvent.count({ where: { onuId: row.id, kind: 'device_replaced' } })).toBe(1);
  });

  it('one SN at two positions (as on golden olt-a) -> two active rows, cycle ok', async () => {
    const other = mock.olt.onus.find((o) => o !== target())!;
    other.sn = target().sn;
    mock.olt.changed();
    expect(await pollStatus(deps, oltId)).toMatchObject({ ok: true });
    expect(await db.prisma.onu.count({ where: { oltId, sn: target().sn, archivedAt: null, removedAt: null } })).toBe(2);
    expect(await db.prisma.onu.count({ where: { oltId, archivedAt: null, removedAt: null } })).toBe(mock.olt.onus.length);
  });
});

describe('poll.optical', () => {
  it('writes one onu_metric row per ONU with Rx within 0.01 dB of the mock', async () => {
    await pollStatus(deps, oltId);
    expect(await pollOptical(deps, oltId)).toMatchObject({ ok: true, changes: mock.olt.onus.length });
    const metrics = await db.prisma.onuMetric.findMany({ where: { onu: { oltId } }, include: { onu: true } });
    expect(metrics).toHaveLength(mock.olt.onus.length);
    for (const m of metrics) {
      const o = mock.olt.onus.find((x) => x.sn === m.onu.sn)!;
      if (o.phase === 'working') {
        expect(Math.abs(Number(m.rxDbm) - o.rxOnuDbm)).toBeLessThanOrEqual(0.01);
        expect(Math.abs(Number(m.oltRxDbm) - o.rxOltDbm)).toBeLessThanOrEqual(0.01);
      } else {
        expect(m.rxDbm).toBeNull();
      }
    }
    expect(await db.prisma.onuState.count({ where: { onu: { oltId }, rxDbm: { not: null } } })).toBe(mock.olt.onus.filter((o) => o.phase === 'working').length);
  });

  it('ONUs first seen by poll.optical get that Rx in onu_state with their first status cycle', async () => {
    // A new OLT whose first successful cycle is optical: it creates the ONUs, but there is no
    // onu_state row yet for its Rx (seen on a real OLT whose later optical cycles all timed out).
    expect(await pollOptical(deps, oltId)).toMatchObject({ ok: true, changes: mock.olt.onus.length });
    expect(await db.prisma.onuState.count({ where: { onu: { oltId } } })).toBe(0);
    // The OLT's Rx moves on before the status cycle: the new row carries the measured value.
    const moved = mock.olt.onus.find((o) => o.phase === 'working')!;
    const measured = moved.rxOnuDbm;
    mock.olt.setRx(moved, measured + 2);
    expect(await pollStatus(deps, oltId)).toMatchObject({ ok: true });
    const dec = (v: { toString(): string } | null) => v?.toString() ?? null;
    const states = await db.prisma.onuState.findMany({ where: { onu: { oltId } }, include: { onu: { include: { metrics: true } } } });
    expect(states).toHaveLength(mock.olt.onus.length);
    for (const s of states) {
      expect(s.onu.metrics).toHaveLength(1);
      expect([dec(s.rxDbm), dec(s.oltRxDbm)]).toEqual([dec(s.onu.metrics[0]!.rxDbm), dec(s.onu.metrics[0]!.oltRxDbm)]);
    }
    expect(states.filter((s) => s.rxDbm !== null)).toHaveLength(mock.olt.onus.filter((o) => o.phase === 'working').length);
    const movedState = () => db.prisma.onuState.findFirstOrThrow({ where: { onu: { oltId, onuIndex: moved.onuId, ponPort: { slot: moved.slot, port: moved.port } } } });
    expect(Number((await movedState()).rxDbm)).toBeCloseTo(measured, 2);
    // Later optical cycles write their own Rx as before; the seed is only for new rows.
    await pollOptical(deps, oltId);
    expect(Number((await movedState()).rxDbm)).toBeCloseTo(measured + 2, 2);
  });
});

describe('SNMP operation log', () => {
  const logged = () => {
    const entries: SnmpLogEntry[] = [];
    return { d: { ...deps, snmpLog: (e: SnmpLogEntry) => void entries.push(e) }, entries };
  };

  it('an optical cycle that times out logs the column that got no answer', async () => {
    const { d, entries } = logged();
    await pollStatus(d, oltId);
    mock.olt.faults.dropAfterRequests = 1; // the identity GET, then silence (as on OLT pugar, 2026-11-20)
    expect(await pollOptical(d, oltId)).toMatchObject({ ok: false, error: 'SnmpTimeoutError' });
    expect(entries.filter((e) => e.error)).toEqual([
      { olt: 'mock-1', op: 'optical', ms: expect.any(Number), error: 'SnmpTimeoutError', walks: [{ column: 'rxOnu', ms: expect.any(Number), error: 'SnmpTimeoutError' }] },
    ]);
  }, 20_000);

  it('a cycle that gave way is not logged as a failure', async () => {
    const { d, entries } = logged();
    await pollStatus(d, oltId);
    let calls = 0;
    const checkpoint = async () => {
      if (++calls === 3) throw new PollYieldedError();
    };
    expect(await pollOptical(d, oltId, { checkpoint })).toMatchObject({ ok: false, error: POLL_YIELDED });
    expect(entries.filter((e) => e.error)).toEqual([]);
  });
});

describe('giving way to on-demand jobs (SPEC §6.4)', () => {
  const states = () => db.prisma.onuState.findMany({ where: { onu: { oltId } }, orderBy: { onuId: 'asc' } });
  const lastRun = (kind: 'status' | 'optical') => db.prisma.pollRun.findFirstOrThrow({ where: { oltId, kind }, orderBy: { id: 'desc' } });
  /** A checkpoint that gives way on its n-th call. */
  const giveWayAt = (n: number) => {
    let calls = 0;
    return async () => {
      if (++calls === n) throw new PollYieldedError();
    };
  };

  it('checkpoints sit before each column walk: 3 per status cycle, 6 per optical cycle', async () => {
    await pollStatus(deps, oltId);
    let calls = 0;
    const checkpoint = async () => void calls++;
    expect(await pollStatus(deps, oltId, { checkpoint })).toMatchObject({ ok: true });
    expect(calls).toBe(3);
    calls = 0;
    expect(await pollOptical(deps, oltId, { checkpoint })).toMatchObject({ ok: true });
    expect(calls).toBe(6);
  });

  it('a status cycle abandoned between columns writes nothing and leaves the OLT status alone', async () => {
    await pollStatus(deps, oltId);
    mock.runner.run('onu-los');
    const before = await states();
    expect(await pollStatus(deps, oltId, { checkpoint: giveWayAt(2) })).toEqual({ ok: false, error: POLL_YIELDED, oltStatus: 'ok' });
    expect(await states()).toEqual(before);
    expect(await stateEvents()).toBe(0);
    expect(await lastRun('status')).toMatchObject({ ok: false, error: POLL_YIELDED });
    expect((await db.prisma.olt.findUniqueOrThrow({ where: { id: oltId } })).status).toBe('ok');
    // The rerun sees the change like any cycle.
    expect(await pollStatus(deps, oltId)).toEqual({ ok: true, changes: 1 });
  });

  it('an optical cycle abandoned between columns writes no metric', async () => {
    await pollStatus(deps, oltId);
    expect(await pollOptical(deps, oltId, { checkpoint: giveWayAt(3) })).toEqual({ ok: false, error: POLL_YIELDED, oltStatus: 'ok' });
    expect(await db.prisma.onuMetric.count({ where: { onu: { oltId } } })).toBe(0);
    expect(await lastRun('optical')).toMatchObject({ ok: false, error: POLL_YIELDED });
  });

  it('runPoll: a waiting on-demand job makes a scheduled poll give way once; its rerun runs to the end', async () => {
    await pollStatus(deps, oltId);
    const requeued: string[] = [];
    const queues = { hasUrgentJob: async () => true, requeuePoll: async (_oltId: number, name: string) => void requeued.push(name) };
    expect(await runPoll(deps, queues, oltId, 'poll.status', { oltId })).toMatchObject({ ok: false, error: POLL_YIELDED });
    expect(await runPoll(deps, queues, oltId, 'poll.optical', { oltId })).toMatchObject({ ok: false, error: POLL_YIELDED });
    expect(requeued).toEqual(['poll.status', 'poll.optical']);
    // However many clicks keep waiting, the reruns do not give way again.
    expect(await runPoll(deps, queues, oltId, 'poll.status', { oltId, rerun: true })).toMatchObject({ ok: true });
    expect(await runPoll(deps, queues, oltId, 'poll.optical', { oltId, rerun: true })).toMatchObject({ ok: true });
    expect(requeued).toHaveLength(2);
  });

  it('runPoll: nothing waiting, or Redis failing during the check -> the poll runs as before', async () => {
    const requeued: string[] = [];
    const requeuePoll = async (_oltId: number, name: string) => void requeued.push(name);
    expect(await runPoll(deps, { hasUrgentJob: async () => false, requeuePoll }, oltId, 'poll.status')).toMatchObject({ ok: true });
    expect(await runPoll(deps, { hasUrgentJob: () => Promise.reject(new Error('connection lost')), requeuePoll }, oltId, 'poll.optical')).toMatchObject({ ok: true });
    expect(requeued).toEqual([]);
  });
});
