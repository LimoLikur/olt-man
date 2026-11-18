import { startTestDatabase, type TestDatabase } from '@olt/db/testing';
import { MOCK_SNMP_V3 } from '@olt/shared';
import { credentialAad, sealEnvelope } from '@olt/shared/crypto';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { type RunningMock, startTestMock } from 'mock-olt/testing';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { oltQueueName } from '@olt/shared/jobs';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CredentialDecryptor } from '../src/crypto/credential.decryptor.js';
import { MemoryEventPublisher } from '../src/events/publisher.js';
import { TargetGuard } from '../src/guards/target.guard.js';
import { TelegramOutbox } from '../src/notify/telegram.outbox.js';
import { OltRunner } from '../src/runner/olt-runner.js';

let db: TestDatabase;
let redis: StartedRedisContainer;
let mock: RunningMock;
let runner: OltRunner;
let telegram: Server;
const messages: string[] = [];
const PREFIX = `t-${randomUUID()}`;
const keys = generateKeyPairSync('rsa', { modulusLength: 3072, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });

const until = async (what: string, test: () => Promise<boolean>, ms = 20_000) => {
  const deadline = Date.now() + ms;
  while (!(await test())) {
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

beforeAll(async () => {
  [db, redis] = await Promise.all([startTestDatabase(), new RedisContainer('redis:7.4-alpine').start()]);
  const t = await startTestMock();
  mock = t.mock;
  telegram = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      messages.push((JSON.parse(raw) as { text: string }).text);
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    });
  });
  await new Promise<void>((r) => telegram.listen(0, '127.0.0.1', () => r()));

  await db.prisma.olt.create({
    data: {
      name: 'mock-1',
      mgmtIp: '127.0.0.1',
      isMock: true,
      oidProfile: 'zte-c320-v2.1',
      snmpVersion: 'v3',
      snmpCredEnc: new Uint8Array(sealEnvelope(keys.publicKey, Buffer.from(JSON.stringify(MOCK_SNMP_V3)), credentialAad('mock-1', 'snmp'))),
      status: 'ok',
      statusIntervalS: 2, // fast for the test; the api enforces >= 30
      identities: { create: { kind: 'snmp_engine_id', value: mock.identity.engineId, status: 'pinned' } },
    },
  });
  // A second OLT that is not pinned yet must never be polled.
  await db.prisma.olt.create({
    data: { name: 'mock-new', mgmtIp: '127.0.0.1', isMock: true, oidProfile: 'zte-c320-v2.1', snmpVersion: 'v3', snmpCredEnc: new Uint8Array([0]), status: 'pending_pin' },
  });

  const prisma = db.prisma;
  runner = new OltRunner({
    connection: { host: redis.getHost(), port: redis.getPort() },
    prefix: PREFIX,
    deps: {
      prisma,
      decryptor: CredentialDecryptor.fromPem(keys.privateKey),
      guard: new TargetGuard(['127.0.0.1/32'], ['127.0.0.1/32']),
      publisher: new MemoryEventPublisher(),
      now: () => new Date(),
      snmpPort: () => t.config.MOCK_SNMP_PORT,
      snmpTimeoutMs: 500,
    },
    uiBaseUrl: 'https://olt.example.test',
    outbox: new TelegramOutbox(prisma, { apiBase: `http://127.0.0.1:${(telegram.address() as AddressInfo).port}`, token: '1:fake-token-for-runner-test-xx', chatId: '-1', mergeWindowMs: 1000 }),
    outboxMs: 300,
    reconcileMs: 1000,
    log: { info: () => undefined, error: () => undefined },
  });
  await runner.start();
}, 180_000);

afterAll(async () => {
  await runner?.stop();
  telegram?.close();
  await mock?.stop();
  await Promise.all([db?.stop(), redis?.stop()]);
});

describe('OltRunner end to end (scheduler -> poll -> DB -> alarms -> Telegram)', () => {
  it('polls the pinned mock into the database on schedule', async () => {
    await until('onu_state for every ONU', async () => (await db.prisma.onuState.count()) === mock.olt.onus.length);
    const olt = await db.prisma.olt.findUniqueOrThrow({ where: { name: 'mock-1' } });
    expect(olt.lastPollOkAt).not.toBeNull();
  });

  it('never polls the pending_pin OLT', async () => {
    const pending = await db.prisma.olt.findUniqueOrThrow({ where: { name: 'mock-new' } });
    expect(await db.prisma.pollRun.count({ where: { oltId: pending.id } })).toBe(0);
  });

  it('los-mass -> one mass alarm and exactly one Telegram message; reset -> one recovery message', async () => {
    mock.runner.run('los-mass');
    await until('mass alarm', async () => (await db.prisma.alarm.count({ where: { kind: 'pon_mass_los', state: 'active' } })) === 1);
    await until('telegram message', async () => messages.length >= 1);
    await new Promise((r) => setTimeout(r, 5000)); // more cycles must not add messages
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/LOS massal di mock-1 port 1\/1\/1: 5 ONU/);

    mock.runner.run('reset');
    await until('recovery', async () => messages.length === 2);
    expect(messages[1]).toMatch(/Pulih: LOS massal/);
  }, 40_000);

  it('picks up a status change made elsewhere (e.g. the api disabling an OLT)', async () => {
    const olt = await db.prisma.olt.update({ where: { name: 'mock-1' }, data: { status: 'disabled' } });
    await new Promise((r) => setTimeout(r, 2500)); // reconcile
    const before = await db.prisma.pollRun.count({ where: { oltId: olt.id } });
    await new Promise((r) => setTimeout(r, 4500));
    expect(await db.prisma.pollRun.count({ where: { oltId: olt.id } })).toBe(before);
  }, 20_000);

  it('an OLT deleted by the api: its schedulers are gone from Redis within one reconcile', async () => {
    // statusIntervalS is large and the credential unusable: no poll of this row reaches the mock.
    const olt = await db.prisma.olt.create({
      data: { name: 'mock-gone', mgmtIp: '127.0.0.1', isMock: true, oidProfile: 'zte-c320-v2.1', snmpVersion: 'v3', snmpCredEnc: new Uint8Array([0]), status: 'ok', statusIntervalS: 3600 },
    });
    const q = new Queue(oltQueueName(olt.id), { connection: { host: redis.getHost(), port: redis.getPort() }, prefix: PREFIX });
    await until('schedulers for the new OLT', async () => (await q.getJobSchedulers()).length === 2);
    // The row goes without the api's obliterate: the worst case of a stale reconcile.
    await db.prisma.olt.delete({ where: { id: olt.id } });
    await until('schedulers removed', async () => (await q.getJobSchedulers()).length === 0, 5000);
    await q.close();
  }, 20_000);
});
