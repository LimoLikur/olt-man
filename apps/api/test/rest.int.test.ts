import { MOCK_CLI, MOCK_SNMP_COMMUNITY, MOCK_SNMP_V3 } from '@olt/shared';
import { oltQueueName } from '@olt/shared/jobs';
import { Queue, Worker } from 'bullmq';
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, type Client, login, startTestApi, type TestApi, testKeys } from './helpers.js';

let t: TestApi;
let admin: Client;
let noc: Client;
let teknisi: Client;
beforeAll(async () => {
  t = await startTestApi();
  [admin, noc, teknisi] = await Promise.all([login(t, 'admin', '192.168.10.2'), login(t, 'noc', '192.168.10.3'), login(t, 'teknisi', '192.168.10.4')]);
}, 180_000);
afterAll(() => t?.stop());

const SECRET_KEY = /cred|password|community|secret/i;
const SECRETS = [MOCK_SNMP_V3.authKey, MOCK_SNMP_V3.privKey, MOCK_SNMP_COMMUNITY, MOCK_CLI.password];

function keysDeep(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keysDeep(x, out);
    }
  }
  return out;
}

const decrypt = (blob: Uint8Array, olt: string, field: 'snmp' | 'cli') =>
  new Promise<unknown>((resolve, reject) => {
    const dir = mkdtempSync(join(tmpdir(), 'key-'));
    writeFileSync(join(dir, 'k.pem'), testKeys.privateKey, { mode: 0o600 });
    const script = fileURLToPath(new URL('../../worker/test/support/decrypt.ts', import.meta.url));
    const child = execFile(process.execPath, ['--conditions=source', '--import', 'tsx', script, join(dir, 'k.pem'), olt, field], (err, stdout) => (err ? reject(err) : resolve(JSON.parse(stdout))));
    child.stdin!.end(Buffer.from(blob).toString('hex'));
  });

const mockOlt = (name: string) => ({ name, mgmtIp: '172.30.0.11', isMock: true, oidProfile: 'zte-c320-v2.1', snmp: MOCK_SNMP_V3, cli: MOCK_CLI });

