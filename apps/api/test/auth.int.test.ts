import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, type Client, login, PASSWORDS, startTestApi, type TestApi } from './helpers.js';

let t: TestApi;
beforeAll(async () => {
  t = await startTestApi();
}, 180_000);
afterAll(() => t?.stop());

const audit = (action: string) => t.db.prisma.auditLog.count({ where: { action } });

describe('login and session cookie', () => {
  it('sets an httpOnly, Secure, SameSite=Strict cookie and audits the login', async () => {
    const res = await call(t, { ip: '192.168.10.21' }, 'POST', '/auth/login', { username: 'noc', password: PASSWORDS.noc });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ username: 'noc', role: 'noc' });
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^olt_session=[\w-]{43};/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(await audit('auth.login')).toBeGreaterThan(0);
  });

  it('stores only the hash of the session ID', async () => {
    const c = await login(t, 'noc', '192.168.10.22');
    const id = c.cookie!.split('=')[1]!;
    expect(await t.db.prisma.session.count({ where: { idHash: id } })).toBe(0);
    expect((await t.db.prisma.session.findMany()).every((s) => /^[0-9a-f]{64}$/.test(s.idHash))).toBe(true);
  });

  it('wrong password -> 401 with an Indonesian message, audited', async () => {
    const res = await call(t, { ip: '192.168.10.23' }, 'POST', '/auth/login', { username: 'noc', password: 'salah' });
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).toMatch(/Username atau password salah/);
    expect(await audit('auth.login_failed')).toBeGreaterThan(0);
  });
});

describe('rate limit', () => {
  it('the 6th failure from the same IP -> 429, other IPs unaffected', async () => {
    const ip = '203.0.113.77';
    for (let i = 0; i < 5; i++) expect((await call(t, { ip }, 'POST', '/auth/login', { username: `ghost${i}`, password: 'wrong' })).status).toBe(401);
    expect((await call(t, { ip }, 'POST', '/auth/login', { username: 'noc', password: PASSWORDS.noc })).status).toBe(429);
    expect((await call(t, { ip: '203.0.113.78' }, 'POST', '/auth/login', { username: 'noc', password: PASSWORDS.noc })).status).toBe(200);
  });

  it('trusts exactly one proxy hop: a client-forged X-Forwarded-For entry does not dodge it', async () => {
    const real = '203.0.113.90';
    for (let i = 0; i < 5; i++) await call(t, { ip: `10.9.9.${i}, ${real}` }, 'POST', '/auth/login', { username: `spoof${i}`, password: 'wrong' });
    expect((await call(t, { ip: `10.9.9.99, ${real}` }, 'POST', '/auth/login', { username: 'noc', password: PASSWORDS.noc })).status).toBe(429);
  });
});

describe('rate limit per username', () => {
  it('5 failures for one username from 5 IPs -> the 6th attempt is 429 even with the right password', async () => {
    const { hash } = await import('@node-rs/argon2');
    await t.db.prisma.user.create({ data: { username: 'victim', role: 'noc', passwordHash: await hash('victim-password-123') } });
    for (let i = 0; i < 5; i++) await call(t, { ip: `198.51.100.${i}` }, 'POST', '/auth/login', { username: 'victim', password: 'wrong' });
    expect((await call(t, { ip: '198.51.100.99' }, 'POST', '/auth/login', { username: 'victim', password: 'victim-password-123' })).status).toBe(429);
  });
});

