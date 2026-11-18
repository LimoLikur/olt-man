import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { startTestDatabase, type TestDatabase } from '@olt/db/testing';
import { apiEnvSchema, type ApiEnv } from '@olt/shared';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { hash } from '@node-rs/argon2';
import { generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import type { Clock } from '../src/common/tokens.js';

export const ORIGIN = 'https://localhost';
export const PASSWORDS = { admin: 'fake-admin-password-1', noc: 'fake-noc-password-12', teknisi: 'fake-teknisi-pass-123' } as const;

/** Unit-test config: nothing is contacted until a query runs. */
export const testConfig = (over: Partial<Record<string, string>> = {}): ApiEnv =>
  apiEnvSchema.parse({
    APP_TIMEZONE: 'Asia/Jakarta',
    DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
    REDIS_URL: 'redis://127.0.0.1:1',
    ADMIN_ALLOWED_CIDRS: '192.168.10.0/24',
    APP_ORIGINS: ORIGIN,
    ...over,
  });

/** A clock the test moves by hand. */
export class FakeClock implements Clock {
  offsetMs = 0;
  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }
  advance(ms: number): void {
    this.offsetMs += ms;
  }
}

export const testKeys = generateKeyPairSync('rsa', {
  modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

export interface TestApi {
  base: string;
  app: NestExpressApplication;
  db: TestDatabase;
  redis: StartedRedisContainer;
  clock: FakeClock;
  stop(): Promise<void>;
}

export async function startTestApi(over: Partial<Record<string, string>> = {}): Promise<TestApi> {
  const [db, redis] = await Promise.all([startTestDatabase(), new RedisContainer('redis:7.4-alpine').start()]);
  for (const role of ['admin', 'noc', 'teknisi'] as const) {
    await db.prisma.user.create({ data: { username: role, role, passwordHash: await hash(PASSWORDS[role]) } });
  }
  const clock = new FakeClock();
  const config = testConfig({ DATABASE_URL: db.url, REDIS_URL: redis.getConnectionUrl(), OLT_CRED_PUBLIC_KEY: testKeys.publicKey, ...over });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config, clock)] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api`;
  return {
    base,
    app,
    db,
    redis,
    clock,
    async stop() {
      await app.close();
      await Promise.all([db.stop(), redis.stop()]);
    },
  };
}

export interface Client {
  cookie?: string;
  /** X-Forwarded-For as caddy would set it (one trusted hop). */
  ip?: string;
}

export interface CallResult {
  status: number;
  headers: globalThis.Headers;
  body: unknown;
}

export async function call(t: TestApi, c: Client, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<CallResult> {
  const res = await fetch(`${t.base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(method === 'GET' ? {} : { origin: ORIGIN }),
      ...(c.cookie ? { cookie: c.cookie } : {}),
      ...(c.ip ? { 'x-forwarded-for': c.ip } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? (JSON.parse(text) as unknown) : undefined };
}

export async function login(t: TestApi, role: keyof typeof PASSWORDS, ip = '192.168.10.20'): Promise<Client> {
  const res = await call(t, { ip }, 'POST', '/auth/login', { username: role, password: PASSWORDS[role] });
  if (res.status !== 200) throw new Error(`login ${role} failed: ${res.status}`);
  const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
  return { cookie, ip };
}
