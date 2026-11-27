import { previewSha256, rebootOnu, registerOnuAndSave, renderPreview } from '@olt/olt-spec';
import { oltQueueName, writeJobId } from '@olt/shared/jobs';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { call, type Client, login, startTestApi, type TestApi } from './helpers.js';

let t: TestApi;
let admin: Client;
let noc: Client;
let teknisi: Client;
let mockId: number;
let realId: number;

beforeAll(async () => {
  t = await startTestApi();
  [admin, noc, teknisi] = await Promise.all([login(t, 'admin', '192.168.10.2'), login(t, 'noc', '192.168.10.3'), login(t, 'teknisi', '192.168.10.4')]);
  const allowlist = {
    create: [
      { kind: 'onu_type' as const, value: 'ZTEG-F620' },
      { kind: 'tcont_profile' as const, value: '10M' },
      { kind: 'vlan' as const, value: '100' },
    ],
  };
  const mock = await t.db.prisma.olt.create({
    data: { name: 'mock-1', mgmtIp: '172.30.0.11', isMock: true, oidProfile: 'zte-c320-v2.1', snmpVersion: 'v3', snmpCredEnc: new Uint8Array([1]), status: 'ok', cliEnabled: true, allowlist, ponPorts: { create: [{ slot: 1, port: 1 }] } },
    include: { ponPorts: true },
  });
  mockId = mock.id;
  // ONU IDs 1 and 2 are taken on 1/1/1, 3 only by an archived row: next free is 3.
  for (const [idx, sn, archived] of [[1, 'ZTEGAAAA0001', false], [2, 'ZTEGAAAA0002', false], [3, 'ZTEGAAAA0003', true]] as const) {
    await t.db.prisma.onu.create({ data: { oltId: mockId, ponPortId: mock.ponPorts[0]!.id, onuIndex: idx, sn, name: `Pelanggan-0${idx}`, archivedAt: archived ? new Date() : null } });
  }
  realId = (
    await t.db.prisma.olt.create({
      data: { name: 'olt-asli', mgmtIp: '10.20.0.5', isMock: false, oidProfile: 'zte-c320-v2.1', snmpVersion: 'v3', snmpCredEnc: new Uint8Array([1]), status: 'ok', cliEnabled: true, allowlist, ponPorts: { create: [{ slot: 1, port: 1 }] } },
    })
  ).id;
}, 180_000);
afterAll(() => t?.stop());

const draft = (over: Record<string, unknown> = {}) => ({ oltId: mockId, slot: 1, port: 1, sn: 'ZTEG00000002', name: 'Pelanggan-99', onuType: 'ZTEG-F620', tcontProfile: '10M', vlan: 100, ...over });