describe('POST/PATCH /olts (admin)', () => {
  it('registers in pending_pin, without any credential in the response', async () => {
    const res = await call(t, admin, 'POST', '/olts', mockOlt('mock-1'));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'mock-1', status: 'pending_pin', isMock: true, identityLevel: 'unpinned', cliEnabled: true });
    for (const body of [res.body, (await call(t, noc, 'GET', '/olts')).body, (await call(t, noc, 'GET', `/olts/${(res.body as { id: number }).id}`)).body, (await call(t, noc, 'GET', '/dashboard')).body]) {
      expect(keysDeep(body).filter((k) => SECRET_KEY.test(k))).toEqual([]);
      for (const s of SECRETS) expect(JSON.stringify(body)).not.toContain(s);
    }
  });

  it('the stored ciphertext opens with the worker decryptor', async () => {
    const olt = await t.db.prisma.olt.findUniqueOrThrow({ where: { name: 'mock-1' } });
    expect(Buffer.from(olt.snmpCredEnc).includes(Buffer.from(MOCK_SNMP_V3.authKey))).toBe(false);
    expect(await decrypt(olt.snmpCredEnc, 'mock-1', 'snmp')).toEqual(MOCK_SNMP_V3);
    expect(await decrypt(olt.cliCredEnc!, 'mock-1', 'cli')).toEqual(MOCK_CLI);
  });

  it('a non-mock OLT with an unverified OID profile -> 422', async () => {
    // v2.2 has no real golden recording yet (v2.1 is verified by olt-a).
    expect((await call(t, admin, 'POST', '/olts', { ...mockOlt('olt-asli'), isMock: false, mgmtIp: '10.20.0.5', oidProfile: 'zte-c320-v2.2' })).status).toBe(422);
  });

  it('invalid input -> 400 naming fields, no values; duplicate name -> 409', async () => {
    const bad = await call(t, admin, 'POST', '/olts', { ...mockOlt('mock-x'), snmp: { ...MOCK_SNMP_V3, user: 'a b\r\n' } });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toContain(MOCK_SNMP_V3.authKey);
    expect((await call(t, admin, 'POST', '/olts', mockOlt('mock-1'))).status).toBe(409);
  });

  it('PATCH rotates credentials (audited without values) and rejects is_mock', async () => {
    const { id } = await t.db.prisma.olt.findUniqueOrThrow({ where: { name: 'mock-1' } });
    const v2 = { version: 'v2c', community: MOCK_SNMP_COMMUNITY };
    expect((await call(t, admin, 'PATCH', `/olts/${id}`, { snmp: v2 })).status).toBe(200);
    expect(await decrypt((await t.db.prisma.olt.findUniqueOrThrow({ where: { id } })).snmpCredEnc, 'mock-1', 'snmp')).toEqual(v2);
    expect((await call(t, admin, 'PATCH', `/olts/${id}`, { isMock: false })).status).toBe(400);
    const audit = await t.db.prisma.auditLog.findFirstOrThrow({ where: { action: 'olt.updated' } });
    expect(JSON.stringify(audit.detail)).not.toContain(MOCK_SNMP_COMMUNITY);
  });

  it('PATCH switches CLI on for a pinned SNMP-only OLT: credentials required, legacy algorithms allowlisted, probe queued', async () => {
    const created = await call(t, admin, 'POST', '/olts', { ...mockOlt('olt-snmp-only'), cli: undefined });
    expect(created.body).toMatchObject({ cliEnabled: false, sshAlgorithms: {} });
    const { id } = created.body as { id: number };
    // As after the laptop runbook: SNMPv3 pinned, polled.
    await t.db.prisma.oltIdentity.create({ data: { oltId: id, kind: 'snmp_engine_id', value: '80000f3e05b2b2b2b2b2b2', status: 'pinned', pinnedAt: new Date() } });
    await t.db.prisma.olt.update({ where: { id }, data: { status: 'ok' } });
    const probes = () => t.db.prisma.job.count({ where: { oltId: id, kind: 'identity_probe' } });
    const before = await probes();

    expect((await call(t, admin, 'PATCH', `/olts/${id}`, { cliEnabled: true })).status).toBe(400); // no CLI credentials yet
    expect((await call(t, admin, 'PATCH', `/olts/${id}`, { cliEnabled: true, cli: MOCK_CLI, sshAlgorithms: { cipher: ['none'] } })).status).toBe(400);
    expect((await call(t, admin, 'PATCH', `/olts/${id}`, { sshAlgorithms: { cipher: ['aes128-cbc'], compress: ['zlib'] } })).status).toBe(400);
    expect((await call(t, noc, 'PATCH', `/olts/${id}`, { cliEnabled: true, cli: MOCK_CLI })).status).toBe(403);
    expect(await probes()).toBe(before);

    const res = await call(t, admin, 'PATCH', `/olts/${id}`, { cliEnabled: true, cli: MOCK_CLI, sshAlgorithms: { cipher: ['aes128-cbc'] } });
    expect(res.status).toBe(200);
    // Host key not pinned yet: "unpinned" until the admin pins the probe's candidate.
    expect(res.body).toMatchObject({ status: 'ok', cliEnabled: true, sshAlgorithms: { cipher: ['aes128-cbc'] }, identityLevel: 'unpinned' });
    expect(await probes()).toBe(before + 1);
    const olt = await t.db.prisma.olt.findUniqueOrThrow({ where: { id } });
    expect(await decrypt(olt.cliCredEnc!, 'olt-snmp-only', 'cli')).toEqual(MOCK_CLI);
    const audit = await t.db.prisma.auditLog.findFirstOrThrow({ where: { action: 'olt.updated', target: `olt:${id}` }, orderBy: { id: 'desc' } });
    expect(audit.detail).toMatchObject({ changed: expect.arrayContaining(['cliEnabled', 'cli_credentials', 'sshAlgorithms']), sshAlgorithms: { cipher: ['aes128-cbc'] }, probeJobId: expect.any(Number) });
    expect(JSON.stringify(audit.detail)).not.toContain(MOCK_CLI.password);

    // Other changes do not probe; new algorithms do (the host key may only be readable with them).
    await call(t, admin, 'PATCH', `/olts/${id}`, { statusIntervalS: 120 });
    expect(await probes()).toBe(before + 1);
    await call(t, admin, 'PATCH', `/olts/${id}`, { sshAlgorithms: { cipher: ['aes128-cbc'], kex: ['diffie-hellman-group14-sha1'] } });
    expect(await probes()).toBe(before + 2);
    // A stored credential is enough to switch CLI off and on again.
    await call(t, admin, 'PATCH', `/olts/${id}`, { cliEnabled: false });
    expect((await call(t, admin, 'PATCH', `/olts/${id}`, { cliEnabled: true })).status).toBe(200);
    expect(await probes()).toBe(before + 3);
  });
});

