import { MOCK_CLI, MOCK_SNMP_COMMUNITY, MOCK_SNMP_V3 } from '@olt/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, type Client, login, startTestApi, type TestApi } from './helpers.js';

let t: TestApi;
let admin: Client;
let noc: Client;
beforeAll(async () => {
  t = await startTestApi();
  [admin, noc] = await Promise.all([login(t, 'admin', '192.168.10.2'), login(t, 'noc', '192.168.10.3')]);
}, 180_000);
afterAll(() => t?.stop());

const create = async (name: string, snmp: unknown) => {
  const res = await call(t, admin, 'POST', '/olts', { name, mgmtIp: '172.30.0.11', isMock: true, oidProfile: 'zte-c320-v2.1', snmp, cli: MOCK_CLI });
  expect(res.status).toBe(201);
  return (res.body as { id: number }).id;
};
/** Stands in for the worker's identity.probe result. */
const candidates = (oltId: number, rows: { kind: 'snmp_engine_id' | 'snmp_sysinfo' | 'ssh_hostkey'; value: string }[]) =>
  t.db.prisma.oltIdentity.createMany({ data: rows.map((r) => ({ oltId, ...r, status: 'candidate' as const })) });

describe('register -> probe -> pin (H1)', () => {
  it('POST /olts creates pending_pin and queues identity.probe', async () => {
    const id = await create('olt-h1', MOCK_SNMP_V3);
    expect((await call(t, admin, 'GET', `/olts/${id}`)).body).toMatchObject({ status: 'pending_pin', identityLevel: 'unpinned' });
    expect(await t.db.prisma.job.count({ where: { oltId: id, kind: 'identity_probe' } })).toBe(1);
  });

  it('pin: candidates become pinned, pending_pin -> ok, strong identity, audited', async () => {
    const id = await create('olt-pin', MOCK_SNMP_V3);
    expect((await call(t, admin, 'POST', `/olts/${id}/identity/pin`)).status).toBe(409); // nothing to pin yet
    await candidates(id, [
      { kind: 'snmp_engine_id', value: '80000f3e05a1a1a1a1a1a1' },
      { kind: 'ssh_hostkey', value: 'SHA256:' + 'A'.repeat(43) },
    ]);
    expect((await call(t, noc, 'GET', `/olts/${id}/identity`)).body).toMatchObject({ candidates: [expect.anything(), expect.anything()], pinned: [] });
    const res = await call(t, noc, 'POST', `/olts/${id}/identity/pin`); // NOC may pin (owner decision 2026-11-10)
    expect(res.status).toBe(200);
    expect((res.body as { pinned: unknown[]; candidates: unknown[] }).pinned).toHaveLength(2);
    expect((await call(t, admin, 'GET', `/olts/${id}`)).body).toMatchObject({ status: 'ok', identityLevel: 'strong' });
    expect(await t.db.prisma.auditLog.count({ where: { action: 'olt.identity_pinned', target: `olt:${id}` } })).toBe(1);
  });

  it('pin only adds kinds never pinned: a different value -> 409 (identity change), an equal leftover is dropped', async () => {
    const id = await create('olt-pin-more', MOCK_SNMP_V3);
    await candidates(id, [{ kind: 'snmp_engine_id', value: '80000f3e05c3c3c3c3c3c3' }]);
    await call(t, admin, 'POST', `/olts/${id}/identity/pin`);
    expect((await call(t, admin, 'GET', `/olts/${id}`)).body).toMatchObject({ status: 'ok', identityLevel: 'unpinned' }); // CLI on, no host key yet

    await candidates(id, [{ kind: 'snmp_engine_id', value: '80000f3e05d4d4d4d4d4d4' }]);
    const refused = await call(t, admin, 'POST', `/olts/${id}/identity/pin`);
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).toMatch(/Terima perubahan/);
    await t.db.prisma.oltIdentity.deleteMany({ where: { oltId: id, status: 'candidate' } });

    await candidates(id, [
      { kind: 'snmp_engine_id', value: '80000f3e05c3c3c3c3c3c3' }, // same as the pin
      { kind: 'ssh_hostkey', value: 'SHA256:' + 'F'.repeat(43) },
    ]);
    const res = await call(t, admin, 'POST', `/olts/${id}/identity/pin`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ candidates: [], retired: [] });
    expect((res.body as { pinned: { kind: string }[] }).pinned.map((p) => p.kind).sort()).toEqual(['snmp_engine_id', 'ssh_hostkey']);
    expect((await call(t, admin, 'GET', `/olts/${id}`)).body).toMatchObject({ status: 'ok', identityLevel: 'strong' });
  });

  it('a v2c OLT is "weak"', async () => {
    const id = await create('olt-v2c', { version: 'v2c', community: MOCK_SNMP_COMMUNITY });
    await candidates(id, [
      { kind: 'snmp_sysinfo', value: 'mock-1|1.3.6.1.4.1.3902.1082.1001.320.1.1' },
      { kind: 'ssh_hostkey', value: 'SHA256:' + 'B'.repeat(43) },
    ]);
    await call(t, admin, 'POST', `/olts/${id}/identity/pin`);
    expect((await call(t, noc, 'GET', `/olts/${id}`)).body).toMatchObject({ status: 'ok', identityLevel: 'weak' });
  });
});

