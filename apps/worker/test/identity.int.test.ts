import { startTestDatabase, type TestDatabase } from '@olt/db/testing';
import { MOCK_CLI, MOCK_SNMP_COMMUNITY, MOCK_SNMP_V3 } from '@olt/shared';
import { credentialAad, sealEnvelope } from '@olt/shared/crypto';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import type { Job } from 'bullmq';
import { type RunningMock, startTestMock } from 'mock-olt/testing';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { type AddressInfo, connect, createServer, type Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CredentialDecryptor } from '../src/crypto/credential.decryptor.js';
import { MemoryEventPublisher } from '../src/events/publisher.js';
import { TargetGuard, TargetNotAllowedError } from '../src/guards/target.guard.js';
import { type IdentityProbeJobData, processIdentityProbe, type ProbeDeps } from '../src/identity/probe.js';
import { sysInfoValue } from '../src/identity/snmp-identity.js';
import { OltRunner } from '../src/runner/olt-runner.js';
import { OltQueues } from '../src/scheduler/olt-queues.js';

let db: TestDatabase;
let redis: StartedRedisContainer;
let mock: RunningMock;
let deps: ProbeDeps;
const keys = generateKeyPairSync('rsa', { modulusLength: 3072, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const seal = (name: string, field: 'snmp' | 'cli', v: unknown) => new Uint8Array(sealEnvelope(keys.publicKey, Buffer.from(JSON.stringify(v)), credentialAad(name, field)));

beforeAll(async () => {
  [db, redis] = await Promise.all([startTestDatabase(), new RedisContainer('redis:7.4-alpine').start()]);
  const t = await startTestMock();
  mock = t.mock;
  deps = {
    prisma: db.prisma,
    decryptor: CredentialDecryptor.fromPem(keys.privateKey),
    guard: new TargetGuard(['127.0.0.1/32'], ['127.0.0.1/32']),
    publisher: new MemoryEventPublisher(),
    now: () => new Date(),
    snmpPort: () => t.config.MOCK_SNMP_PORT,
    sshPort: () => mock.ssh.port!,
    snmpTimeoutMs: 500,
  };
}, 180_000);
afterAll(async () => {
  await mock?.stop();
  await Promise.all([db?.stop(), redis?.stop()]);
});

async function newOlt(name: string, snmp: unknown, version: 'v3' | 'v2c') {
  const olt = await db.prisma.olt.create({
    data: { name, mgmtIp: '127.0.0.1', isMock: true, oidProfile: 'zte-c320-v2.1', snmpVersion: version, snmpCredEnc: seal(name, 'snmp', snmp), cliEnabled: true, cliCredEnc: seal(name, 'cli', MOCK_CLI), statusIntervalS: 2 },
  });
  const job = await db.prisma.job.create({ data: { oltId: olt.id, kind: 'identity_probe', params: {}, status: 'confirmed' } });
  return { olt, job };
}
const probe = (oltId: number, jobId: number) => processIdentityProbe(deps, { data: { oltId, jobId } } as Job<IdentityProbeJobData>);

describe('identity.probe (H1)', () => {
  it('a new OLT starts in pending_pin; the probe finds the mock host key and engine ID with 0 auth attempts', async () => {
    const { olt, job } = await newOlt('probe-v3', MOCK_SNMP_V3, 'v3');
    expect(olt.status).toBe('pending_pin');
    const since = mock.log.lastSeq;
    await probe(olt.id, job.id);
    const candidates = await db.prisma.oltIdentity.findMany({ where: { oltId: olt.id, status: 'candidate' } });
    expect(new Map(candidates.map((c) => [c.kind, c.value]))).toEqual(
      new Map([
        ['snmp_engine_id', mock.identity.engineId],
        ['ssh_hostkey', mock.identity.hostKeyFingerprint],
      ]),
    );
    expect(mock.log.entries('ssh-connect', since).length).toBeGreaterThan(0);
    expect(mock.log.entries('ssh-auth', since)).toHaveLength(0);
    expect((await db.prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('succeeded');
    expect((await db.prisma.olt.findUniqueOrThrow({ where: { id: olt.id } })).firmware).toMatch(/C320/);
  });

  it('v2c: candidate is sysName|sysObjectID', async () => {
    const { olt, job } = await newOlt('probe-v2', { version: 'v2c', community: MOCK_SNMP_COMMUNITY }, 'v2c');
    await probe(olt.id, job.id);
    const c = await db.prisma.oltIdentity.findFirstOrThrow({ where: { oltId: olt.id, kind: 'snmp_sysinfo' } });
    expect(c.value).toBe(sysInfoValue({ sysName: 'mock-1', sysObjectId: mock.olt.seed.sysObjectId }));
  });

  it('waits for a slow key exchange like a C320 (about 16 s), not just 10 s', async () => {
    // A proxy in front of the mock holds back everything the OLT sends for 11 s.
    const sockets: Socket[] = [];
    const proxy = createServer((client) => {
      const upstream = connect(mock.ssh.port!, '127.0.0.1');
      sockets.push(client, upstream);
      const held: Buffer[] = [];
      let open = false;
      client.on('data', (d) => upstream.write(d));
      upstream.on('data', (d: Buffer) => (open ? client.write(d) : held.push(d)));
      setTimeout(() => {
        open = true;
        for (const d of held) client.write(d);
      }, 11_000);
      for (const [a, b] of [[client, upstream], [upstream, client]] as const) {
        a.on('error', () => b.destroy());
        a.on('close', () => b.destroy());
      }
    });
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
    try {
      const { olt, job } = await newOlt('probe-slow-kex', MOCK_SNMP_V3, 'v3');
      const slow = { ...deps, sshPort: () => (proxy.address() as AddressInfo).port };
      await processIdentityProbe(slow, { data: { oltId: olt.id, jobId: job.id } } as Job<IdentityProbeJobData>);
      expect(await db.prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: 'succeeded', result: { errors: [] } });
      expect((await db.prisma.oltIdentity.findMany({ where: { oltId: olt.id, status: 'candidate' } })).map((c) => c.kind).sort()).toEqual(['snmp_engine_id', 'ssh_hostkey']);
    } finally {
      sockets.forEach((s) => s.destroy());
      await new Promise((r) => proxy.close(r));
    }
  }, 40_000);

  it('an address outside OLT_TARGET_CIDRS fails the job with its reason instead of leaving it "running"', async () => {
    const { olt, job } = await newOlt('probe-outside', MOCK_SNMP_V3, 'v3');
    // TEST-NET-1: outside the guard's 127.0.0.1/32, so no socket is ever opened.
    await db.prisma.olt.update({ where: { id: olt.id }, data: { mgmtIp: '192.0.2.10' } });
    await expect(probe(olt.id, job.id)).rejects.toBeInstanceOf(TargetNotAllowedError);
    expect(await db.prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: 'failed', result: { candidates: [], confirmed: [], errors: ['target_not_allowed'] } });
    expect(await db.prisma.oltIdentity.count({ where: { oltId: olt.id } })).toBe(0);
  });

  it('pending_pin has no scheduler; after the pin the runner creates them', async () => {
    const { olt, job } = await newOlt('probe-pin', MOCK_SNMP_V3, 'v3');
    await probe(olt.id, job.id);
    const opts = { connection: { host: redis.getHost(), port: redis.getPort() }, prefix: `t-${randomUUID()}` };
    const runner = new OltRunner({ ...opts, deps: { ...deps }, uiBaseUrl: 'https://x', reconcileMs: 500, log: { info: () => undefined, error: () => undefined } });
    const inspect = new OltQueues(opts);
    await runner.start();
    expect(await inspect.schedulers(olt.id)).toHaveLength(0);
    expect(await db.prisma.pollRun.count({ where: { oltId: olt.id } })).toBe(0);

    // What POST /olts/:id/identity/pin does (api test covers the endpoint).
    await db.prisma.oltIdentity.updateMany({ where: { oltId: olt.id, status: 'candidate' }, data: { status: 'pinned', pinnedAt: new Date() } });
    await db.prisma.olt.update({ where: { id: olt.id }, data: { status: 'ok' } });
    await new Promise((r) => setTimeout(r, 1500));
    expect((await inspect.schedulers(olt.id)).map((s) => s.key).sort()).toEqual(['poll.optical', 'poll.status']);
    await new Promise((r) => setTimeout(r, 3000));
    expect(await db.prisma.pollRun.count({ where: { oltId: olt.id, ok: true } })).toBeGreaterThan(0);
    await runner.stop();
    await inspect.close();
  }, 20_000);
});

describe('identity.probe on a pinned OLT (CLI switched on later)', () => {
  /** SNMP pinned and polled (status ok), CLI on but no host key pinned yet: the real OLT after the laptop runbook. */
  async function pinnedOlt(name: string, hostKey?: string) {
    const { olt, job } = await newOlt(name, MOCK_SNMP_V3, 'v3');
    await db.prisma.olt.update({ where: { id: olt.id }, data: { status: 'ok' } });
    await db.prisma.oltIdentity.create({ data: { oltId: olt.id, kind: 'snmp_engine_id', value: mock.identity.engineId.toUpperCase(), status: 'pinned', pinnedAt: new Date() } });
    if (hostKey) await db.prisma.oltIdentity.create({ data: { oltId: olt.id, kind: 'ssh_hostkey', value: hostKey, status: 'pinned', pinnedAt: new Date() } });
    return { olt, job };
  }
  const rows = (oltId: number) => db.prisma.oltIdentity.findMany({ where: { oltId }, orderBy: { id: 'asc' } });

  it('the matching engine ID is confirmed, not offered again; only the host key becomes a candidate', async () => {
    const { olt, job } = await pinnedOlt('probe-cli-on');
    await probe(olt.id, job.id);
    const candidates = (await rows(olt.id)).filter((r) => r.status === 'candidate');
    expect(candidates.map((c) => [c.kind, c.value, c.algo])).toEqual([['ssh_hostkey', mock.identity.hostKeyFingerprint, 'ssh-ed25519']]);
    const done = await db.prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(done).toMatchObject({ status: 'succeeded', result: { confirmed: ['snmp_engine_id'], errors: [] } });
    expect((await db.prisma.olt.findUniqueOrThrow({ where: { id: olt.id } })).status).toBe('ok');
  });

  it('a pinned host key that no longer matches quarantines the OLT (rule 7) instead of offering a candidate to "pin"', async () => {
    const { olt, job } = await pinnedOlt('probe-hk-changed', 'SHA256:' + 'E'.repeat(43));
    const since = mock.log.lastSeq;
    await probe(olt.id, job.id);
    expect((await db.prisma.olt.findUniqueOrThrow({ where: { id: olt.id } })).status).toBe('quarantined');
    expect(await db.prisma.securityEvent.count({ where: { oltId: olt.id, kind: 'identity_mismatch' } })).toBe(1);
    expect((await rows(olt.id)).filter((r) => r.status === 'candidate').map((r) => [r.kind, r.reason])).toEqual([['ssh_hostkey', 'observed at mismatch']]);
    expect(await db.prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: 'blocked', result: { error: 'identity_mismatch', kind: 'ssh_hostkey' } });
    expect(mock.log.entries('ssh-auth', since)).toHaveLength(0);
  });

  it('a different engine ID quarantines before SSH is even contacted', async () => {
    const { olt, job } = await newOlt('probe-eid-changed', MOCK_SNMP_V3, 'v3');
    await db.prisma.olt.update({ where: { id: olt.id }, data: { status: 'ok' } });
    await db.prisma.oltIdentity.create({ data: { oltId: olt.id, kind: 'snmp_engine_id', value: '80000f3e05000000000000', status: 'pinned', pinnedAt: new Date() } });
    const since = mock.log.lastSeq;
    await probe(olt.id, job.id);
    expect((await db.prisma.olt.findUniqueOrThrow({ where: { id: olt.id } })).status).toBe('quarantined');
    expect(mock.log.entries('ssh-connect', since)).toHaveLength(0);
  });

  it('without the OLT algorithms the probe names the failed SSH step; with them it finds the RSA key', async () => {
    const legacy = (await startTestMock({ MOCK_SSH_PROFILE: 'legacy' })).mock;
    try {
      const d: ProbeDeps = { ...deps, sshPort: () => legacy.ssh.port! };
      const { olt, job } = await pinnedOlt('probe-legacy');
      await processIdentityProbe(d, { data: { oltId: olt.id, jobId: job.id } } as Job<IdentityProbeJobData>);
      expect(await db.prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ result: { candidates: [], errors: ['ssh:negotiation: no matching C->S cipher'] } });

      await db.prisma.olt.update({ where: { id: olt.id }, data: { sshAlgorithms: { cipher: ['aes128-cbc'] } } });
      const again = await db.prisma.job.create({ data: { oltId: olt.id, kind: 'identity_probe', params: {}, status: 'confirmed' } });
      await processIdentityProbe(d, { data: { oltId: olt.id, jobId: again.id } } as Job<IdentityProbeJobData>);
      const c = await db.prisma.oltIdentity.findFirstOrThrow({ where: { oltId: olt.id, status: 'candidate' } });
      expect([c.kind, c.value, c.algo]).toEqual(['ssh_hostkey', legacy.identity.hostKeyFingerprint, 'ssh-rsa']);
      expect(legacy.log.entries('ssh-auth')).toHaveLength(0);
    } finally {
      await legacy.stop();
    }
  });
});
