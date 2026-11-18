import { startTestDatabase, type TestDatabase } from '@olt/db/testing';
import { MOCK_CLI, MOCK_SNMP_V3 } from '@olt/shared';
import { credentialAad, sealEnvelope } from '@olt/shared/crypto';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { type RunningMock, startTestMock } from 'mock-olt/testing';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { enqueueOnuDetail } from '../src/cli/jobs/onu-detail.js';
import { CredentialDecryptor } from '../src/crypto/credential.decryptor.js';
import { MemoryEventPublisher } from '../src/events/publisher.js';
import { TargetGuard } from '../src/guards/target.guard.js';
import { TelegramOutbox } from '../src/notify/telegram.outbox.js';
import { OltRunner } from '../src/runner/olt-runner.js';
import { OltQueues } from '../src/scheduler/olt-queues.js';

let db: TestDatabase;
let redis: StartedRedisContainer;
let mock: RunningMock;
let telegram: Server;
let messages: string[] = [];
let runner: OltRunner;
let queues: OltQueues;
let oltId: number;
let snmpPort: number;
const keys = generateKeyPairSync('rsa', { modulusLength: 3072, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const seal = (name: string, field: 'snmp' | 'cli', v: unknown) => new Uint8Array(sealEnvelope(keys.publicKey, Buffer.from(JSON.stringify(v)), credentialAad(name, field)));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (what: string, test: () => Promise<boolean>, ms = 20_000) => {
  const deadline = Date.now() + ms;
  while (!(await test())) {
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${what}`);
    await sleep(200);
  }
};

beforeAll(async () => {
  [db, redis] = await Promise.all([startTestDatabase(), new RedisContainer('redis:7.4-alpine').start()]);
  telegram = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      messages.push((JSON.parse(raw) as { text: string }).text);
      res.writeHead(200).end('{"ok":true}');
    });
  });
  await new Promise<void>((r) => telegram.listen(0, '127.0.0.1', () => r()));
}, 180_000);
afterAll(async () => {
  telegram?.close();
  await Promise.all([db?.stop(), redis?.stop()]);
});

async function setup() {
  const t = await startTestMock();
  mock = t.mock;
  snmpPort = t.config.MOCK_SNMP_PORT;
  messages = [];
  await db.prisma.olt.deleteMany();
  await db.prisma.notification.deleteMany();
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
      statusIntervalS: 1,
      identities: {
        create: [
          { kind: 'snmp_engine_id', value: mock.identity.engineId, status: 'pinned' },
          { kind: 'ssh_hostkey', value: mock.identity.hostKeyFingerprint, status: 'pinned' },
        ],
      },
    },
  });
  oltId = olt.id;
  const opts = { connection: { host: redis.getHost(), port: redis.getPort() }, prefix: `t-${randomUUID()}` };
  const deps = {
    prisma: db.prisma,
    decryptor: CredentialDecryptor.fromPem(keys.privateKey),
    guard: new TargetGuard(['127.0.0.1/32'], ['127.0.0.1/32']),
    publisher: new MemoryEventPublisher(),
    now: () => new Date(),
    snmpPort: () => snmpPort,
    sshPort: () => mock.ssh.port!,
    snmpTimeoutMs: 500,
    retryDelaysMs: [50],
  };
  runner = new OltRunner({
    ...opts,
    deps,
    uiBaseUrl: 'https://olt.example.test',
    outbox: new TelegramOutbox(db.prisma, { apiBase: `http://127.0.0.1:${(telegram.address() as AddressInfo).port}`, token: '1:fake-token-for-quarantine-tests', chatId: '-1', mergeWindowMs: 300 }),
    outboxMs: 200,
    reconcileMs: 500,
    log: { info: () => undefined, error: () => undefined },
  });
  queues = new OltQueues(opts);
  await runner.start();
  await until('first poll', async () => (await db.prisma.pollRun.count({ where: { oltId, ok: true } })) > 0);
  return deps;
}

afterEach(async () => {
  await runner?.stop();
  await queues?.close();
  await mock?.stop();
});

const status = async () => (await db.prisma.olt.findUniqueOrThrow({ where: { id: oltId } })).status;

/** SPEC §14 B12: OLT quarantined -> no SNMP request reaches the mock for 2 cycles. */
async function expectSilence() {
  await sleep(500);
  const since = mock.log.lastSeq;
  await sleep(2500); // > 2 status cycles of 1 s
  expect(mock.log.entries(undefined, since).filter((e) => e.kind.startsWith('snmp'))).toHaveLength(0);
  expect(await queues.schedulers(oltId)).toHaveLength(0);
}

describe('quarantine (H2, SPEC §14 B12-B13)', () => {
  it('hostkey-rotate + refresh: dropped before auth, quarantined, 1 security message, SNMP silent', async () => {
    const deps = await setup();
    mock.runner.run('hostkey-rotate');
    await sleep(200);
    const since = mock.log.lastSeq;
    const onu = await db.prisma.onu.findFirstOrThrow({ where: { oltId } });
    await enqueueOnuDetail(deps, queues, onu.id);

    await until('quarantine', async () => (await status()) === 'quarantined');
    expect(mock.log.entries('ssh-auth', since)).toHaveLength(0);
    expect(await db.prisma.securityEvent.count({ where: { oltId, kind: 'identity_mismatch' } })).toBe(1);
    expect(await db.prisma.alarm.count({ where: { oltId, kind: 'olt_identity_mismatch', state: 'active' } })).toBe(1);
    expect((await db.prisma.oltIdentity.findFirstOrThrow({ where: { oltId, kind: 'ssh_hostkey', status: 'candidate' } })).value).toBe(mock.identity.hostKeyFingerprint);
    await until('telegram', async () => messages.length > 0);
    await expectSilence();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/KEAMANAN: identitas OLT mock-1 berubah \(host key SSH\)/);
  }, 40_000);

  it('engineid-change: same result via the status poll', async () => {
    await setup();
    mock.runner.run('engineid-change');
    await until('quarantine', async () => (await status()) === 'quarantined');
    expect((await db.prisma.oltIdentity.findFirstOrThrow({ where: { oltId, kind: 'snmp_engine_id', status: 'candidate' } })).value).toBe(mock.identity.engineId);
    await until('telegram', async () => messages.length > 0);
    await expectSilence();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/engine ID SNMPv3/);
  }, 40_000);

  it('after the change is accepted, polling resumes', async () => {
    await setup();
    mock.runner.run('engineid-change');
    await until('quarantine', async () => (await status()) === 'quarantined');
    // What POST /olts/:id/identity/accept-change does (api test covers the endpoint itself).
    await db.prisma.oltIdentity.updateMany({ where: { oltId, kind: 'snmp_engine_id', status: 'pinned' }, data: { status: 'retired' } });
    await db.prisma.oltIdentity.updateMany({ where: { oltId, kind: 'snmp_engine_id', status: 'candidate' }, data: { status: 'pinned' } });
    await db.prisma.olt.update({ where: { id: oltId }, data: { status: 'ok' } });
    const before = await db.prisma.pollRun.count({ where: { oltId, ok: true } });
    await until('polling again', async () => (await db.prisma.pollRun.count({ where: { oltId, ok: true } })) > before);
    expect(await status()).toBe('ok');
  }, 40_000);

  it('SNMPv3 auth failing 2 cycles in a row -> quarantine (SPEC §2.2 no. 11)', async () => {
    await setup();
    await db.prisma.olt.update({ where: { id: oltId }, data: { snmpCredEnc: seal('mock-1', 'snmp', { ...MOCK_SNMP_V3, authKey: 'wrong-auth-key-000' }) } });
    await until('quarantine', async () => (await status()) === 'quarantined');
    expect(await db.prisma.securityEvent.count({ where: { oltId, kind: 'snmp_auth_failure' } })).toBe(1);
    const runs = await db.prisma.pollRun.findMany({ where: { oltId, kind: 'status' }, orderBy: { id: 'desc' }, take: 2 });
    expect(runs.map((r) => r.error)).toEqual(['SnmpAuthError', 'SnmpAuthError']);
  }, 40_000);
});