describe('POST /jobs (draft -> preview)', () => {
  it('teknisi gets the builder output for the next free ONU ID, with its hash; audited', async () => {
    const res = await call(t, teknisi, 'POST', '/jobs', draft());
    expect(res.status).toBe(201);
    const body = res.body as { id: number; status: string; params: { onuId: number }; preview: string; previewSha256: string };
    expect(body.status).toBe('preview');
    expect(body.params.onuId).toBe(3);
    const expected = renderPreview(registerOnuAndSave({ slot: 1, port: 1, onuId: 3, sn: 'ZTEG00000002', name: 'Pelanggan-99', onuType: 'ZTEG-F620', tcontProfile: '10M', vlan: 100 }));
    expect(expected.split('\n').at(-1)).toBe('write');
    expect(body.preview).toBe(expected);
    expect(body.previewSha256).toBe(previewSha256(expected));
    const row = await t.db.prisma.job.findUniqueOrThrow({ where: { id: body.id } });
    expect(row).toMatchObject({ kind: 'onu_register', preview: expected, previewSha256: previewSha256(expected) });
    expect(await t.db.prisma.auditLog.count({ where: { action: 'job.preview', target: `job:${body.id}` } })).toBe(1);
    // The owner, admins and NOC (who approve registrations) can read it.
    expect((await call(t, teknisi, 'GET', `/jobs/${body.id}`)).status).toBe(200);
    expect((await call(t, admin, 'GET', `/jobs/${body.id}`)).status).toBe(200);
    expect((await call(t, noc, 'GET', `/jobs/${body.id}`)).status).toBe(200);
  });

  it('a real OLT is accepted like a mock (Fase 2 open since 2026-11-13); status not ok or CLI off -> 409 (guard 1)', async () => {
    const res = await call(t, admin, 'POST', '/jobs', draft({ oltId: realId, sn: 'ZTEG0000C001' }));
    expect(res.status).toBe(201);
    expect((res.body as { preview: string }).preview.split('\n').at(-1)).toBe('write');
    expect((await call(t, teknisi, 'GET', `/olts/${realId}/provision-options`)).status).toBe(200);
    for (const data of [{ cliEnabled: false }, { status: 'unreachable' as const }]) {
      await t.db.prisma.olt.update({ where: { id: realId }, data });
      expect((await call(t, admin, 'POST', '/jobs', draft({ oltId: realId, sn: 'ZTEG0000C002' }))).status).toBe(409);
      await t.db.prisma.olt.update({ where: { id: realId }, data: { cliEnabled: true, status: 'ok' } });
    }
  });

  it('the ONU type is typed freely (owner decision 2026-11-13) but format-checked', async () => {
    const res = await call(t, teknisi, 'POST', '/jobs', draft({ onuType: 'ZTE-F660', sn: 'ZTEG0000C004' }));
    expect(res.status).toBe(201);
    expect((res.body as { preview: string }).preview).toContain('type ZTE-F660 sn ZTEG0000C004');
    for (const over of [{ onuType: 'ZTE F660' }, { tcontProfile: '50M;reboot' }, { onuType: 'x'.repeat(33) }]) {
      expect((await call(t, teknisi, 'POST', '/jobs', draft(over))).status).toBe(400);
    }
  });

  it('mode bridge (owner decision 2026-11-14): its template for the next free ID; description and LAN ports checked; mode default by default', async () => {
    const res = await call(t, teknisi, 'POST', '/jobs', draft({ mode: 'bridge', sn: 'ZTEG0000B001', description: 'Rumah-2', lanPorts: 2 }));
    expect(res.status).toBe(201);
    const body = res.body as { params: { onuId: number }; preview: string; previewSha256: string };
    const params = { mode: 'bridge' as const, slot: 1, port: 1, onuId: 3, sn: 'ZTEG0000B001', name: 'Pelanggan-99', onuType: 'ZTEG-F620', tcontProfile: '10M', vlan: 100, description: 'Rumah-2', lanPorts: 2 };
    expect(body.params).toEqual(params);
    const expected = renderPreview(registerOnuAndSave(params));
    expect(body.preview).toBe(expected);
    expect(body.previewSha256).toBe(previewSha256(expected));
    expect(body.preview.split('\n').filter((l) => l.startsWith('vlan port'))).toEqual(['vlan port eth_0/1 mode tag vlan 100', 'vlan port eth_0/2 mode tag vlan 100']);

    const plain = await call(t, teknisi, 'POST', '/jobs', draft({ mode: 'bridge', sn: 'ZTEG0000B002', lanPorts: 4 }));
    expect(plain.status).toBe(201);
    expect((plain.body as { preview: string }).preview).not.toContain('description');
    const legacy = await call(t, teknisi, 'POST', '/jobs', draft({ sn: 'ZTEG0000B003' }));
    expect(legacy.body).toMatchObject({ params: { mode: 'default' } });
    expect((legacy.body as { preview: string }).preview).toContain('service HSI type internet');

    for (const over of [
      { mode: 'bridge', lanPorts: 0 },
      { mode: 'bridge', lanPorts: 5 },
      { mode: 'bridge' },
      { mode: 'bridge', lanPorts: 4, description: 'Rumah 2' },
      { mode: 'bridge', lanPorts: 4, description: '' },
      { lanPorts: 4 },
      { description: 'Rumah-2' },
      { mode: 'pppoe' },
    ]) {
      expect((await call(t, teknisi, 'POST', '/jobs', draft({ sn: 'ZTEG0000B004', ...over }))).status, JSON.stringify(over)).toBe(400);
    }
  });

  it('mode pppoe_map (owner decision 2026-11-15): its template with the PPPoE account as typed; account format checked; refused elsewhere', async () => {
    const account = { pppoeUsername: 'AUD-03-00001-001', pppoePassword: 'rahasia.123' };
    const res = await call(t, teknisi, 'POST', '/jobs', draft({ mode: 'pppoe_map', sn: 'ZTEG0000D001', description: 'Blok-A01', ...account }));
    expect(res.status).toBe(201);
    const body = res.body as { params: Record<string, unknown>; preview: string; previewSha256: string };
    const params = { mode: 'pppoe_map' as const, slot: 1, port: 1, onuId: 3, sn: 'ZTEG0000D001', name: 'Pelanggan-99', onuType: 'ZTEG-F620', tcontProfile: '10M', vlan: 100, description: 'Blok-A01', ...account };
    expect(body.params).toEqual(params);
    const expected = renderPreview(registerOnuAndSave(params));
    expect(body.preview).toBe(expected);
    expect(body.previewSha256).toBe(previewSha256(expected));
    expect(body.preview).toContain('wan-ip 1 mode pppoe username AUD-03-00001-001 password rahasia.123 vlan-profile PPPoE host 1');

    for (const over of [
      { mode: 'pppoe_map', pppoeUsername: 'AUD-1' },
      { mode: 'pppoe_map', pppoePassword: 'x' },
      { mode: 'pppoe_map', ...account, pppoePassword: 'abc?def' },
      { mode: 'pppoe_map', ...account, pppoePassword: 'abc def' },
      { mode: 'pppoe_map', ...account, pppoeUsername: 'AUD 03' },
      { mode: 'pppoe_map', ...account, lanPorts: 4 },
      { mode: 'bridge', lanPorts: 4, ...account },
      { ...account },
    ]) {
      expect((await call(t, teknisi, 'POST', '/jobs', draft({ sn: 'ZTEG0000D002', ...over }))).status, JSON.stringify(over)).toBe(400);
    }
  });

  it('mode bridge_static (owner decision 2026-11-17): its template; the bridging VLAN and T-CONT profile on the lists, the VLANs different; refused elsewhere', async () => {
    // Added for this test only: later tests check the lists exactly.
    const added = [
      { oltId: mockId, kind: 'vlan' as const, value: '30' },
      { oltId: mockId, kind: 'tcont_profile' as const, value: '100M' },
    ];
    await t.db.prisma.provisionAllowlist.createMany({ data: added });
    onTestFinished(() => t.db.prisma.provisionAllowlist.deleteMany({ where: { OR: added } }).then(() => undefined));
    const bridging = { bridgeTcontProfile: '100M', bridgeVlan: 30, lanPorts: 4 };
    const res = await call(t, teknisi, 'POST', '/jobs', draft({ mode: 'bridge_static', sn: 'ZTEG0000E001', description: 'JBB-KIC', ...bridging }));
    expect(res.status).toBe(201);
    const body = res.body as { params: Record<string, unknown>; preview: string; previewSha256: string };
    const params = { mode: 'bridge_static' as const, slot: 1, port: 1, onuId: 3, sn: 'ZTEG0000E001', name: 'Pelanggan-99', onuType: 'ZTEG-F620', tcontProfile: '10M', vlan: 100, description: 'JBB-KIC', ...bridging };
    expect(body.params).toEqual(params);
    const expected = renderPreview(registerOnuAndSave(params));
    expect(body.preview).toBe(expected);
    expect(body.previewSha256).toBe(previewSha256(expected));
    expect(body.preview).toContain('service-port 2 vport 2 user-vlan 30 vlan 30');
    expect(body.preview).toContain('port-identification sub-option remote-id enable vport 2');

    // Not on the OLT's lists: 400 naming the field.
    for (const [over, field] of [
      [{ bridgeVlan: 31 }, 'bridgeVlan'],
      [{ bridgeTcontProfile: 'UP-99M' }, 'bridgeTcontProfile'],
    ] as const) {
      const bad = await call(t, teknisi, 'POST', '/jobs', draft({ mode: 'bridge_static', sn: 'ZTEG0000E002', ...bridging, ...over }));
      expect(bad.status, JSON.stringify(over)).toBe(400);
      expect(bad.body).toMatchObject({ fields: [field] });
    }
    for (const over of [
      { mode: 'bridge_static', ...bridging, bridgeVlan: 100 },
      { mode: 'bridge_static', ...bridging, bridgeVlan: undefined },
      { mode: 'bridge_static', ...bridging, bridgeTcontProfile: undefined },
      { mode: 'bridge_static', ...bridging, lanPorts: undefined },
      { mode: 'bridge', ...bridging },
      { ...bridging },
    ]) {
      expect((await call(t, teknisi, 'POST', '/jobs', draft({ sn: 'ZTEG0000E003', ...over }))).status, JSON.stringify(over)).toBe(400);
    }
    // The bridge template has no vport 2 since 2026-11-17.
    const bridge = await call(t, teknisi, 'POST', '/jobs', draft({ mode: 'bridge', sn: 'ZTEG0000E004', lanPorts: 4 }));
    expect((bridge.body as { preview: string }).preview).not.toContain('vport 2');
  });

  it("the T-CONT profile must be on the OLT's list; NOC and admin add profiles to it (app only), teknisi cannot; audited", async () => {
    expect((await call(t, teknisi, 'POST', '/jobs', draft({ tcontProfile: 'UP-50M', sn: 'ZTEG0000C005' }))).status).toBe(400);
    expect((await call(t, teknisi, 'POST', `/olts/${mockId}/tcont-profiles`, { profile: 'UP-50M' })).status).toBe(403);
    for (const profile of ['', 'UP 50M', 'x'.repeat(33), 50]) expect((await call(t, noc, 'POST', `/olts/${mockId}/tcont-profiles`, { profile })).status).toBe(400);
    expect((await call(t, noc, 'POST', `/olts/${mockId}/tcont-profiles`, { profile: 'UP-50M' })).status).toBe(201);
    expect((await call(t, admin, 'POST', `/olts/${mockId}/tcont-profiles`, { profile: 'UP-50M' })).status).toBe(409);
    expect((await call(t, teknisi, 'GET', `/olts/${mockId}/tcont-profiles`)).body).toEqual(['10M', 'UP-50M']);
    expect(await t.db.prisma.auditLog.count({ where: { action: 'olt.tcont_profile_added', target: `olt:${mockId}` } })).toBe(1);
    const res = await call(t, teknisi, 'POST', '/jobs', draft({ tcontProfile: 'UP-50M', sn: 'ZTEG0000C005' }));
    expect(res.status).toBe(201);
    expect((res.body as { preview: string }).preview).toContain('tcont 1 name T1 profile UP-50M');
    await t.db.prisma.provisionAllowlist.deleteMany({ where: { oltId: mockId, kind: 'tcont_profile', value: 'UP-50M' } });
  });

  it("the VLAN must be on the OLT's list; NOC and admin add VLANs to it (app only), teknisi cannot; audited", async () => {
    expect((await call(t, teknisi, 'POST', '/jobs', draft({ vlan: 200, sn: 'ZTEG0000C003' }))).status).toBe(400);
    expect((await call(t, teknisi, 'POST', `/olts/${mockId}/vlans`, { vlan: 200 })).status).toBe(403);
    for (const vlan of [0, 4095, '200', 1.5]) expect((await call(t, noc, 'POST', `/olts/${mockId}/vlans`, { vlan })).status).toBe(400);
    expect((await call(t, noc, 'POST', `/olts/${mockId}/vlans`, { vlan: 200 })).status).toBe(201);
    expect((await call(t, admin, 'POST', `/olts/${mockId}/vlans`, { vlan: 200 })).status).toBe(409);
    expect((await call(t, teknisi, 'GET', `/olts/${mockId}/vlans`)).body).toEqual([100, 200]);
    expect(await t.db.prisma.auditLog.count({ where: { action: 'olt.vlan_added', target: `olt:${mockId}` } })).toBe(1);
    const res = await call(t, teknisi, 'POST', '/jobs', draft({ vlan: 200, sn: 'ZTEG0000C003' }));
    expect(res.status).toBe(201);
    expect((res.body as { preview: string }).preview).toContain('user-vlan 200 vlan 200');
    await t.db.prisma.provisionAllowlist.deleteMany({ where: { oltId: mockId, kind: 'vlan', value: '200' } });
  });

  it.each([
    ['SN with \\r\\nreboot', { sn: 'ZTEG0000000\r\nreboot' }],
    ['name with ;', { name: 'a;reboot' }],
    ['name with a newline', { name: 'Pelanggan\nreboot' }],
    ['name with a space', { name: 'Pelanggan 99' }],
  ])('injection payload (SPEC §14 B17): %s -> 400', async (_l, over) => {
    expect((await call(t, teknisi, 'POST', '/jobs', draft(over))).status).toBe(400);
  });

  it('NOC -> 403; unknown port -> 400; SN already active -> 409', async () => {
    expect((await call(t, noc, 'POST', '/jobs', draft())).status).toBe(403);
    expect((await call(t, teknisi, 'POST', '/jobs', draft({ port: 9 }))).status).toBe(400);
    expect((await call(t, teknisi, 'POST', '/jobs', draft({ sn: 'ZTEGAAAA0001' }))).status).toBe(409);
  });

  it('provision-options lists ports, the VLAN list, and ONU type and T-CONT suggestions', async () => {
    expect((await call(t, teknisi, 'GET', `/olts/${mockId}/provision-options`)).body).toEqual({ oltId: mockId, ready: true, ports: [{ slot: 1, port: 1 }], onuTypes: ['ZTEG-F620'], tcontProfiles: ['10M'], vlans: [100] });
    expect((await call(t, noc, 'GET', `/olts/${mockId}/provision-options`)).status).toBe(403);
  });
});

