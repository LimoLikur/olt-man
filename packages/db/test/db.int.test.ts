import { verify } from '@node-rs/argon2';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ADMIN_PASSWORD, MOCK_ALLOWLIST, seedEnvSchema, seedMockAllowlist, seedUsers } from '../src/seed.js';
import { startTestDatabase, type TestDatabase } from '../src/testing.js';

const run = promisify(execFile);
const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

let db: TestDatabase;
beforeAll(async () => {
  db = await startTestDatabase();
}, 120_000);
afterAll(() => db?.stop());

const sql = (query: string) => db.prisma.$executeRawUnsafe(query);

async function newOlt(name: string, isMock = true) {
  return db.prisma.olt.create({
    data: { name, mgmtIp: '172.30.0.11', isMock, oidProfile: 'zte-c320-v2.1', snmpVersion: 'v3', snmpCredEnc: Buffer.from('fake-ciphertext') },
  });
}

describe('migrations', () => {
  it('apply on an empty database and create every table', async () => {
    const tables = await db.prisma.$queryRaw<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> '_prisma_migrations' ORDER BY 1`;
    expect(tables.map((t) => t.table_name)).toEqual(
      [
        'alarm', 'audit_log', 'job', 'maintenance_window', 'notification', 'olt', 'olt_identity', 'olt_metric', 'onu', 'onu_event', 'onu_metric', 'onu_metric_hourly', 'onu_state', 'onu_traffic', 'pon_port', 'poll_run', 'provision_allowlist', 'security_event', 'session', 'user',
      ].sort(),
    );
  });

  it('show no drift between the migrated database and schema.prisma', async () => {
    const { stdout } = await run('pnpm', ['exec', 'prisma', 'migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--script'], {
      cwd: PACKAGE_DIR,
      env: { ...process.env, DATABASE_URL: db.url },
    });
    expect(stdout.trim()).toMatch(/^-- This is an empty migration\.?$/);
  });
});

describe('integrity rules (0002_integrity)', () => {
  it('rejects a second active ONU at the same position, allows it once archived; SN may repeat (0004)', async () => {
    const olt = await newOlt('olt-onu');
    const port = await db.prisma.ponPort.create({ data: { oltId: olt.id, slot: 1, port: 1 } });
    const base = { oltId: olt.id, ponPortId: port.id, onuIndex: 1, sn: 'ZTEG00000001', name: 'Pelanggan-01' };
    const first = await db.prisma.onu.create({ data: base });

    await expect(db.prisma.onu.create({ data: { ...base, sn: 'ZTEG00000002' } })).rejects.toThrow(/onu_active_position_key|Unique constraint/);
    // Same SN at another position, as on golden olt-a.
    await expect(db.prisma.onu.create({ data: { ...base, onuIndex: 2 } })).resolves.toMatchObject({ onuIndex: 2, sn: base.sn });

    await db.prisma.onu.update({ where: { id: first.id }, data: { archivedAt: new Date() } });
    await expect(db.prisma.onu.create({ data: { ...base, name: 'Pelanggan-02' } })).resolves.toMatchObject({ onuIndex: 1 });
    expect(await db.prisma.onu.count({ where: { oltId: olt.id, onuIndex: 1 } })).toBe(2);
  });

  it('rejects UPDATE olt SET is_mock', async () => {
    const olt = await newOlt('olt-immutable');
    await expect(sql(`UPDATE olt SET is_mock = false WHERE id = ${olt.id}`)).rejects.toThrow(/is_mock is immutable/);
    await expect(sql(`UPDATE olt SET status = 'ok' WHERE id = ${olt.id}`)).resolves.toBe(1);
  });

  it('role app can insert into audit_log but not UPDATE/DELETE it', async () => {
    await db.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE app');
      await tx.$executeRawUnsafe(`INSERT INTO audit_log (action, target) VALUES ('test.insert', 'x')`);
    });
    const asApp = (q: string) => db.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE app');
      return tx.$executeRawUnsafe(q);
    });
    await expect(asApp('DELETE FROM audit_log')).rejects.toThrow(/permission denied/);
    await expect(asApp(`UPDATE audit_log SET action = 'tampered'`)).rejects.toThrow(/permission denied/);
    await expect(asApp('SELECT 1 FROM olt LIMIT 1')).resolves.toBeDefined();
    expect(await db.prisma.auditLog.count({ where: { action: 'test.insert' } })).toBe(1);
  });

  it('has the (onu_id, ts DESC) index on onu_metric', async () => {
    const rows = await db.prisma.$queryRaw<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes WHERE tablename = 'onu_metric'`;
    expect(rows.map((r) => r.indexdef).join('\n')).toMatch(/\(onu_id, ts DESC\)/);
  });
});

