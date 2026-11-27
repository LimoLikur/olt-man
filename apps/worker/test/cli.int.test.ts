import { startTestDatabase, type TestDatabase } from '@olt/db/testing';
import { rebootOnu, showCard, showOnuState } from '@olt/olt-spec';
import { MOCK_CLI, MOCK_SNMP_V3 } from '@olt/shared';
import { credentialAad, sealEnvelope } from '@olt/shared/crypto';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import type { Job } from 'bullmq';
import { type RunningMock, startTestMock } from 'mock-olt/testing';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// Test-only: mint a write command the way a Fase 2 builder (I1) will.
import { mint } from '../../../packages/olt-spec/src/commands/allowed.js';
import { CliAuthError, CliError, CliNegotiationError, HostKeyMismatchError, WriteInReadSessionError } from '../src/cli/errors.js';
import { enqueueOnuDetail, onuDetailBackoff, processOnuDetail, type CliDeps, type OnuDetailJobData } from '../src/cli/jobs/onu-detail.js';
import { processListSync } from '../src/cli/jobs/list-sync.js';
import { processUncfgScan } from '../src/cli/jobs/uncfg-scan.js';
import type { ListSyncJobData, UncfgScanJobData } from '@olt/shared/jobs';
import { OltCliSession, type OltCliTarget } from '../src/cli/olt-cli.session.js';
import { cliSessionOptions, sshAlgorithms } from '../src/cli/ssh-algorithms.js';
import { probeSshHostKey } from '../src/identity/ssh-hostkey.js';
import { CredentialDecryptor } from '../src/crypto/credential.decryptor.js';
import { MemoryEventPublisher } from '../src/events/publisher.js';
import { TargetGuard } from '../src/guards/target.guard.js';
import { createOltWorker, OltQueues } from '../src/scheduler/olt-queues.js';