describe('POST /jobs/:id/confirm and cancel (I5, SPEC §14 B18)', () => {
  let other: Client;
  beforeAll(async () => {
    const { hash } = await import('@node-rs/argon2');
    await t.db.prisma.user.create({ data: { username: 'teknisi2', role: 'teknisi', passwordHash: await hash('teknisi2-password-12') } });
    const res = await call(t, { ip: '192.168.10.6' }, 'POST', '/auth/login', { username: 'teknisi2', password: 'teknisi2-password-12' });
    other = { cookie: res.headers.get('set-cookie')!.split(';')[0]!, ip: '192.168.10.6' };
  });
  const preview = async (sn: string) => (await call(t, teknisi, 'POST', '/jobs', draft({ sn }))).body as { id: number; previewSha256: string };

  it('teknisi: a wrong hash -> 409, the right one -> pending_approval (not queued), audited', async () => {
    const job = await preview('ZTEG0000B001');
    expect((await call(t, teknisi, 'POST', `/jobs/${job.id}/confirm`, { previewSha256: '0'.repeat(64) })).status).toBe(409);
    const res = await call(t, teknisi, 'POST', `/jobs/${job.id}/confirm`, { previewSha256: job.previewSha256 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: job.id, status: 'pending_approval' });
    const row = await t.db.prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe('pending_approval');
    expect(row.confirmedBy).toBeNull();
    expect(await t.db.prisma.auditLog.count({ where: { action: 'job.submitted', target: `job:${job.id}` } })).toBe(1);
    expect((await call(t, teknisi, 'POST', `/jobs/${job.id}/confirm`, { previewSha256: job.previewSha256 })).status).toBe(409); // only once
  });

  it('admin confirms its own registration directly -> confirmed', async () => {
    const job = (await call(t, admin, 'POST', '/jobs', draft({ sn: 'ZTEG0000B004' }))).body as { id: number; previewSha256: string };
    const res = await call(t, admin, 'POST', `/jobs/${job.id}/confirm`, { previewSha256: job.previewSha256 });
    expect(res.body).toEqual({ id: job.id, status: 'confirmed' });
    expect(await t.db.prisma.auditLog.count({ where: { action: 'job.confirmed', target: `job:${job.id}` } })).toBe(1);
  });

  it("confirming someone else's job -> 403; a job other than registration -> 403 for teknisi", async () => {
    const job = await preview('ZTEG0000B002');
    expect((await call(t, other, 'POST', `/jobs/${job.id}/confirm`, { previewSha256: job.previewSha256 })).status).toBe(403);
    const save = (await call(t, admin, 'POST', `/olts/${mockId}/save-config`)).body as { id: number; previewSha256: string; preview: string };
    expect(save.preview).toBe('write');
    expect((await call(t, teknisi, 'POST', `/jobs/${save.id}/confirm`, { previewSha256: save.previewSha256 })).status).toBe(403);
    expect((await call(t, admin, 'POST', `/jobs/${save.id}/confirm`, { previewSha256: save.previewSha256 })).status).toBe(200);
    expect((await call(t, noc, 'POST', `/jobs/${job.id}/confirm`, { previewSha256: job.previewSha256 })).status).toBe(403);
  });

  it('cancel: owner or admin, before it starts', async () => {
    const job = await preview('ZTEG0000B003');
    expect((await call(t, other, 'POST', `/jobs/${job.id}/cancel`)).status).toBe(403);
    expect((await call(t, teknisi, 'POST', `/jobs/${job.id}/cancel`)).status).toBe(200);
    expect((await call(t, teknisi, 'POST', `/jobs/${job.id}/confirm`, { previewSha256: job.previewSha256 })).status).toBe(409);
  });

  it('teknisi cancels a pending_approval job; it can no longer be approved', async () => {
    const job = await preview('ZTEG0000B005');
    await call(t, teknisi, 'POST', `/jobs/${job.id}/confirm`, { previewSha256: job.previewSha256 });
    expect((await call(t, teknisi, 'POST', `/jobs/${job.id}/cancel`)).status).toBe(200);
    expect((await call(t, noc, 'POST', `/jobs/${job.id}/approve`, { previewSha256: job.previewSha256 })).status).toBe(409);
  });

  it('save-config on a real OLT -> a `write` preview like on a mock (admin only)', async () => {
    const res = await call(t, admin, 'POST', `/olts/${realId}/save-config`);
    expect(res.status).toBe(201);
    expect((res.body as { preview: string }).preview).toBe('write');
    expect((await call(t, noc, 'POST', `/olts/${realId}/save-config`)).status).toBe(403);
  });
});