describe('seed', () => {
  const env = seedEnvSchema.parse({
    DATABASE_URL: 'postgresql://unused@localhost/x',
    SEED_ADMIN_PASSWORD: 'fake-admin-password-1',
    SEED_NOC_PASSWORD: 'fake-noc-password-12',
    SEED_TEKNISI_PASSWORD: 'fake-teknisi-pass-123',
  });

  it('creates admin, noc and teknisi with Argon2id hashes, idempotently', async () => {
    await seedUsers(db.prisma, env);
    await seedUsers(db.prisma, env);
    const users = await db.prisma.user.findMany({ orderBy: { username: 'asc' } });
    expect(users.map((u) => [u.username, u.role])).toEqual([['admin', 'admin'], ['noc', 'noc'], ['teknisi', 'teknisi']]);
    expect(users[0]!.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await verify(users[0]!.passwordHash, 'fake-admin-password-1')).toBe(true);
  });

  it('rejects short passwords, including a short SEED_ADMIN_PASSWORD that is set', () => {
    expect(() => seedEnvSchema.parse({ ...env, SEED_NOC_PASSWORD: 'short' })).toThrow(/SEED_NOC_PASSWORD|12/);
    expect(() => seedEnvSchema.parse({ ...env, SEED_ADMIN_PASSWORD: 'short' })).toThrow(/SEED_ADMIN_PASSWORD|12/);
  });

  it('SEED_ADMIN_PASSWORD empty or unset -> the default admin password; existing admins only change on reset', async () => {
    const rest = { ...env, SEED_ADMIN_PASSWORD: undefined };
    // The default passes the same rule as a chosen password, so "Ganti password" accepts it too.
    expect(seedEnvSchema.parse({ ...env, SEED_ADMIN_PASSWORD: DEFAULT_ADMIN_PASSWORD }).SEED_ADMIN_PASSWORD).toBe(DEFAULT_ADMIN_PASSWORD);
    expect(seedEnvSchema.parse(rest).SEED_ADMIN_PASSWORD).toBeUndefined();
    const empty = seedEnvSchema.parse({ ...rest, SEED_ADMIN_PASSWORD: '', SEED_ADMIN_USERNAME: 'admin2' });
    expect(empty.SEED_ADMIN_PASSWORD).toBeUndefined();
    await seedUsers(db.prisma, empty);
    const created = await db.prisma.user.findUniqueOrThrow({ where: { username: 'admin2' } });
    expect(created.role).toBe('admin');
    expect(await verify(created.passwordHash, DEFAULT_ADMIN_PASSWORD)).toBe(true);

    // "admin" already exists with its own password: kept, unless SEED_RESET_PASSWORDS=1.
    await seedUsers(db.prisma, seedEnvSchema.parse(rest));
    expect(await verify((await db.prisma.user.findUniqueOrThrow({ where: { username: 'admin' } })).passwordHash, 'fake-admin-password-1')).toBe(true);
    await seedUsers(db.prisma, seedEnvSchema.parse({ ...rest, SEED_RESET_PASSWORDS: '1' }));
    expect(await verify((await db.prisma.user.findUniqueOrThrow({ where: { username: 'admin' } })).passwordHash, DEFAULT_ADMIN_PASSWORD)).toBe(true);
    // Restore for later tests.
    await seedUsers(db.prisma, { ...env, SEED_RESET_PASSWORDS: '1' });
    await db.prisma.user.delete({ where: { username: 'admin2' } });
  });

  it('adds the allowlist to mock OLTs only', async () => {
    const mock = await newOlt('olt-allow-mock');
    const real = await newOlt('olt-allow-real', false);
    await seedMockAllowlist(db.prisma);
    await seedMockAllowlist(db.prisma);
    const perKind = Object.values(MOCK_ALLOWLIST).flat().length;
    expect(await db.prisma.provisionAllowlist.count({ where: { oltId: mock.id } })).toBe(perKind);
    expect(await db.prisma.provisionAllowlist.count({ where: { oltId: real.id } })).toBe(0);
  });
});
