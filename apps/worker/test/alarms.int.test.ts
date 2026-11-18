import { startTestDatabase, type TestDatabase } from '@olt/db/testing';
import { MOCK_SNMP_V3 } from '@olt/shared';
import { credentialAad, sealEnvelope } from '@olt/shared/crypto';
import { type RunningMock, startTestMock } from 'mock-olt/testing';
import { generateKeyPairSync } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { evaluateOlt } from '../src/alarms/alarm.engine.js';
import { CredentialDecryptor } from '../src/crypto/credential.decryptor.js';
import { MemoryEventPublisher } from '../src/events/publisher.js';
import { TargetGuard } from '../src/guards/target.guard.js';
import { TelegramOutbox } from '../src/notify/telegram.outbox.js';
import type { PollerDeps } from '../src/poller/context.js';
import { pollStatus } from '../src/poller/status.js';

const TOKEN = '123456:fake-telegram-token-for-tests';
let db: TestDatabase;
let mock: RunningMock;
let deps: PollerDeps;
let oltId: number;
let clock = 0; // offset added to the real time (fake clock for merge windows)
let telegram: Server;
let apiBase: string;
let received: { path: string; body: { chat_id: string; text: string } }[] = [];
let hold: Promise<void> | undefined; // when set, the fake Telegram answers only after it resolves

const keys = generateKeyPairSync('rsa', { modulusLength: 3072, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const now = () => new Date(Date.now() + clock);

beforeAll(async () => {
  db = await startTestDatabase();
  const t = await startTestMock();
  mock = t.mock;
  deps = {
    prisma: db.prisma,
    decryptor: CredentialDecryptor.fromPem(keys.privateKey),
    guard: new TargetGuard(['127.0.0.1/32'], ['127.0.0.1/32']),
    publisher: new MemoryEventPublisher(),
    now,
    snmpPort: () => t.config.MOCK_SNMP_PORT,
    snmpTimeoutMs: 300,
  };
  telegram = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', async () => {
      received.push({ path: req.url ?? '', body: JSON.parse(raw) as { chat_id: string; text: string } });
      if (hold) await hold;
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    });
  });
  await new Promise<void>((r) => telegram.listen(0, '127.0.0.1', () => r()));
  apiBase = `http://127.0.0.1:${(telegram.address() as AddressInfo).port}`;
}, 180_000);
afterAll(async () => {
  telegram?.close();
  await mock?.stop();
  await db?.stop();
});

beforeEach(async () => {
  mock.runner.run('reset');
  await db.prisma.notification.deleteMany();
  await db.prisma.olt.deleteMany();
  oltId = (
    await db.prisma.olt.create({
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
    })
  ).id;
  received = [];
  hold = undefined;
  clock = 0;
});

const engine = () => evaluateOlt({ prisma: db.prisma, now, uiBaseUrl: 'https://olt.example.test' }, oltId);
const outbox = () => new TelegramOutbox(db.prisma, { apiBase, token: TOKEN, chatId: '-100123', now });
/** Poll + evaluate, then let the 10 s merge window pass and flush. */
async function cycle() {
  await pollStatus(deps, oltId);
  const result = await engine();
  clock += 11_000;
  await outbox().flush();
  return result;
}

describe('alarm engine + Telegram outbox', () => {
  it('los-mass -> 1 pon_mass_los with 5 children and exactly 1 Telegram message', async () => {
    await cycle();
    mock.runner.run('los-mass');
    await cycle();
    await cycle(); // a further cycle must not re-notify

    const alarms = await db.prisma.alarm.findMany({ where: { oltId, state: 'active' } });
    const mass = alarms.filter((a) => a.kind === 'pon_mass_los');
    expect(mass).toHaveLength(1);
    const children = alarms.filter((a) => a.kind === 'onu_los');
    expect(children).toHaveLength(5);
    expect(children.every((c) => c.parentAlarmId === mass[0]!.id)).toBe(true);

    expect(received).toHaveLength(1);
    expect(received[0]!.path).toBe(`/bot${TOKEN}/sendMessage`);
    expect(received[0]!.body).toMatchObject({ chat_id: '-100123' });
    expect(received[0]!.body.text).toMatch(/LOS massal di mock-1 port 1\/1\/1: 5 ONU/);
    expect(received[0]!.body.text).toContain('https://olt.example.test/olts/');
  });

  it('reset -> mass alarm and children clear, one recovery message', async () => {
    await cycle();
    mock.runner.run('los-mass');
    await cycle();
    mock.runner.run('reset');
    await cycle();
    expect(await db.prisma.alarm.count({ where: { oltId, state: 'active' } })).toBe(0);
    expect(received.map((r) => r.body.text.split('\n')[0])).toEqual([expect.stringMatching(/^🔴 LOS massal/), expect.stringMatching(/^✅ Pulih: LOS massal/)]);
  });

  it('onu-los -> onu_los alarm, 0 Telegram messages', async () => {
    await cycle();
    mock.runner.run('onu-los');
    await cycle();
    expect(await db.prisma.alarm.count({ where: { oltId, state: 'active', kind: 'onu_los' } })).toBe(1);
    expect(received).toHaveLength(0);
  });

  it('notifications within 10 s are merged into one message', async () => {
    await db.prisma.notification.createMany({
      data: [1, 2, 3].map((i) => ({ dedupeKey: `test:${i}`, payload: { text: `pesan ${i}` } })),
    });
    expect((await outbox().flush()).waiting).toBe(true); // window still open
    clock += 11_000;
    expect(await outbox().flush()).toMatchObject({ sent: 1, merged: 3 });
    expect(received).toHaveLength(1);
    expect(received[0]!.body.text).toBe('pesan 1\n\npesan 2\n\npesan 3');
  });

  it('a restart in the middle of sending does not send twice', async () => {
    await db.prisma.notification.create({ data: { dedupeKey: 'test:crash', payload: { text: 'sekali saja' } } });
    clock += 11_000;
    let release!: () => void;
    hold = new Promise((r) => (release = r));
    const inflight = outbox().flush(); // Telegram got the request, the worker "dies" before the answer
    while (received.length === 0) await new Promise((r) => setTimeout(r, 10));

    const restarted = outbox();
    expect(await restarted.recover()).toBe(1);
    expect(await restarted.flush()).toMatchObject({ sent: 0 });
    release();
    await inflight;
    clock += 60_000;
    await outbox().flush();
    expect(received).toHaveLength(1);
  });

  it('does not clear alarms it does not own (cli_unavailable, olt_identity_mismatch)', async () => {
    await cycle();
    for (const kind of ['cli_unavailable', 'olt_identity_mismatch'] as const) {
      await db.prisma.alarm.create({ data: { oltId, key: kind, kind, severity: 'info', firstAt: now(), lastAt: now() } });
    }
    await cycle();
    expect(await db.prisma.alarm.count({ where: { oltId, state: 'active', kind: { in: ['cli_unavailable', 'olt_identity_mismatch'] } } })).toBe(2);
  });

  it('the dedupe key keeps a re-run evaluation from queueing a second message', async () => {
    await cycle();
    mock.runner.run('los-mass');
    await pollStatus(deps, oltId);
    await engine();
    await engine();
    expect(await db.prisma.notification.count()).toBe(1);
  });
});