describe('NOC approval of teknisi registrations (owner decision 2026-11-10)', () => {
  const submitted = async (sn: string) => {
    const job = (await call(t, teknisi, 'POST', '/jobs', draft({ sn }))).body as { id: number; previewSha256: string };
    expect((await call(t, teknisi, 'POST', `/jobs/${job.id}/confirm`, { previewSha256: job.previewSha256 })).status).toBe(200);
    return job;
  };

  it('listed in /approvals for NOC and admin, not for teknisi; NOC can open the job', async () => {
    const job = await submitted('ZTEG0000C001');
    const list = await call(t, noc, 'GET', '/approvals');
    expect(list.status).toBe(200);
    expect((list.body as { id: number; requestedBy: string }[]).find((j) => j.id === job.id)).toMatchObject({ requestedBy: 'teknisi', oltName: 'mock-1' });
    expect((await call(t, admin, 'GET', '/approvals')).status).toBe(200);
    expect((await call(t, teknisi, 'GET', '/approvals')).status).toBe(403);
    expect((await call(t, noc, 'GET', `/jobs/${job.id}`)).status).toBe(200);
  });

  it('approve: teknisi -> 403, wrong hash -> 409, NOC with the hash -> confirmed and queued, audited', async () => {
    const job = await submitted('ZTEG0000C002');
    expect((await call(t, teknisi, 'POST', `/jobs/${job.id}/approve`, { previewSha256: job.previewSha256 })).status).toBe(403);
    expect((await call(t, noc, 'POST', `/jobs/${job.id}/approve`, { previewSha256: '0'.repeat(64) })).status).toBe(409);
    const res = await call(t, noc, 'POST', `/jobs/${job.id}/approve`, { previewSha256: job.previewSha256 });
    expect(res.body).toEqual({ id: job.id, status: 'confirmed' });
    const row = await t.db.prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    const nocUser = await t.db.prisma.user.findUniqueOrThrow({ where: { username: 'noc' } });
    expect(row).toMatchObject({ status: 'confirmed', confirmedBy: nocUser.id });
    expect(await t.db.prisma.auditLog.count({ where: { action: 'job.approved', target: `job:${job.id}` } })).toBe(1);
    expect((await call(t, noc, 'POST', `/jobs/${job.id}/approve`, { previewSha256: job.previewSha256 })).status).toBe(409); // only once
  });

  it('a job still in preview cannot be approved', async () => {
    const job = (await call(t, teknisi, 'POST', '/jobs', draft({ sn: 'ZTEG0000C003' }))).body as { id: number; previewSha256: string };
    expect((await call(t, noc, 'POST', `/jobs/${job.id}/approve`, { previewSha256: job.previewSha256 })).status).toBe(409);
  });

  it('reject needs a reason; the teknisi sees it on the job; audited', async () => {
    const job = await submitted('ZTEG0000C004');
    expect((await call(t, noc, 'POST', `/jobs/${job.id}/reject`, { reason: '' })).status).toBe(400);
    expect((await call(t, teknisi, 'POST', `/jobs/${job.id}/reject`, { reason: 'bukan wewenang' })).status).toBe(403);
    expect((await call(t, admin, 'POST', `/jobs/${job.id}/reject`, { reason: 'VLAN pelanggan salah' })).body).toEqual({ id: job.id, status: 'rejected' });
    const view = (await call(t, teknisi, 'GET', `/jobs/${job.id}`)).body as { status: string; result: { rejectReason: string } };
    expect(view.status).toBe('rejected');
    expect(view.result.rejectReason).toBe('VLAN pelanggan salah');
    expect(await t.db.prisma.auditLog.count({ where: { action: 'job.rejected', target: `job:${job.id}` } })).toBe(1);
    expect((await call(t, noc, 'POST', `/jobs/${job.id}/approve`, { previewSha256: job.previewSha256 })).status).toBe(409);
  });
});