let db: TestDatabase;
let redis: StartedRedisContainer;
let mock: RunningMock;
/** Old-firmware SSH (RSA host key, CBC ciphers only), like the real C320 olt-a. */
let legacy: RunningMock;
let deps: CliDeps;
let oltId: number;
let onuId: number;
const guard = new TargetGuard(['127.0.0.1/32'], ['127.0.0.1/32']);
const keys = generateKeyPairSync('rsa', { modulusLength: 3072, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const seal = (name: string, field: 'snmp' | 'cli', v: unknown) => new Uint8Array(sealEnvelope(keys.publicKey, Buffer.from(JSON.stringify(v)), credentialAad(name, field)));
const DELAYS = [50, 50, 50];

beforeAll(async () => {
  [db, redis] = await Promise.all([startTestDatabase(), new RedisContainer('redis:7.4-alpine').start()]);
  [mock, legacy] = (await Promise.all([startTestMock({ MOCK_PAGE_LINES: '10', MOCK_VTY_MAX: '2' }), startTestMock({ MOCK_SSH_PROFILE: 'legacy' })])).map((m) => m.mock) as [RunningMock, RunningMock];
  deps = {
    prisma: db.prisma,
    decryptor: CredentialDecryptor.fromPem(keys.privateKey),
    guard,
    publisher: new MemoryEventPublisher(),
    now: () => new Date(),
    sshPort: () => mock.ssh.port!,
    retryDelaysMs: DELAYS,
    cliOptions: { connectTimeoutMs: 3000, commandTimeoutMs: 5000 },
  };
}, 180_000);
afterAll(async () => {
  await Promise.all([mock?.stop(), legacy?.stop()]);
  await Promise.all([db?.stop(), redis?.stop()]);
});

beforeEach(async () => {
  mock.runner.run('reset');
  legacy.runner.run('reset');
  await db.prisma.olt.deleteMany();
  const olt = await db.prisma.olt.create({
    data: {
      name: 'mock-1',
      mgmtIp: '127.0.0.1',
      isMock: true,
      oidProfile: 'zte-c320-v2.1',
      snmpVersion: 'v3',
      snmpCredEnc: seal('mock-1', 'snmp', MOCK_SNMP_V3),
      cliEnabled: true,
      cliCredEnc: seal('mock-1', 'cli', MOCK_CLI),
      status: 'ok',
      identities: { create: { kind: 'ssh_hostkey', value: mock.identity.hostKeyFingerprint, status: 'pinned' } },
      ponPorts: { create: { slot: 2, port: 5 } },
    },
    include: { ponPorts: true },
  });
  oltId = olt.id;
  onuId = (await db.prisma.onu.create({ data: { oltId, ponPortId: olt.ponPorts[0]!.id, onuIndex: 5, sn: 'ZTEGC1192DD7', name: 'Customer-2' } })).id;
});

const target = (over: Partial<OltCliTarget> = {}): OltCliTarget => ({
  name: 'mock-1',
  ip: '127.0.0.1',
  port: mock.ssh.port!,
  credential: MOCK_CLI,
  hostKeyPins: [mock.identity.hostKeyFingerprint],
  ...over,
});

describe('OltCliSession', () => {
  it('a different host key drops the connection before auth: 0 auth attempts at the mock', async () => {
    const since = mock.log.lastSeq;
    const s = new OltCliSession(target({ hostKeyPins: ['SHA256:' + 'A'.repeat(43)] }), guard);
    await expect(s.open('read')).rejects.toBeInstanceOf(HostKeyMismatchError);
    await s.close();
    expect(mock.log.entries('ssh-auth', since)).toHaveLength(0);
  });

  it('accepts any of two pinned keys (active and standby card)', async () => {
    const s = new OltCliSession(target({ hostKeyPins: ['SHA256:' + 'B'.repeat(43), mock.identity.hostKeyFingerprint] }), guard);
    await s.open('read');
    expect(await s.run(showCard())).toMatch(/^Rack Shelf Slot/);
    await s.close();
  });

  it('receives multi-page output whole (--More--)', async () => {
    const s = new OltCliSession(target(), guard);
    await s.open('read');
    const out = await s.run(showOnuState({ slot: 1, port: 1 }));
    expect(out.split('\n').filter((l) => l.startsWith('gpon-onu_1/1/1:'))).toHaveLength(mock.olt.onPort({ slot: 1, port: 1 }).length);
    expect(out).not.toContain('--More--');
    await s.close();
  });

  it('refuses a write command in a read session before sending it', async () => {
    const s = new OltCliSession(target(), guard);
    await s.open('read');
    const since = mock.log.lastSeq;
    await expect(s.run(mint('write', 'write'))).rejects.toBeInstanceOf(WriteInReadSessionError);
    expect(mock.log.entries('ssh-command', since)).toHaveLength(0);
    await s.close();
  });

  it("sends `reboot` only in its ONU's pon-onu-mng mode, then answers the OLT's question with the previewed yes", async () => {
    const onu = mock.olt.onus.find((o) => o.phase === 'working')!;
    const [conf, mng, reboot, end] = rebootOnu({ slot: onu.slot, port: onu.port, onuId: onu.onuId, sn: onu.sn });
    const s = new OltCliSession(target(), guard);
    await s.open('write');
    await s.run(conf!);
    // In config mode the same word would not reboot this ONU: refused before it reaches the wire.
    const since = mock.log.lastSeq;
    await expect(s.run(reboot!)).rejects.toThrow(/not sent: the prompt shows mode "\(config\)"/);
    expect(mock.log.entries('ssh-command', since)).toHaveLength(0);
    await s.run(mng!);
    const out = await s.run(reboot!);
    expect(out).toMatch(/Confirm to reboot\? \[yes\/no\]:yes$/);
    expect(mock.log.entries('ssh-command', since).map((c) => c.command)).toEqual([mng!.text, 'reboot', 'yes']);
    expect(mock.olt.reboots).toEqual([{ slot: onu.slot, port: onu.port, onuId: onu.onuId }]);
    await s.run(end!);
    // Another ONU's reboot is refused in this ONU's mode as well.
    await s.run(conf!);
    await s.run(mng!);
    const other = rebootOnu({ slot: onu.slot, port: onu.port, onuId: onu.onuId === 1 ? 2 : 1, sn: onu.sn })[2]!;
    await expect(s.run(other)).rejects.toBeInstanceOf(CliError);
    await s.close();
  });

  it('a command whose question never comes is not a success', async () => {
    const s = new OltCliSession(target(), guard);
    await s.open('write');
    await expect(s.run(mint('show card', 'read', { confirm: { question: /never asked$/, answer: 'yes' } }))).rejects.toThrow('the OLT did not ask for confirmation');
    await s.close();
  });

  it('logs in like OpenSSH ("none", then password); the trace holds no credentials', async () => {
    const s = new OltCliSession(target(), guard);
    await s.open('read');
    expect(s.trace.filter((l) => / auth: /.test(l)).map((l) => l.replace(/^\d+ms /, ''))).toEqual([
      'auth: none (server allows: not asked yet)',
      'auth: password (server allows: password)',
      'auth: accepted',
    ]);
    expect(s.trace.some((l) => l.includes('SERVICE_REQUEST (ssh-userauth)'))).toBe(true);
    expect(s.trace.join('\n')).not.toContain(MOCK_CLI.password);
    expect(s.trace.join('\n')).not.toContain(MOCK_CLI.username);
    await s.close();
  });

  it('wrong password -> CliAuthError after exactly 1 attempt', async () => {
    const since = mock.log.lastSeq;
    const s = new OltCliSession(target({ credential: { ...MOCK_CLI, password: 'wrong-password' } }), guard);
    await expect(s.open('read')).rejects.toBeInstanceOf(CliAuthError);
    await s.close();
    expect(mock.log.entries('ssh-auth', since).filter((a) => a.method === 'password')).toHaveLength(1);
  });

  it('refuses targets outside the guard without connecting', async () => {
    const since = mock.log.lastSeq;
    const s = new OltCliSession(target(), new TargetGuard(['172.30.0.0/24'], []));
    await expect(s.open('read')).rejects.toThrow(/outside OLT_TARGET_CIDRS/);
    expect(mock.log.entries('ssh-connect', since)).toHaveLength(0);
  });
});

describe('cli.onu-detail job', () => {
  const run = async (until: (jobId: number) => Promise<boolean>, d: CliDeps = deps) => {
    const opts = { connection: { host: redis.getHost(), port: redis.getPort() }, prefix: `t-${randomUUID()}` };
    const queues = new OltQueues(opts);
    const worker = createOltWorker(oltId, (job) => processOnuDetail(d, job as Job<OnuDetailJobData>), { ...opts, settings: { backoffStrategy: onuDetailBackoff(DELAYS) } });
    const jobId = await enqueueOnuDetail(d, queues, onuId);
    expect(jobId).not.toBeNull();
    const deadline = Date.now() + 15_000;
    while (!(await until(jobId!)) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    return { jobId: jobId!, queues, worker, done: async () => (await worker.close(), await queues.close()) };
  };
  const status = async (id: number) => (await db.prisma.job.findUniqueOrThrow({ where: { id } })).status;

  it('stores parsed detail-info and attenuation; afterwards the mock has 0 active sessions', async () => {
    const r = await run(async (id) => (await status(id)) === 'succeeded');
    const job = await db.prisma.job.findUniqueOrThrow({ where: { id: r.jobId } });
    expect(job.status).toBe('succeeded');
    const result = job.result as { detail: { history: unknown[]; distanceM: number }; attenuation: { downstream: { onuRxDbm: number } }; transcript: { command: string }[] };
    expect(result.detail.history).toHaveLength(10);
    expect(result.detail.distanceM).toBe(3540);
    expect(result.attenuation.downstream.onuRxDbm).toBeCloseTo(-18.21, 2);
    expect(result.transcript.map((t) => t.command)).toEqual(['show gpon onu detail-info gpon-onu_1/2/5:5', 'show pon power attenuation gpon-onu_1/2/5:5']);
    expect(JSON.stringify(job.result)).not.toContain(MOCK_CLI.password);
    await new Promise((res) => setTimeout(res, 200));
    expect(mock.ssh.activeSessions).toBe(0);
    await r.done();
  });

  it('at most one job per ONU per 30 s', async () => {
    const opts = { connection: { host: redis.getHost(), port: redis.getPort() }, prefix: `t-${randomUUID()}` };
    const queues = new OltQueues(opts);
    expect(await enqueueOnuDetail(deps, queues, onuId)).not.toBeNull();
    expect(await enqueueOnuDetail(deps, queues, onuId)).toBeNull();
    await queues.close();
  });

  it('vty-full -> retried, then cli_unavailable; no session of others was touched', async () => {
    mock.runner.run('vty-full');
    const since = mock.log.lastSeq;
    const r = await run(async (id) => (await status(id)) === 'failed');
    expect(await status(r.jobId)).toBe('failed');
    const failed = (await db.prisma.job.findUniqueOrThrow({ where: { id: r.jobId } })).result as { error: string; reason: string; trace: string[] };
    expect(failed.error).toBe('cli_unavailable');
    expect(failed.reason).toBe('closed before prompt');
    // The trace shows the login got through before the session closed, without credentials.
    expect(failed.trace.some((l) => l.endsWith('auth: accepted'))).toBe(true);
    expect(JSON.stringify(failed)).not.toContain(MOCK_CLI.password);
    expect(mock.log.entries('ssh-session', since).filter((e) => e.event === 'rejected-vty')).toHaveLength(DELAYS.length + 1);
    expect(await db.prisma.alarm.count({ where: { oltId, kind: 'cli_unavailable', state: 'active' } })).toBe(1);
    await r.done();

    mock.runner.run('vty-free');
    const ok = await run(async (id) => (await status(id)) === 'succeeded');
    expect(await db.prisma.alarm.count({ where: { oltId, kind: 'cli_unavailable', state: 'active' } })).toBe(0);
    await ok.done();
  }, 30_000);

  it('wrong password -> 1 attempt only, cli_auth_failed, security event', async () => {
    await db.prisma.olt.update({ where: { id: oltId }, data: { cliCredEnc: seal('mock-1', 'cli', { ...MOCK_CLI, password: 'wrong-password' }) } });
    const since = mock.log.lastSeq;
    const r = await run(async (id) => (await status(id)) === 'failed');
    await new Promise((res) => setTimeout(res, 300)); // would-be retries
    expect(mock.log.entries('ssh-auth', since).filter((a) => a.method === 'password')).toHaveLength(1);
    expect(((await db.prisma.job.findUniqueOrThrow({ where: { id: r.jobId } })).result as { error: string }).error).toBe('cli_auth_failed');
    expect(await db.prisma.securityEvent.count({ where: { oltId, kind: 'cli_auth_failed' } })).toBe(1);
    await r.done();
  });

  it('host key mismatch -> blocked, nothing sent', async () => {
    mock.runner.run('hostkey-rotate');
    await new Promise((res) => setTimeout(res, 100));
    const since = mock.log.lastSeq;
    const r = await run(async (id) => (await status(id)) === 'blocked');
    expect(await status(r.jobId)).toBe('blocked');
    expect(mock.log.entries('ssh-auth', since)).toHaveLength(0);
    await r.done();
  });

  describe('against old-firmware SSH (olt.ssh_algorithms)', () => {
    const legacyDeps = () => ({ ...deps, sshPort: () => legacy.ssh.port! });
    const useLegacy = (sshAlgorithms: object) =>
      db.prisma.olt.update({
        where: { id: oltId },
        data: { sshAlgorithms, identities: { updateMany: { where: { kind: 'ssh_hostkey' }, data: { value: legacy.identity.hostKeyFingerprint } } } },
      });
    const result = async (id: number) => (await db.prisma.job.findUniqueOrThrow({ where: { id } })).result as { error?: string; detail?: string };

    it('no common algorithm -> failed after 1 attempt (not retried), nothing authenticated', async () => {
      await useLegacy({});
      const since = legacy.log.lastSeq;
      const r = await run(async (id) => (await status(id)) === 'failed', legacyDeps());
      await new Promise((res) => setTimeout(res, 300)); // would-be retries
      expect(await result(r.jobId)).toMatchObject({ error: 'ssh_negotiation_failed', detail: 'no matching C->S cipher' });
      expect(legacy.log.entries('ssh-connect', since)).toHaveLength(1);
      expect(legacy.log.entries('ssh-auth', since)).toHaveLength(0);
      expect(await db.prisma.alarm.count({ where: { oltId, kind: 'cli_unavailable' } })).toBe(0);
      await r.done();
    });

    it("with the OLT's algorithms (aes128-cbc) -> succeeded", async () => {
      await useLegacy({ cipher: ['aes128-cbc'] });
      const r = await run(async (id) => (await status(id)) === 'succeeded', legacyDeps());
      expect(await status(r.jobId)).toBe('succeeded');
      await r.done();
    });

    it('a value outside the allowlist in the database never reaches ssh2', async () => {
      await useLegacy({ cipher: ['none'] });
      const since = legacy.log.lastSeq;
      const r = await run(async (id) => (await status(id)) === 'failed', legacyDeps());
      expect(await result(r.jobId)).toMatchObject({ error: 'ssh_algorithms_invalid' });
      expect(legacy.log.entries('ssh-connect', since)).toHaveLength(0);
      await r.done();
    });
  });
});

describe('legacy SSH algorithms (mock profile "legacy")', () => {
  const legacyTarget = (): OltCliTarget => ({ name: 'mock-1', ip: '127.0.0.1', port: legacy.ssh.port!, credential: MOCK_CLI, hostKeyPins: [legacy.identity.hostKeyFingerprint] });

  it('ssh2 defaults: negotiation fails before authentication and names the step', async () => {
    const since = legacy.log.lastSeq;
    const s = new OltCliSession(legacyTarget(), guard, { connectTimeoutMs: 3000 });
    const error = await s.open('read').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliNegotiationError);
    expect((error as CliNegotiationError).detail).toBe('no matching C->S cipher');
    await s.close();
    expect(legacy.log.entries('ssh-auth', since)).toHaveLength(0);
  });

  it("negotiates what OpenSSH picks on a C320: group16-sha512 and aes128-cbc, whatever the stored order", async () => {
    const s = new OltCliSession(legacyTarget(), guard, cliSessionOptions({ connectTimeoutMs: 3000 }, { cipher: ['3des-cbc', 'aes128-cbc'] }));
    await s.open('read');
    expect(s.negotiated).toMatchObject({ kex: 'diffie-hellman-group16-sha512', serverHostKey: 'ssh-rsa', cs: { cipher: 'aes128-cbc', mac: 'hmac-sha1' } });
    await s.close();
  });

  it('aes128-cbc appended: the session works, and the defaults stay first', async () => {
    const options = cliSessionOptions({ connectTimeoutMs: 3000 }, { cipher: ['aes128-cbc'] });
    expect(options).toMatchObject({ connectTimeoutMs: 3000, algorithms: { cipher: { append: ['aes128-cbc'] } } });
    const s = new OltCliSession(legacyTarget(), guard, options);
    await s.open('read');
    expect(await s.run(showCard())).toMatch(/^Rack Shelf Slot/);
    await s.close();
    // The modern mock still negotiates its modern algorithms with the same options.
    const m = new OltCliSession(target(), guard, options);
    await m.open('read');
    await m.close();
  });

  it('host key probe: reports the failed step, then reads the RSA key, never authenticating', async () => {
    const since = legacy.log.lastSeq;
    expect(await probeSshHostKey('127.0.0.1', legacy.ssh.port!, guard, { timeoutMs: 3000 })).toEqual({ ok: false, error: 'negotiation: no matching C->S cipher' });
    expect(await probeSshHostKey('127.0.0.1', legacy.ssh.port!, guard, { timeoutMs: 3000, algorithms: sshAlgorithms({ cipher: ['aes128-cbc'] }) })).toEqual({
      ok: true,
      fingerprint: legacy.identity.hostKeyFingerprint,
      algo: 'ssh-rsa',
    });
    expect(await probeSshHostKey('127.0.0.1', mock.ssh.port!, guard, { timeoutMs: 3000 })).toMatchObject({ ok: true, algo: 'ssh-ed25519' });
    expect(legacy.log.entries('ssh-auth', since)).toHaveLength(0);
  });

  it('only allowlisted values are accepted', () => {
    expect(() => sshAlgorithms({ cipher: ['none'] })).toThrow();
    expect(() => sshAlgorithms({ cipher: ['aes128-ctr'] })).toThrow(); // already a default: not an "addition"
    expect(() => sshAlgorithms({ cipher: ['aes128-cbc', 'aes128-cbc'] })).toThrow();
    expect(() => sshAlgorithms({ compress: ['zlib'] })).toThrow();
    // Without legacy entries only the kex order changes (OpenSSH's: group14-sha256 last).
    expect(sshAlgorithms({})).toEqual({ kex: { remove: ['diffie-hellman-group14-sha256'], append: ['diffie-hellman-group14-sha256'], prepend: [] } });
    expect(sshAlgorithms(null)).toEqual(sshAlgorithms({}));
  });

  it('appends legacy algorithms in allowlist order, whatever order was stored', () => {
    const algorithms = sshAlgorithms({ cipher: ['3des-cbc', 'aes256-cbc', 'aes192-cbc', 'aes128-cbc'], hmac: ['hmac-md5-96', 'hmac-md5', 'hmac-sha1-96'] });
    expect(algorithms?.cipher).toMatchObject({ append: ['aes128-cbc', 'aes192-cbc', 'aes256-cbc', '3des-cbc'] });
    expect(algorithms?.hmac).toMatchObject({ append: ['hmac-sha1-96', 'hmac-md5', 'hmac-md5-96'] });
  });
});

describe('cli.list-sync (read-only show commands)', () => {
  const runSync = async () => {
    const row = await db.prisma.job.create({ data: { oltId, kind: 'list_sync', params: {}, status: 'confirmed' } });
    await processListSync(deps, { data: { jobId: row.id, oltId } } as Job<ListSyncJobData>).catch(() => undefined);
    return db.prisma.job.findUniqueOrThrow({ where: { id: row.id } });
  };
  const list = async () => (await db.prisma.provisionAllowlist.findMany({ where: { oltId, kind: 'vlan' } })).map((r) => Number(r.value)).sort((a, b) => a - b);

  const MOCK_PROFILES = ['default', '10M', 'UP-10M', 'UP-20M', 'UP-50M', 'UP-60M', 'UP-100M'];
  const profiles = async () => (await db.prisma.provisionAllowlist.findMany({ where: { oltId, kind: 'tcont_profile' } })).map((r) => r.value).sort();

  it('adds the VLANs and T-CONT profiles the OLT lists; values added by NOC stay; only the two read commands are sent; a rerun adds nothing', async () => {
    await db.prisma.provisionAllowlist.createMany({ data: [{ oltId, kind: 'vlan', value: '3000' }, { oltId, kind: 'tcont_profile', value: 'NOC-ONLY' }] });
    const since = mock.log.lastSeq;
    const first = await runSync();
    expect(first.status).toBe('succeeded');
    expect(first.result).toEqual({ vlans: { found: ['1', '100', '1245', '1246', '1247'], added: 5 }, tcontProfiles: { found: MOCK_PROFILES, added: 7 } });
    expect(await list()).toEqual([1, 100, 1245, 1246, 1247, 3000]);
    expect(await profiles()).toEqual([...MOCK_PROFILES, 'NOC-ONLY'].sort());
    expect(mock.log.entries('ssh-command', since).map((c) => c.command).filter((c) => c !== 'exit')).toEqual(['show vlan summary', 'show gpon profile tcont']);
    expect((await runSync()).result).toMatchObject({ vlans: { added: 0 }, tcontProfiles: { added: 0 } });
  });

  it('a list whose output does not parse is not stored (raw output kept); the other list still is; job failed', async () => {
    mock.olt.faults.garble = 'show gpon profile tcont';
    const done = await runSync();
    expect(done.status).toBe('failed');
    expect(done.result).toMatchObject({
      error: 'parse_failed',
      failedLists: ['tcontProfiles'],
      vlans: { added: 5 },
      tcontProfiles: { error: 'parse_failed', output: 'Unexpected output from a different firmware' },
    });
    expect(await list()).toEqual([1, 100, 1245, 1246, 1247]);
    expect(await profiles()).toEqual([]);
  });

  it('CLI off -> failed cli_disabled before any connection', async () => {
    await db.prisma.olt.update({ where: { id: oltId }, data: { cliEnabled: false } });
    const since = mock.log.lastSeq;
    expect(await runSync()).toMatchObject({ status: 'failed', result: { error: 'cli_disabled' } });
    expect(mock.log.entries('ssh-connect', since)).toHaveLength(0);
  });
});

describe('cli.uncfg-scan (show gpon onu uncfg, read-only)', () => {
  const runScan = async () => {
    const row = await db.prisma.job.create({ data: { oltId, kind: 'uncfg_scan', params: {}, status: 'confirmed' } });
    await processUncfgScan(deps, { data: { jobId: row.id, oltId } } as Job<UncfgScanJobData>).catch(() => undefined);
    return db.prisma.job.findUniqueOrThrow({ where: { id: row.id } });
  };

  it('keeps the unregistered ONUs on the job; only the one read command is sent', async () => {
    const since = mock.log.lastSeq;
    const done = await runScan();
    expect(done.status).toBe('succeeded');
    const onus = (done.result as { onus: { slot: number; port: number; sn: string }[] }).onus;
    expect(onus.map((o) => o.sn)).toEqual(mock.olt.seed.uncfg.map((u) => u.sn));
    expect(onus.length).toBeGreaterThan(0);
    expect(mock.log.entries('ssh-command', since).map((c) => c.command).filter((c) => c !== 'exit')).toEqual(['show gpon onu uncfg']);
  });

  it('"No related information" (%Code) is an empty list, not an error', async () => {
    const saved = mock.olt.seed.uncfg.splice(0);
    try {
      expect(await runScan()).toMatchObject({ status: 'succeeded', result: { onus: [] } });
    } finally {
      mock.olt.seed.uncfg.push(...saved);
    }
  });

  it('no session (VTY full) -> failed cli_unavailable with the reason, the last screen text and the SSH trace, without credentials', async () => {
    mock.runner.run('vty-full');
    const done = await runScan();
    expect(done).toMatchObject({ status: 'failed', result: { error: 'cli_unavailable', reason: 'closed before prompt', screen: expect.stringContaining('%Error 40014') } });
    expect((done.result as { trace: string[] }).trace.some((l) => l.endsWith('auth: accepted'))).toBe(true);
    expect(JSON.stringify(done.result)).not.toContain(MOCK_CLI.password);
    expect(JSON.stringify(done.result)).not.toContain(MOCK_CLI.username);
  });
});

describe('any OLT hostname (the C320 at jangli answers "OLT-DUD@JGL#")', () => {
  let named: RunningMock;
  beforeAll(async () => {
    named = (await startTestMock({ MOCK_PROMPT: 'OLT-DUD@JGL', MOCK_PAGE_LINES: '10' })).mock;
  });
  afterAll(async () => named?.stop());

  it('logs in and reads multi-page output up to that prompt, which is not part of the output', async () => {
    const s = new OltCliSession(target({ port: named.ssh.port!, hostKeyPins: [named.identity.hostKeyFingerprint] }), guard, { connectTimeoutMs: 3000 });
    await s.open('read');
    const out = await s.run(showOnuState({ slot: 1, port: 1 }));
    expect(out.split('\n').filter((l) => l.startsWith('gpon-onu_1/1/1:'))).toHaveLength(named.olt.onPort({ slot: 1, port: 1 }).length);
    expect(out).not.toContain('OLT-DUD@JGL');
    expect(await s.run(showCard())).toMatch(/^Rack Shelf Slot/);
    await s.close();
  });

  it('an uncfg scan succeeds (it failed with cli_unavailable "no prompt" on the real OLT)', async () => {
    await db.prisma.olt.update({ where: { id: oltId }, data: { identities: { updateMany: { where: { kind: 'ssh_hostkey' }, data: { value: named.identity.hostKeyFingerprint } } } } });
    const row = await db.prisma.job.create({ data: { oltId, kind: 'uncfg_scan', params: {}, status: 'confirmed' } });
    await processUncfgScan({ ...deps, sshPort: () => named.ssh.port! }, { data: { jobId: row.id, oltId } } as Job<UncfgScanJobData>);
    const done = await db.prisma.job.findUniqueOrThrow({ where: { id: row.id } });
    expect(done.status).toBe('succeeded');
    expect((done.result as { onus: { sn: string }[] }).onus.map((o) => o.sn)).toEqual(named.olt.seed.uncfg.map((u) => u.sn));
  });
});
