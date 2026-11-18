import { describe, expect, it } from 'vitest';
import { apiEnvSchema, EnvValidationError, parseEnv, workerEnvSchema } from './env.js';

const valid = {
  APP_TIMEZONE: 'Asia/Jakarta',
  DATABASE_URL: 'postgresql://app:fake-password@postgres:5432/olt',
  REDIS_URL: 'redis://redis:6379',
};

describe('parseEnv', () => {
  it('accepts a valid api env and applies defaults', () => {
    expect(parseEnv(apiEnvSchema, { ...valid, ADMIN_ALLOWED_CIDRS: '192.168.1.0/24' })).toMatchObject({
      PORT: 3000,
      APP_TIMEZONE: 'Asia/Jakarta',
      ADMIN_ALLOWED_CIDRS: ['192.168.1.0/24'],
      SESSION_IDLE_MINUTES: 30,
      SESSION_MAX_HOURS: 12,
    });
  });

  it('requires ADMIN_ALLOWED_CIDRS for the api (fail closed, rule 8)', () => {
    expect(() => parseEnv(apiEnvSchema, valid)).toThrow(/ADMIN_ALLOWED_CIDRS/);
  });

  it('parses CIDR lists for the worker and rejects hostnames or empty lists', () => {
    const w = { ...valid, OLT_TARGET_CIDRS: '172.30.0.0/24, 10.20.0.5/32', MOCK_OLT_CIDRS: '172.30.0.0/24', OLT_CRED_PRIVATE_KEY_FILE: '/run/secrets/olt_cred_key' };
    expect(parseEnv(workerEnvSchema, w).OLT_TARGET_CIDRS).toEqual(['172.30.0.0/24', '10.20.0.5/32']);
    expect(() => parseEnv(workerEnvSchema, { ...w, OLT_TARGET_CIDRS: 'olt.example.com' })).toThrow(/OLT_TARGET_CIDRS/);
    expect(() => parseEnv(workerEnvSchema, { ...w, MOCK_OLT_CIDRS: '' })).toThrow(/MOCK_OLT_CIDRS/);
  });

  it('treats an empty TELEGRAM_BOT_TOKEN as unset', () => {
    const w = { ...valid, OLT_TARGET_CIDRS: '172.30.0.0/24', MOCK_OLT_CIDRS: '172.30.0.0/24', OLT_CRED_PRIVATE_KEY_FILE: '/k', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' };
    expect(parseEnv(workerEnvSchema, w).TELEGRAM_BOT_TOKEN).toBeUndefined();
  });

  it.each([undefined, '', 'Mars/Olympus'])('rejects APP_TIMEZONE=%s', (tz) => {
    expect(() => parseEnv(apiEnvSchema, { ...valid, APP_TIMEZONE: tz })).toThrow(/APP_TIMEZONE/);
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => parseEnv(apiEnvSchema, { ...valid, ADMIN_ALLOWED_CIDRS: '10.0.0.0/8', DATABASE_URL: 'mysql://x/y' })).toThrow(/DATABASE_URL/);
  });

  it('never echoes values in the error', () => {
    try {
      parseEnv(apiEnvSchema, { ...valid, DATABASE_URL: 'not a url fake-password' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvValidationError);
      expect((e as Error).message).not.toContain('fake-password');
    }
  });
});