describe('POST /olts/:id/provision-lists/sync (cli.list-sync)', () => {
  it('NOC and admin queue one read job per OLT per 30 s; teknisi 403; CLI off 409; audited', async () => {
    expect((await call(t, teknisi, 'POST', `/olts/${mockId}/provision-lists/sync`)).status).toBe(403);
    const res = await call(t, noc, 'POST', `/olts/${mockId}/provision-lists/sync`);
    expect(res.status).toBe(202);
    const { jobId } = res.body as { jobId: number };
    expect(await t.db.prisma.job.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ kind: 'list_sync', status: 'confirmed' });
    expect((await call(t, noc, 'GET', `/jobs/${jobId}`)).status).toBe(200);
    expect((await call(t, admin, 'POST', `/olts/${mockId}/provision-lists/sync`)).status).toBe(429);
    expect(await t.db.prisma.auditLog.count({ where: { action: 'olt.lists_sync', target: `olt:${mockId}` } })).toBe(1);
    await t.db.prisma.olt.update({ where: { id: realId }, data: { cliEnabled: false } });
    expect((await call(t, admin, 'POST', `/olts/${realId}/provision-lists/sync`)).status).toBe(409);
    await t.db.prisma.olt.update({ where: { id: realId }, data: { cliEnabled: true } });
  });
});

