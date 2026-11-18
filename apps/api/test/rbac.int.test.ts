import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IS_PUBLIC, ROLES } from '../src/auth/decorators.js';
import { call, login, PASSWORDS, startTestApi, type TestApi } from './helpers.js';

let t: TestApi;
beforeAll(async () => {
  t = await startTestApi();
}, 180_000);
afterAll(() => t?.stop());

const offlan = () => t.db.prisma.securityEvent.count({ where: { kind: 'admin_offlan_denied' } });

describe('AdminLanGuard (rule 8)', () => {
  it('admin login with XFF 203.0.113.5 -> 403 and admin_offlan_denied, no session', async () => {
    const before = await offlan();
    const res = await call(t, { ip: '203.0.113.5' }, 'POST', '/auth/login', { username: 'admin', password: PASSWORDS.admin });
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await offlan()).toBe(before + 1);
  });

  it('an admin cookie used from outside the LAN -> 403 and the session is revoked', async () => {
    const admin = await login(t, 'admin', '192.168.10.5');
    expect((await call(t, admin, 'GET', '/audit')).status).toBe(200);
    const before = await offlan();
    expect((await call(t, { ...admin, ip: '203.0.113.5' }, 'GET', '/olts')).status).toBe(403);
    expect(await offlan()).toBe(before + 1);
    // Revoked: even back on the LAN the cookie is dead.
    expect((await call(t, admin, 'GET', '/olts')).status).toBe(401);
  });

  it('NOC and teknisi are not LAN-restricted', async () => {
    const noc = await login(t, 'noc', '203.0.113.6');
    expect((await call(t, noc, 'GET', '/olts')).status).toBe(200);
  });
});

describe('RolesGuard (default deny)', () => {
  it('every route declares @Roles or @Public', () => {
    const scanner = new MetadataScanner();
    const reflector = new Reflector();
    const controllers = [...t.app.get(ModulesContainer, { strict: false }).values()].flatMap((m) => [...m.controllers.values()]);
    const missing: string[] = [];
    let routes = 0;
    for (const wrapper of controllers) {
      const proto = Object.getPrototypeOf(wrapper.instance) as object;
      for (const name of scanner.getAllMethodNames(proto)) {
        const handler = (proto as Record<string, () => unknown>)[name]!;
        if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
        routes++;
        const targets = [handler, wrapper.metatype as () => unknown];
        const pub = reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
        const roles = reflector.getAllAndOverride<string[] | undefined>(ROLES, targets);
        if (!pub && !roles?.length) missing.push(`${RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number]} ${wrapper.name}.${name}`);
      }
    }
    expect(routes).toBeGreaterThan(15);
    expect(missing).toEqual([]);
  });

  it('NOC may add OLTs (body validated, 400), teknisi may not (403); NOC GET /audit and /users -> 403', async () => {
    const noc = await login(t, 'noc', '192.168.10.7');
    expect((await call(t, noc, 'POST', '/olts', { name: 'x' })).status).toBe(400);
    expect((await call(t, noc, 'GET', '/audit')).status).toBe(403);
    expect((await call(t, noc, 'GET', '/users')).status).toBe(403);
    const teknisi = await login(t, 'teknisi', '192.168.10.8');
    expect((await call(t, teknisi, 'POST', '/olts', { name: 'x' })).status).toBe(403);
    expect((await call(t, teknisi, 'DELETE', '/olts/1', { confirmName: 'x' })).status).toBe(403);
    expect((await call(t, teknisi, 'POST', '/olts/1/identity/pin')).status).toBe(403);
    expect((await call(t, teknisi, 'GET', '/audit')).status).toBe(403);
  });

  it('unauthenticated -> 401 everywhere except health', async () => {
    for (const path of ['/dashboard', '/olts', '/onus', '/alarms', '/audit']) expect((await call(t, {}, 'GET', path)).status).toBe(401);
  });
});