describe('accept-change (H2, SPEC §14 B12)', () => {
  let id: number;
  beforeAll(async () => {
    id = await create('olt-q', MOCK_SNMP_V3);
    await candidates(id, [{ kind: 'ssh_hostkey', value: 'SHA256:' + 'C'.repeat(43) }, { kind: 'snmp_engine_id', value: '80000f3e05a1a1a1a1a1a1' }]);
    await call(t, admin, 'POST', `/olts/${id}/identity/pin`);
    // What the worker does on a host key mismatch.
    await t.db.prisma.olt.update({ where: { id }, data: { status: 'quarantined' } });
    await candidates(id, [{ kind: 'ssh_hostkey', value: 'SHA256:' + 'D'.repeat(43) }]);
    await t.db.prisma.alarm.create({ data: { oltId: id, key: 'olt_identity_mismatch', kind: 'olt_identity_mismatch', severity: 'critical', firstAt: new Date(), lastAt: new Date() } });
  });
  const accept = (c: Client, body: unknown) => call(t, c, 'POST', `/olts/${id}/identity/accept-change`, body);

  it('is refused without a reason (400), with the wrong name (400), for NOC (403) and for an admin off the LAN (403)', async () => {
    expect((await accept(admin, { confirmName: 'olt-q' })).status).toBe(400);
    expect((await accept(admin, { reason: 'ganti kartu kontrol', confirmName: 'olt-x' })).status).toBe(400);
    expect((await accept(noc, { reason: 'ganti kartu kontrol', confirmName: 'olt-q' })).status).toBe(403);
    const away = await login(t, 'admin', '192.168.10.9');
    expect((await accept({ ...away, ip: '203.0.113.5' }, { reason: 'ganti kartu kontrol', confirmName: 'olt-q' })).status).toBe(403);
    expect((await call(t, admin, 'GET', `/olts/${id}`)).body).toMatchObject({ status: 'quarantined' });
  });

  it('pin and probe are refused while quarantined', async () => {
    expect((await call(t, admin, 'POST', `/olts/${id}/identity/pin`)).status).toBe(409);
    expect((await call(t, admin, 'POST', `/olts/${id}/identity/probe`)).status).toBe(409);
  });

  it('a valid request: old key retired, new pinned, OLT ok, alarm cleared, audited', async () => {
    const res = await accept(admin, { reason: 'kartu kontrol slot 3 diganti', confirmName: 'olt-q' });
    expect(res.status).toBe(200);
    const body = res.body as { pinned: { kind: string; value: string }[]; retired: { kind: string; value: string }[] };
    expect(body.pinned.find((p) => p.kind === 'ssh_hostkey')!.value).toBe('SHA256:' + 'D'.repeat(43));
    expect(body.retired.map((r) => r.value)).toContain('SHA256:' + 'C'.repeat(43));
    expect((await call(t, admin, 'GET', `/olts/${id}`)).body).toMatchObject({ status: 'ok' });
    expect(await t.db.prisma.alarm.count({ where: { oltId: id, kind: 'olt_identity_mismatch', state: 'active' } })).toBe(0);
    const audit = await t.db.prisma.auditLog.findFirstOrThrow({ where: { action: 'olt.identity_change_accepted' } });
    expect(audit.detail).toMatchObject({ reason: 'kartu kontrol slot 3 diganti' });
  });
});