describe('uncfg ONUs (cli.uncfg-scan)', () => {
  it('admin, NOC and teknisi scan (one per OLT per 15 s); CLI off 409; the latest scan is listed; audited', async () => {
    expect((await call(t, teknisi, 'GET', `/olts/${mockId}/uncfg`)).body).toEqual({ scan: null });
    const res = await call(t, teknisi, 'POST', `/olts/${mockId}/uncfg/scan`);
    expect(res.status).toBe(202);
    const { jobId } = res.body as { jobId: number };
    expect((await call(t, noc, 'POST', `/olts/${mockId}/uncfg/scan`)).status).toBe(429);
    await t.db.prisma.job.update({ where: { id: jobId }, data: { status: 'succeeded', result: { onus: [{ slot: 1, port: 1, index: 1, sn: 'HWTCAADBEF5B', state: 'unknown' }] } } });
    expect((await call(t, noc, 'GET', `/olts/${mockId}/uncfg`)).body).toMatchObject({ scan: { jobId, status: 'succeeded', onus: [{ sn: 'HWTCAADBEF5B' }], error: null } });
    expect(await t.db.prisma.auditLog.count({ where: { action: 'olt.uncfg_scan', target: `olt:${mockId}` } })).toBe(1);
    await t.db.prisma.olt.update({ where: { id: realId }, data: { cliEnabled: false } });
    expect((await call(t, admin, 'POST', `/olts/${realId}/uncfg/scan`)).status).toBe(409);
    await t.db.prisma.olt.update({ where: { id: realId }, data: { cliEnabled: true } });
  });
});