describe('ONUs, alarms, refresh', () => {
  let oltId: number;
  let onuId: number;
  let alarmId: number;

  beforeAll(async () => {
    const olt = await t.db.prisma.olt.create({
      data: { name: 'mock-2', mgmtIp: '172.30.0.12', isMock: true, oidProfile: 'zte-c320-v2.2', snmpVersion: 'v3', snmpCredEnc: new Uint8Array([1]), status: 'ok', lastPollOkAt: new Date(), cliEnabled: false, ponPorts: { create: { slot: 1, port: 1 } } },
      include: { ponPorts: true },
    });
    oltId = olt.id;
    const onus = await Promise.all(
      [
        { idx: 1, sn: 'ZTEG00000A01', name: 'Pelanggan-201', phase: 'working', rx: -20.5 },
        { idx: 2, sn: 'ZTEG00000A02', name: 'Pelanggan-202', phase: 'los', rx: null },
        { idx: 3, sn: 'ZTEG00000A03', name: 'Pelanggan-203', phase: 'working', rx: -26.2 },
      ].map((o) =>
        t.db.prisma.onu.create({
          data: { oltId, ponPortId: olt.ponPorts[0]!.id, onuIndex: o.idx, sn: o.sn, name: o.name, state: { create: { phaseState: o.phase, rxDbm: o.rx } }, metrics: { create: { ts: new Date(), rxDbm: o.rx } } },
        }),
      ),
    );
    onuId = onus[0]!.id;
    alarmId = (await t.db.prisma.alarm.create({ data: { oltId, key: 'onu_los:onu:x', kind: 'onu_los', severity: 'warning', firstAt: new Date(), lastAt: new Date(), onuId: onus[1]!.id } })).id;
  });

  it('GET /dashboard totals and per-OLT counts', async () => {
    const res = await call(t, teknisi, 'GET', '/dashboard');
    expect(res.status).toBe(200);
    const olt = (res.body as { olts: { name: string; onus: unknown; dataAgeS: number }[] }).olts.find((o) => o.name === 'mock-2')!;
    expect(olt.onus).toEqual({ total: 3, online: 2, offline: 1 });
    expect(olt.dataAgeS).toBeLessThan(60);
  });

  it('optical data age comes from the last successful optical poll_run (SPEC §8.1)', async () => {
    const summary = async () => (await call(t, teknisi, 'GET', `/olts/${oltId}`)).body as { dataAgeS: number | null; lastOpticalOkAt: string | null; opticalAgeS: number | null };
    expect(await summary()).toMatchObject({ lastOpticalOkAt: null, opticalAgeS: null });
    const now = t.clock.now().getTime();
    const okAt = new Date(now - 20 * 60_000);
    await t.db.prisma.pollRun.createMany({
      data: [
        { oltId, kind: 'optical', startedAt: new Date(okAt.getTime() - 5000), finishedAt: okAt, ok: true },
        // Newer, but neither counts: a failed optical cycle and a status cycle.
        { oltId, kind: 'optical', startedAt: new Date(now - 6000), finishedAt: new Date(now), ok: false, error: 'SnmpTimeoutError' },
        { oltId, kind: 'status', startedAt: new Date(now - 1000), finishedAt: new Date(now), ok: true },
      ],
    });
    const s = await summary();
    expect(s.lastOpticalOkAt).toBe(okAt.toISOString());
    expect(s.opticalAgeS).toBeGreaterThanOrEqual(20 * 60);
    expect(s.opticalAgeS).toBeLessThan(21 * 60);
    expect(s.dataAgeS).toBeLessThan(60);
  });

  it('GET /onus filters by phase, Rx band and search (name, SN, index)', async () => {
    const q = async (qs: string) => ((await call(t, noc, 'GET', `/onus?oltId=${oltId}&${qs}`)).body as { total: number; items: { sn: string }[] });
    expect((await q('phase=los')).items.map((i) => i.sn)).toEqual(['ZTEG00000A02']);
    expect((await q('rx=warn')).items.map((i) => i.sn)).toEqual(['ZTEG00000A03']);
    expect((await q('q=zteg00000a01')).total).toBe(1);
    expect((await q('q=pelanggan-20')).total).toBe(3);
    expect((await q('q=2')).items.map((i) => i.sn)).toContain('ZTEG00000A02');
    expect((await call(t, noc, 'GET', '/onus?limit=9999')).status).toBe(400);
  });

  it('GET /onus/:id, metrics and events', async () => {
    expect((await call(t, noc, 'GET', `/onus/${onuId}`)).body).toMatchObject({ sn: 'ZTEG00000A01', phase: 'working', rxDbm: -20.5, oltName: 'mock-2', lastDetail: null });
    expect((await call(t, noc, 'GET', `/onus/${onuId}/metrics`)).body).toEqual([expect.objectContaining({ rxDbm: -20.5 })]);
    expect((await call(t, noc, 'GET', `/onus/${onuId}/events`)).status).toBe(200);
    expect((await call(t, noc, 'GET', '/onus/999999')).status).toBe(404);
  });

  it('refresh with CLI disabled -> 409', async () => {
    expect((await call(t, teknisi, 'POST', `/onus/${onuId}/refresh`)).status).toBe(409);
  });

  it('refresh with CLI enabled -> 202 job, a second one within 30 s -> 429', async () => {
    await t.db.prisma.olt.update({ where: { id: oltId }, data: { cliEnabled: true } });
    const first = await call(t, teknisi, 'POST', `/onus/${onuId}/refresh`);
    expect(first.status).toBe(202);
    const { jobId } = first.body as { jobId: number };
    expect((await call(t, teknisi, 'POST', `/onus/${onuId}/refresh`)).status).toBe(429);
    expect((await call(t, teknisi, 'GET', `/jobs/${jobId}`)).body).toMatchObject({ kind: 'onu_detail', status: 'confirmed' });
    expect((await call(t, noc, 'GET', `/jobs/${jobId}`)).status).toBe(403); // not the owner
    expect((await call(t, admin, 'GET', `/jobs/${jobId}`)).status).toBe(200);
    await t.db.prisma.olt.update({ where: { id: oltId }, data: { cliEnabled: false } });
  });

  it('alarms: teknisi ack -> 403, NOC ack -> 200 and audited, alarm stays active', async () => {
    expect((await call(t, teknisi, 'POST', `/alarms/${alarmId}/ack`)).status).toBe(403);
    expect((await call(t, noc, 'POST', `/alarms/${alarmId}/ack`)).status).toBe(200);
    expect((await call(t, noc, 'POST', `/alarms/${alarmId}/ack`)).status).toBe(409);
    const list = (await call(t, teknisi, 'GET', '/alarms')).body as { id: number; state: string; ackBy: number }[];
    expect(list.find((a) => a.id === alarmId)).toMatchObject({ state: 'active' });
    expect(await t.db.prisma.auditLog.count({ where: { action: 'alarm.ack' } })).toBe(1);
  });

  it('GET /audit (admin)', async () => {
    const res = await call(t, admin, 'GET', '/audit');
    expect(res.status).toBe(200);
    expect((res.body as { action: string }[]).map((a) => a.action)).toEqual(expect.arrayContaining(['auth.login', 'olt.created', 'alarm.ack']));
  });
});