describe('session lifetime', () => {
  it('idle 31 minutes -> 401 (fake clock)', async () => {
    const c = await login(t, 'teknisi', '192.168.10.30');
    expect((await call(t, c, 'GET', '/auth/me')).status).toBe(200);
    t.clock.advance(29 * 60_000);
    expect((await call(t, c, 'GET', '/auth/me')).status).toBe(200); // activity resets idle
    t.clock.advance(31 * 60_000);
    expect((await call(t, c, 'GET', '/auth/me')).status).toBe(401);
  });

  it('expires after 12 hours even when active', async () => {
    const c = await login(t, 'teknisi', '192.168.10.31');
    for (let i = 0; i < 15; i++) { // 15 x 50 min = 12.5 h, never idle > 30 min
      t.clock.advance(25 * 60_000);
      await call(t, c, 'GET', '/auth/me');
      t.clock.advance(25 * 60_000);
      await call(t, c, 'GET', '/auth/me');
    }
    expect((await call(t, c, 'GET', '/auth/me')).status).toBe(401);
  });

  it('logout revokes the session and is audited', async () => {
    const c = await login(t, 'noc', '192.168.10.32');
    expect((await call(t, c, 'POST', '/auth/logout')).status).toBe(204);
    expect((await call(t, c, 'GET', '/auth/me')).status).toBe(401);
    expect(await audit('auth.logout')).toBe(1);
  });

  it('changing the password -> other sessions 401, this one stays; audited', async () => {
    const a: Client = await login(t, 'admin', '192.168.10.40');
    const b: Client = await login(t, 'admin', '192.168.10.41');
    const res = await call(t, a, 'POST', '/auth/password', { currentPassword: PASSWORDS.admin, newPassword: 'new-admin-password-99' });
    expect(res.status).toBe(204);
    expect((await call(t, a, 'GET', '/auth/me')).status).toBe(200);
    expect((await call(t, b, 'GET', '/auth/me')).status).toBe(401);
    expect(await audit('auth.password_changed')).toBe(1);
    // restore for other tests
    await call(t, a, 'POST', '/auth/password', { currentPassword: 'new-admin-password-99', newPassword: PASSWORDS.admin });
  });
});

describe('origin check', () => {
  it('a foreign Origin on a state-changing request -> 403; missing Origin -> 403', async () => {
    const body = { username: 'noc', password: PASSWORDS.noc };
    expect((await call(t, { ip: '192.168.10.50' }, 'POST', '/auth/login', body, { origin: 'https://evil.example' })).status).toBe(403);
    const res = await fetch(`${t.base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(res.status).toBe(403);
  });

  it('health stays public', async () => {
    expect((await call(t, {}, 'GET', '/health')).status).toBe(200);
  });
});

describe('admin resets NOC/teknisi passwords (owner decision 2026-11-10)', () => {
  it('lists users for admin only', async () => {
    const admin = await login(t, 'admin', '192.168.10.50');
    const res = await call(t, admin, 'GET', '/users');
    expect(res.status).toBe(200);
    const rows = res.body as { username: string; passwordResettable: boolean; passwordHash?: unknown }[];
    expect(rows.map((r) => [r.username, r.passwordResettable])).toEqual(expect.arrayContaining([['admin', false], ['noc', true], ['teknisi', true]]));
    expect(rows.every((r) => r.passwordHash === undefined)).toBe(true);
    expect((await call(t, await login(t, 'teknisi', '192.168.10.51'), 'GET', '/users')).status).toBe(403);
  });

  it('new password works, the old one and existing sessions do not; audited; admin passwords are refused', async () => {
    const admin = await login(t, 'admin', '192.168.10.52');
    const noc = await login(t, 'noc', '192.168.10.53');
    const users = (await call(t, admin, 'GET', '/users')).body as { id: number; username: string }[];
    const id = (name: string) => users.find((u) => u.username === name)!.id;

    expect((await call(t, admin, 'POST', `/users/${id('noc')}/password`, { newPassword: 'short' })).status).toBe(400);
    expect((await call(t, noc, 'POST', `/users/${id('teknisi')}/password`, { newPassword: 'noc-cannot-do-this-1' })).status).toBe(403);
    expect((await call(t, admin, 'POST', `/users/${id('admin')}/password`, { newPassword: 'other-admin-pass-123' })).status).toBe(403);

    expect((await call(t, admin, 'POST', `/users/${id('noc')}/password`, { newPassword: 'reset-noc-password-77' })).status).toBe(204);
    expect((await call(t, noc, 'GET', '/auth/me')).status).toBe(401);
    expect((await call(t, { ip: '192.168.10.54' }, 'POST', '/auth/login', { username: 'noc', password: PASSWORDS.noc })).status).toBe(401);
    expect((await call(t, { ip: '192.168.10.54' }, 'POST', '/auth/login', { username: 'noc', password: 'reset-noc-password-77' })).status).toBe(200);
    expect(await audit('user.password_reset')).toBe(1);
    // restore for other tests
    await call(t, admin, 'POST', `/users/${id('noc')}/password`, { newPassword: PASSWORDS.noc });
  });
});