describe('POST /onus/:id/reboot (owner decision 2026-11-27)', () => {
  type Preview = { id: number; status: string; preview: string; previewSha256: string; params: Record<string, unknown> };
  let onuId: number;
  const onuWith = async (sn: string) => (await t.db.prisma.onu.findFirstOrThrow({ where: { oltId: mockId, sn } })).id;
  const reboot = async (c: Client, id = onuId) => call(t, c, 'POST', `/onus/${id}/reboot`);
  const queued = async (jobId: number) => {
    const q = new Queue(oltQueueName(mockId), { connection: { url: t.redis.getConnectionUrl() } });
    try {
      return await q.getJob(writeJobId(jobId));
    } finally {
      await q.close();
    }
  };
  beforeAll(async () => {
    onuId = await onuWith('ZTEGAAAA0001');
  });

  it("every role gets the template for the ONU's position and SN, with its hash; audited; nothing queued yet", async () => {
    const expected = renderPreview(rebootOnu({ slot: 1, port: 1, onuId: 1, sn: 'ZTEGAAAA0001' }));
    expect(expected).toBe('configure terminal\npon-onu-mng gpon-onu_1/1/1:1\nreboot\nyes\nend');
    for (const c of [admin, noc, teknisi]) {
      const res = await reboot(c);
      expect(res.status).toBe(201);
      const body = res.body as Preview;
      expect(body).toMatchObject({ status: 'preview', preview: expected, previewSha256: previewSha256(expected), params: { slot: 1, port: 1, onuId: 1, sn: 'ZTEGAAAA0001' } });
      expect(await t.db.prisma.job.findUniqueOrThrow({ where: { id: body.id } })).toMatchObject({ kind: 'onu_reboot', status: 'preview' });
      expect(await t.db.prisma.auditLog.findFirst({ where: { action: 'job.preview', target: `job:${body.id}` } })).toMatchObject({ detail: { kind: 'onu_reboot', onu: onuId } });
      expect(await queued(body.id)).toBeUndefined();
      // The owner can follow it on the job page.
      expect((await call(t, c, 'GET', `/jobs/${body.id}`)).status).toBe(200);
      await call(t, c, 'POST', `/jobs/${body.id}/cancel`);
    }
  });

  it('NOC and teknisi confirm their own reboot: confirmed and queued at once, no approval; audited', async () => {
    for (const c of [noc, teknisi]) {
      const job = (await reboot(c)).body as Preview;
      expect((await call(t, c, 'POST', `/jobs/${job.id}/confirm`, { previewSha256: '0'.repeat(64) })).status).toBe(409);
      const res = await call(t, c, 'POST', `/jobs/${job.id}/confirm`, { previewSha256: job.previewSha256 });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: job.id, status: 'confirmed' });
      expect((await queued(job.id))?.name).toBe('onu.reboot');
      expect(await t.db.prisma.auditLog.count({ where: { action: 'job.confirmed', target: `job:${job.id}` } })).toBe(1);
      // One reboot at a time per ONU.
      expect((await reboot(c)).status).toBe(409);
      await t.db.prisma.job.update({ where: { id: job.id }, data: { status: 'succeeded' } });
    }
    expect(await t.db.prisma.job.count({ where: { kind: 'onu_reboot', status: 'pending_approval' } })).toBe(0);
  });

  it("only its owner (or admin) confirms or cancels a reboot; NOC still cannot confirm others' jobs", async () => {
    const job = (await reboot(teknisi)).body as Preview;
    expect((await call(t, noc, 'POST', `/jobs/${job.id}/confirm`, { previewSha256: job.previewSha256 })).status).toBe(403);
    expect((await call(t, noc, 'POST', `/jobs/${job.id}/cancel`)).status).toBe(403);
    expect((await call(t, teknisi, 'POST', `/jobs/${job.id}/cancel`)).status).toBe(200);
    const nocJob = (await reboot(noc)).body as Preview;
    expect((await call(t, teknisi, 'POST', `/jobs/${nocJob.id}/confirm`, { previewSha256: nocJob.previewSha256 })).status).toBe(403);
    expect((await call(t, noc, 'POST', `/jobs/${nocJob.id}/cancel`)).status).toBe(200);
    const adminJob = (await reboot(admin)).body as Preview;
    expect((await call(t, admin, 'POST', `/jobs/${adminJob.id}/confirm`, { previewSha256: adminJob.previewSha256 })).status).toBe(200);
    await t.db.prisma.job.update({ where: { id: adminJob.id }, data: { status: 'succeeded' } });
    // A registration is still not NOC's to confirm, nor config.save teknisi's.
    const reg = (await call(t, teknisi, 'POST', '/jobs', draft({ sn: 'ZTEG0000D001' }))).body as Preview;
    expect((await call(t, noc, 'POST', `/jobs/${reg.id}/confirm`, { previewSha256: reg.previewSha256 })).status).toBe(403);
  });

  it('an archived ONU -> 409; OLT not ok or CLI off -> 409 (guard 1); unknown ONU -> 404', async () => {
    expect((await reboot(noc, await onuWith('ZTEGAAAA0003'))).status).toBe(409);
    expect((await reboot(noc, 999_999)).status).toBe(404);
    for (const data of [{ status: 'stale' as const }, { cliEnabled: false }]) {
      await t.db.prisma.olt.update({ where: { id: mockId }, data });
      onTestFinished(() => t.db.prisma.olt.update({ where: { id: mockId }, data: { status: 'ok', cliEnabled: true } }).then(() => undefined));
      expect((await reboot(noc)).status).toBe(409);
      await t.db.prisma.olt.update({ where: { id: mockId }, data: { status: 'ok', cliEnabled: true } });
    }
  });
});