describe('DELETE /olts/:id (admin or NOC, any status)', () => {
  const queue = (id: number) => new Queue(oltQueueName(id), { connection: { url: t.redis.getConnectionUrl() } });
  const create = async (name: string) => {
    const res = await call(t, admin, 'POST', '/olts', mockOlt(name));
    expect(res.status).toBe(201);
    return res.body as { id: number; identityProblem: boolean };
  };

  it('deletes a pending_pin OLT with its probe jobs and queue; audited', async () => {
    const { id, identityProblem } = await create('mock-del');
    expect(identityProblem).toBe(false);
    const q = queue(id);
    expect(await q.count()).toBe(1); // the registration probe, still waiting

    expect((await call(t, teknisi, 'DELETE', `/olts/${id}`, { confirmName: 'mock-del' })).status).toBe(403);
    expect((await call(t, admin, 'DELETE', `/olts/${id}`, { confirmName: 'mock-de' })).status).toBe(400);
    expect((await call(t, admin, 'DELETE', `/olts/${id}`, { confirmName: 'mock-del' })).status).toBe(204);

    expect(await t.db.prisma.olt.findUnique({ where: { id } })).toBeNull();
    expect(await t.db.prisma.job.count({ where: { oltId: id } })).toBe(0);
    expect(await q.count()).toBe(0);
    await q.close();
    const audit = await t.db.prisma.auditLog.findFirstOrThrow({ where: { action: 'olt.deleted', target: `olt:${id}` } });
    expect(audit.detail).toMatchObject({ name: 'mock-del', status: 'pending_pin', jobs: 1 });
  });

  it('NOC can add and delete an OLT; audited with the NOC as actor', async () => {
    const res = await call(t, noc, 'POST', '/olts', mockOlt('mock-noc'));
    expect(res.status).toBe(201);
    const { id } = res.body as { id: number };
    expect((await call(t, noc, 'DELETE', `/olts/${id}`, { confirmName: 'mock-noc' })).status).toBe(204);
    const nocUser = await t.db.prisma.user.findUniqueOrThrow({ where: { username: 'noc' } });
    expect(await t.db.prisma.auditLog.count({ where: { action: 'olt.deleted', target: `olt:${id}`, actor: nocUser.id } })).toBe(1);
    expect((await call(t, admin, 'DELETE', `/olts/${id}`, { confirmName: 'mock-del' })).status).toBe(404);
  });

  it('a pinned, polled OLT goes with all its data and schedulers; security events stay; pins kept in the audit', async () => {
    const { id } = await create('mock-live');
    const engineId = '80001f8880bb02';
    await t.db.prisma.oltIdentity.create({ data: { oltId: id, kind: 'snmp_engine_id', value: engineId, status: 'pinned', pinnedAt: new Date() } });
    await t.db.prisma.olt.update({ where: { id }, data: { status: 'ok', lastPollOkAt: new Date() } });
    const port = await t.db.prisma.ponPort.create({ data: { oltId: id, slot: 1, port: 1 } });
    const onu = await t.db.prisma.onu.create({ data: { oltId: id, ponPortId: port.id, onuIndex: 1, sn: 'ZTEGDEL00001', name: 'Pelanggan-01' } });
    await t.db.prisma.onuState.create({ data: { onuId: onu.id, phaseState: 'los' } });
    await t.db.prisma.onuEvent.create({ data: { onuId: onu.id, ts: new Date(), kind: 'state_change', fromState: 'working', toState: 'los' } });
    await t.db.prisma.pollRun.create({ data: { oltId: id, kind: 'status', startedAt: new Date(), finishedAt: new Date(), ok: true } });
    const now = new Date();
    await t.db.prisma.alarm.create({ data: { oltId: id, onuId: onu.id, ponPortId: port.id, kind: 'onu_los', key: `onu_los:${onu.id}`, severity: 'warning', firstAt: now, lastAt: now } });
    const event = await t.db.prisma.securityEvent.create({ data: { oltId: id, kind: 'cli_auth_failed', severity: 'warning', detail: {} } });
    const q = queue(id);
    await q.upsertJobScheduler('poll.status', { every: 60_000 }, { name: 'poll.status', data: { oltId: id } });
    expect((await call(t, noc, 'GET', `/olts/${id}`)).body).toMatchObject({ status: 'ok', identityProblem: false });

    expect((await call(t, noc, 'DELETE', `/olts/${id}`, { confirmName: 'mock-live' })).status).toBe(204);

    expect(await t.db.prisma.olt.findUnique({ where: { id } })).toBeNull();
    expect(await t.db.prisma.onu.count({ where: { oltId: id } })).toBe(0);
    expect(await t.db.prisma.onuState.count({ where: { onuId: onu.id } })).toBe(0);
    expect(await t.db.prisma.onuEvent.count({ where: { onuId: onu.id } })).toBe(0);
    expect(await t.db.prisma.alarm.count({ where: { oltId: id } })).toBe(0);
    expect(await t.db.prisma.pollRun.count({ where: { oltId: id } })).toBe(0);
    expect(await t.db.prisma.oltIdentity.count({ where: { oltId: id } })).toBe(0);
    expect((await t.db.prisma.securityEvent.findUniqueOrThrow({ where: { id: event.id } })).oltId).toBeNull();
    expect(await q.getJobSchedulers()).toEqual([]);
    await q.close();
    const audit = await t.db.prisma.auditLog.findFirstOrThrow({ where: { action: 'olt.deleted', target: `olt:${id}` } });
    expect(audit.detail).toMatchObject({ name: 'mock-live', status: 'ok', onus: 1, alarms: 1, pinned: [{ kind: 'snmp_engine_id', value: engineId }] });
  });

  it('an unaccepted identity change (quarantined, or disabled afterwards): NOC -> 403 and kept, admin -> 204', async () => {
    const { id } = await create('mock-quar');
    await t.db.prisma.olt.update({ where: { id }, data: { status: 'quarantined' } });
    const now = new Date();
    await t.db.prisma.alarm.create({ data: { oltId: id, kind: 'olt_identity_mismatch', key: 'olt_identity_mismatch', severity: 'critical', firstAt: now, lastAt: now } });
    expect((await call(t, noc, 'GET', `/olts/${id}`)).body).toMatchObject({ identityProblem: true });
    expect((await call(t, noc, 'DELETE', `/olts/${id}`, { confirmName: 'mock-quar' })).status).toBe(403);

    // Disabling does not clear the mismatch: still admin-only.
    await t.db.prisma.olt.update({ where: { id }, data: { status: 'disabled' } });
    expect((await call(t, noc, 'GET', `/olts/${id}`)).body).toMatchObject({ status: 'disabled', identityProblem: true });
    expect((await call(t, noc, 'DELETE', `/olts/${id}`, { confirmName: 'mock-quar' })).status).toBe(403);
    expect(await t.db.prisma.olt.findUnique({ where: { id } })).not.toBeNull();

    expect((await call(t, admin, 'DELETE', `/olts/${id}`, { confirmName: 'mock-quar' })).status).toBe(204);
    expect(await t.db.prisma.olt.findUnique({ where: { id } })).toBeNull();
  });

  it('a probe in progress -> 409, the queue keeps running; deletable once it is done', async () => {
    const { id } = await create('mock-busy');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const worker = new Worker(oltQueueName(id), () => gate, { connection: { url: t.redis.getConnectionUrl() } });
    await new Promise((r) => worker.once('active', r));

    expect((await call(t, admin, 'DELETE', `/olts/${id}`, { confirmName: 'mock-busy' })).status).toBe(409);
    const q = queue(id);
    expect(await q.isPaused()).toBe(false);

    const done = new Promise((r) => worker.once('completed', r));
    release();
    await done;
    await worker.close();
    expect((await call(t, admin, 'DELETE', `/olts/${id}`, { confirmName: 'mock-busy' })).status).toBe(204);
    await q.close();
  });
});
