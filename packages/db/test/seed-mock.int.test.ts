import { MOCK_OLTS, MOCK_SNMP_V3 } from '@olt/shared';
import { credentialAad, openEnvelope } from '@olt/shared/crypto';
import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseFingerprints, seedMockOlts } from '../src/seed-mock.js';
import { startTestDatabase, type TestDatabase } from '../src/testing.js';

let db: TestDatabase;
beforeAll(async () => {
  db = await startTestDatabase();
}, 120_000);
afterAll(() => db?.stop());

const keys = generateKeyPairSync('rsa', { modulusLength: 3072, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });

describe('seed-mock', () => {
  it('creates mock-1..3 with sealed fake credentials, pinned engine IDs and allowlists; idempotent', async () => {
    const fp = 'SHA256:' + 'A'.repeat(43);
    await seedMockOlts(db.prisma, keys.publicKey, MOCK_OLTS.map((m, i) => (i === 0 ? { ...m, hostKeyFingerprint: fp } : m)));
    await seedMockOlts(db.prisma, keys.publicKey);

    const olts = await db.prisma.olt.findMany({ include: { identities: true, allowlist: true }, orderBy: { name: 'asc' } });
    expect(olts.map((o) => [o.name, o.mgmtIp, o.isMock, o.status])).toEqual(MOCK_OLTS.map((m) => [m.name, m.ip, true, 'ok']));

    const blob = Buffer.from(olts[0]!.snmpCredEnc);
    expect(blob.includes(Buffer.from(MOCK_SNMP_V3.authKey))).toBe(false);
    const opened = JSON.parse(openEnvelope(createPrivateKey(keys.privateKey), blob, credentialAad('mock-1', 'snmp')).toString());
    expect(opened).toEqual(MOCK_SNMP_V3);

    expect(olts[0]!.identities.map((i) => [i.kind, i.status])).toEqual(expect.arrayContaining([['snmp_engine_id', 'pinned'], ['ssh_hostkey', 'pinned']]));
    expect(olts[1]!.identities.map((i) => i.kind)).toEqual(['snmp_engine_id']);
    expect(olts[1]!.identities[0]!.value).toBe(MOCK_OLTS[1].engineId);
    expect(olts.every((o) => o.allowlist.length > 0)).toBe(true);
  });

  it('parses MOCK_HOSTKEY_FINGERPRINTS and rejects junk without echoing it', () => {
    const fp = 'SHA256:' + 'b'.repeat(43);
    expect(parseFingerprints(`mock-1=${fp}`)).toEqual({ 'mock-1': fp });
    expect(() => parseFingerprints('mock-1=secret-value')).toThrow(/mock-1$/);
  });
});
