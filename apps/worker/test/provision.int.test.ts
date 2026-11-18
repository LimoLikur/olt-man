import { startTestDatabase, type TestDatabase } from '@olt/db/testing';
import { previewSha256, registerOnuAndSave, renderPreview, writeConfig } from '@olt/olt-spec';
import { MOCK_CLI, MOCK_SNMP_V3 } from '@olt/shared';
import { credentialAad, sealEnvelope } from '@olt/shared/crypto';
import type { WriteJobData } from '@olt/shared/jobs';
import type { Job } from 'bullmq';
import { type RunningMock, startTestMock } from 'mock-olt/testing';
import { generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CliDeps } from '../src/cli/jobs/onu-detail.js';
import { CredentialDecryptor } from '../src/crypto/credential.decryptor.js';
import { MemoryEventPublisher } from '../src/events/publisher.js';
import { TargetGuard } from '../src/guards/target.guard.js';
import { processWriteJob } from '../src/provision/provision.executor.js';

let db: TestDatabase;
let mock: RunningMock;
let deps: CliDeps;
let oltId: number;
const keys = generateKeyPairSync('rsa', { modulusLength: 3072, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const seal = (field: 'snmp' | 'cli', v: unknown) => new Uint8Array(sealEnvelope(keys.publicKey, Buffer.from(JSON.stringify(v)), credentialAad('mock-1', field)));
const params = { slot: 1, port: 1, onuId: 13, sn: 'ZTEG0000ABCD', name: 'Pelanggan-Baru', onuType: 'ZTEG-F620', tcontProfile: '10M', vlan: 100 };

beforeAll(async () => {
  db = await startTestDatabase();
  mock = (await startTestMock({ MOCK_PAGE_LINES: '200' })).mock;
  deps = {
    prisma: db.prisma,
    decryptor: CredentialDecryptor.fromPem(keys.privateKey),
    guard: new TargetGuard(['127.0.0.1/32'], ['127.0.0.1/32']),
    publisher: new MemoryEventPublisher(),
    now: () => new Date(),
    snmpPort: () => mockSnmpPort,
    sshPort: () => mock.ssh.port!,
    snmpTimeoutMs: 1000,
  };
}, 180_000);
let mockSnmpPort = 0;
afterAll(async () => {
  await mock?.stop();
  await db?.stop();
});

beforeEach(async () => {
  mock.runner.run('reset');
  mockSnmpPort = (mock.snmp as unknown as { options: { port: number } }).options.port;
  await db.prisma.$executeRawUnsafe('ALTER TABLE olt ENABLE TRIGGER olt_is_mock_immutable');
  await db.prisma.olt.deleteMany();
  oltId = (
    await db.prisma.olt.create({
      data: {
        name: 'mock-1',
        mgmtIp: '127.0.0.1',
        isMock: true,
        oidProfile: 'zte-c320-v2.1',
        snmpVersion: 'v3',
        snmpCredEnc: seal('snmp', MOCK_SNMP_V3),
        cliEnabled: true,
        cliCredEnc: seal('cli', MOCK_CLI),
        status: 'ok',
        identities: {
          create: [
            { kind: 'snmp_engine_id', value: mock.identity.engineId, status: 'pinned' },
            { kind: 'ssh_hostkey', value: mock.identity.hostKeyFingerprint, status: 'pinned' },
          ],
        },
      },
    })
  ).id;
});

async function confirmedJob(kind: 'onu_register' | 'config_save' = 'onu_register', p = params) {
  const preview = renderPreview(kind === 'onu_register' ? registerOnuAndSave(p) : [writeConfig()]);
  return db.prisma.job.create({ data: { oltId, kind, params: kind === 'onu_register' ? p : {}, preview, previewSha256: previewSha256(preview), status: 'confirmed' } });
}
/** Commands the mock received, minus `show` reads and the `exit` that closes the session. */
const sentWrites = (since: number) => {
  const cmds = mock.log.entries('ssh-command', since).map((c) => c.command).filter((c) => !c.startsWith('show '));
  return cmds.at(-1) === 'exit' ? cmds.slice(0, -1) : cmds;
};
const run = (jobId: number) => processWriteJob(deps, { data: { jobId, oltId } } as Job<WriteJobData>);
const row = (id: number) => db.prisma.job.findUniqueOrThrow({ where: { id } });

describe('provision executor (I6)', () => {
  it('sends exactly the preview: registration, verification, then `write`; snapshots; saved by itself', async () => {
    const job = await confirmedJob();
    const since = mock.log.lastSeq;
    const writes = mock.olt.writes;
    await run(job.id);
    const done = await row(job.id);
    expect(done.status).toBe('succeeded');
    expect(sentWrites(since).join('\n')).toBe(job.preview);
    expect(sentWrites(since).at(-1)).toBe('write');
    // `write` only after the verification reads.
    const cmds = mock.log.entries('ssh-command', since).map((c) => c.command);
    expect(cmds.indexOf('write')).toBeGreaterThan(cmds.findLastIndex((c) => c.startsWith('show onu running config')));
    expect(done.appliedCommands).toEqual(job.preview!.split('\n'));
    expect(JSON.stringify(done.beforeSnapshot)).not.toContain('ZTEG0000ABCD');
    expect(JSON.stringify(done.afterSnapshot)).toContain('onu 13 type ZTEG-F620 sn ZTEG0000ABCD');
    expect(mock.olt.find({ slot: 1, port: 1, onuId: 13 })).toMatchObject({ name: 'Pelanggan-Baru' });
    expect(mock.olt.unsaved).toBe(false);
    expect(mock.olt.writes - writes).toBe(1);
    expect(done.savedByJobId).toBe(job.id);
    expect(done.result).toMatchObject({ saved: true });
    expect(JSON.stringify(done.result)).not.toContain(MOCK_CLI.password);
    expect(await db.prisma.auditLog.findFirst({ where: { action: 'job.succeeded', target: `job:${job.id}` } })).toMatchObject({ detail: { saved: true } });
  });

  it('a non-mock OLT inside OLT_TARGET_CIDRS is written like a mock (Fase 2 open since 2026-11-13)', async () => {
    await db.prisma.$executeRawUnsafe('ALTER TABLE olt DISABLE TRIGGER olt_is_mock_immutable');
    await db.prisma.$executeRawUnsafe(`UPDATE olt SET is_mock = false WHERE id = ${oltId}`);
    const job = await confirmedJob();
    const writes = mock.olt.writes;
    await run(job.id);
    expect((await row(job.id)).status).toBe('succeeded');
    expect(mock.olt.writes - writes).toBe(1);
  });

  it('an address outside OLT_TARGET_CIDRS -> failed before any SNMP or SSH (guard 2), security event', async () => {
    const job = await confirmedJob();
    const since = mock.log.lastSeq;
    await expect(processWriteJob({ ...deps, guard: new TargetGuard(['172.30.0.0/24'], ['172.30.0.0/24']) }, { data: { jobId: job.id, oltId } } as Job<WriteJobData>)).rejects.toThrow('write_guard_denied');
    expect(mock.log.entries('ssh-connect', since)).toHaveLength(0);
    expect(mock.log.entries('snmp-request', since)).toHaveLength(0);
    expect((await row(job.id)).status).toBe('failed');
    expect(await db.prisma.securityEvent.count({ where: { oltId, kind: 'write_guard_denied' } })).toBe(1);
  });

  it('`write` fails after a verified registration -> succeeded, saved: false with a warning, still unsaved', async () => {
    mock.olt.faults.failWrite = true;
    const job = await confirmedJob();
    await run(job.id);
    const done = await row(job.id);
    expect(done.status).toBe('succeeded');
    expect(done.savedByJobId).toBeNull();
    expect(done.result).toMatchObject({ saved: false, saveError: 'write_not_ok', message: expect.stringMatching(/gagal disimpan/) });
    expect(mock.olt.find({ slot: 1, port: 1, onuId: 13 })).toBeDefined();
    expect(mock.olt.unsaved).toBe(true);
  });

  it('an error at the 3rd command -> applied_commands holds 2, failed, sent once only', async () => {
    const taken = mock.olt.onus[0]!.sn; // the mock answers %Code at `onu ... sn <taken>`
    const job = await confirmedJob('onu_register', { ...params, sn: taken });
    const since = mock.log.lastSeq;
    await expect(run(job.id)).rejects.toThrow('command_failed');
    const done = await row(job.id);
    expect(done.status).toBe('failed');
    expect(done.appliedCommands).toEqual(['configure terminal', 'interface gpon-olt_1/1/1']);
    expect((done.result as { message: string }).message).toMatch(/onu 13 type .* gagal: %Code 32309/);
    expect(mock.log.entries('ssh-command', since).filter((c) => c.command.startsWith('onu '))).toHaveLength(1);
  });

  it('the ONU ID got taken since the preview -> failed "buat preview ulang", no write command sent', async () => {
    mock.olt.registerOnu({ slot: 1, port: 1, onuId: 13 }, 'ZTEG-F660', 'ZTEG0000EEEE');
    const job = await confirmedJob();
    const since = mock.log.lastSeq;
    await expect(run(job.id)).rejects.toThrow('onu_id_taken');
    expect((await row(job.id)).result).toMatchObject({ message: expect.stringMatching(/Buat preview ulang/) });
    expect(sentWrites(since)).toEqual([]);
  });

  it('params changed in the database after confirmation -> hash mismatch, no session', async () => {
    const job = await confirmedJob();
    await db.prisma.job.update({ where: { id: job.id }, data: { params: { ...params, vlan: 101 } } });
    const since = mock.log.lastSeq;
    await expect(run(job.id)).rejects.toThrow('preview_mismatch');
    expect(mock.log.entries('ssh-connect', since)).toHaveLength(0);
  });

  it('a payload that slipped into the database is re-validated (SPEC §14 B17, worker side)', async () => {
    const job = await confirmedJob();
    await db.prisma.job.update({ where: { id: job.id }, data: { params: { ...params, sn: 'ZTEG0000000\r\nreboot' } } });
    await expect(run(job.id)).rejects.toThrow('invalid_params');
  });

  it('config.save -> write sent, [OK], every unsaved registration marked saved', async () => {
    mock.olt.faults.failWrite = true; // the registration's own `write` fails: it stays unsaved
    const reg = await confirmedJob();
    await run(reg.id);
    expect((await row(reg.id)).savedByJobId).toBeNull();
    mock.olt.faults.failWrite = false;
    const save = await confirmedJob('config_save');
    const since = mock.log.lastSeq;
    const writes = mock.olt.writes;
    await run(save.id);
    expect((await row(save.id)).status).toBe('succeeded');
    expect(mock.log.entries('ssh-command', since).map((c) => c.command)).toContain('write');
    expect(mock.olt.writes - writes).toBe(1);
    expect(mock.olt.unsaved).toBe(false);
    expect((await row(reg.id)).savedByJobId).toBe(save.id);
  });

  it('mode pppoe_map (owner decision 2026-11-15): sends exactly the preview, verifies the AUD service and the WAN, then `write`', async () => {
    const pppoe = { ...params, mode: 'pppoe_map' as const, vlan: 600, description: 'Blok-A01', pppoeUsername: 'AUD-03-00001-001', pppoePassword: 'rahasia.123' };
    const job = await confirmedJob('onu_register', pppoe);
    const since = mock.log.lastSeq;
    await run(job.id);
    const done = await row(job.id);
    expect(done.status).toBe('succeeded');
    expect(sentWrites(since).join('\n')).toBe(job.preview);
    const onu = mock.olt.find({ slot: 1, port: 1, onuId: 13 })!;
    expect(onu.runningLines).toEqual(expect.arrayContaining(['gemport 1 name AUD tcont 1', 'pppoe-intermediate-agent enable sport 1']));
    expect(onu.mngLines).toEqual([
      'service AUD gemport 1 vlan 600',
      'wan-ip 1 mode pppoe username AUD-03-00001-001 password rahasia.123 vlan-profile PPPoE host 1',
      'wan-ip 1 ping-response enable traceroute-response enable',
      'security-mgmt 1 state enable mode forward protocol web',
    ]);
    expect(done.result).toMatchObject({ saved: true });
    expect(mock.olt.unsaved).toBe(false);
  });

  it('mode bridge_static (owner decision 2026-11-17): sends exactly the preview, verifies both services, then `write`', async () => {
    const bridgeStatic = { ...params, mode: 'bridge_static' as const, vlan: 62, description: 'JBB-KIC', bridgeTcontProfile: 'UP-20M', bridgeVlan: 30, lanPorts: 4 };
    const job = await confirmedJob('onu_register', bridgeStatic);
    const since = mock.log.lastSeq;
    await run(job.id);
    const done = await row(job.id);
    expect(done.status).toBe('succeeded');
    expect(sentWrites(since).join('\n')).toBe(job.preview);
    const onu = mock.olt.find({ slot: 1, port: 1, onuId: 13 })!;
    expect(onu.runningLines).toEqual(
      expect.arrayContaining([
        'tcont 2 profile UP-20M',
        'gemport 2 name bridging tcont 2',
        'service-port 2 vport 2 user-vlan 30 vlan 30',
        'port-identification sub-option remote-id enable vport 2',
      ]),
    );
    expect(onu.mngLines).toEqual([
      'service static gemport 1 vlan 62',
      'service bridging gemport 2 vlan 30',
      'switchport-bind switch_0/1 veip 1',
      ...[1, 2, 3, 4].map((i) => `vlan port eth_0/${i} mode tag vlan 30`),
    ]);
    expect(done.result).toMatchObject({ saved: true });
    expect(mock.olt.unsaved).toBe(false);
  });

  describe('mode bridge (owner decision 2026-11-14)', () => {
    const bridge = { ...params, mode: 'bridge' as const, description: 'Rumah-2', lanPorts: 4 };
    const vlanPort = (i: number) => `vlan port eth_0/${i} mode tag vlan 100`;

    it('sends exactly the bridge preview, verifies its lines, then `write`', async () => {
      const job = await confirmedJob('onu_register', bridge);
      const since = mock.log.lastSeq;
      await run(job.id);
      const done = await row(job.id);
      expect(done.status).toBe('succeeded');
      expect(job.preview).toContain('service bridging gemport 1 vlan 100');
      expect(sentWrites(since).join('\n')).toBe(job.preview);
      const onu = mock.olt.find({ slot: 1, port: 1, onuId: 13 })!;
      expect(onu).toMatchObject({ name: 'Pelanggan-Baru', description: 'Rumah-2' });
      expect(onu.runningLines).not.toContain('port-identification sub-option remote-id enable vport 2');
      expect(onu.mngLines).toEqual(['service bridging gemport 1 vlan 100', 'switchport-bind switch_0/1 veip 1', ...[1, 2, 3, 4].map(vlanPort)]);
      expect(done.result).toMatchObject({ saved: true });
      expect(mock.olt.unsaved).toBe(false);
    });

    it('a LAN port the ONU does not have -> failed at that line, nothing after it, no `write`', async () => {
      mock.olt.faults.ethPorts = 1;
      const job = await confirmedJob('onu_register', bridge);
      const since = mock.log.lastSeq;
      const writes = mock.olt.writes;
      await expect(run(job.id)).rejects.toThrow('command_failed');
      const done = await row(job.id);
      const preview = job.preview!.split('\n');
      expect(done.status).toBe('failed');
      expect(done.appliedCommands).toEqual(preview.slice(0, preview.indexOf(vlanPort(2))));
      expect(done.result).toMatchObject({ failedCommand: vlanPort(2), message: expect.stringMatching(/gagal: %Code/) });
      expect(sentWrites(since)).not.toContain(vlanPort(3));
      expect(sentWrites(since)).not.toContain('write');
      expect(mock.olt.writes - writes).toBe(0);
    });

    it('a bridge line missing from the OLT afterwards -> verification_failed listing it, no `write`', async () => {
      mock.olt.faults.garble = 'show onu running config gpon-onu_1/1/1:13';
      const job = await confirmedJob('onu_register', bridge);
      const since = mock.log.lastSeq;
      await expect(run(job.id)).rejects.toThrow('verification_failed');
      expect((await row(job.id)).result).toMatchObject({ error: 'verification_failed', missing: ['service bridging gemport 1 vlan 100', ...[1, 2, 3, 4].map(vlanPort)] });
      expect(sentWrites(since)).not.toContain('write');
    });
  });
});
