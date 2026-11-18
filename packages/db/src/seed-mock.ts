// Dev/test only: registers mock-1..3 with FAKE credentials sealed for the worker, pins their
// SNMPv3 engine IDs (and host keys, when given) and adds their Fase 2 allowlist.
// Usage: DATABASE_URL=... OLT_CRED_PUBLIC_KEY_FILE=secrets/olt-cred.pub pnpm --filter @olt/db seed:mock
import { MOCK_CLI, MOCK_OLTS, MOCK_SNMP_V3 } from '@olt/shared';
import { credentialAad, sealEnvelope } from '@olt/shared/crypto';
import { readFileSync } from 'node:fs';
import { createPrisma, type PrismaClient } from './client.js';
import { seedMockAllowlist } from './seed.js';

export interface MockOltSeed {
  name: string;
  ip: string;
  engineId: string;
  oidProfile: string;
  /** "SHA256:..." as printed by ssh-keyscan | ssh-keygen -l; pinned when present. */
  hostKeyFingerprint?: string;
}

// Prisma's Bytes wants a plain Uint8Array<ArrayBuffer>, not a pooled Buffer view.
const seal = (publicKeyPem: string, oltName: string, field: 'snmp' | 'cli', value: unknown) =>
  new Uint8Array(sealEnvelope(publicKeyPem, Buffer.from(JSON.stringify(value)), credentialAad(oltName, field)));

export async function seedMockOlts(prisma: PrismaClient, publicKeyPem: string, olts: readonly MockOltSeed[] = MOCK_OLTS): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('seed-mock is for dev and test only');
  const now = new Date();
  for (const m of olts) {
    const olt = await prisma.olt.upsert({
      where: { name: m.name },
      create: {
        name: m.name,
        mgmtIp: m.ip,
        isMock: true,
        oidProfile: m.oidProfile,
        snmpVersion: 'v3',
        snmpCredEnc: seal(publicKeyPem, m.name, 'snmp', MOCK_SNMP_V3),
        cliEnabled: true,
        cliCredEnc: seal(publicKeyPem, m.name, 'cli', MOCK_CLI),
        status: 'ok',
        statusIntervalS: 60,
        // Fast timing profile for demos (SPEC §2.2 no. 7); consumed by the alarm engine (E5).
        alarmSettings: { profile: 'mock-fast' },
      },
      update: {},
    });
    const pins: { kind: 'snmp_engine_id' | 'ssh_hostkey'; value: string; algo?: string }[] = [{ kind: 'snmp_engine_id', value: m.engineId.toLowerCase() }];
    if (m.hostKeyFingerprint) pins.push({ kind: 'ssh_hostkey', value: m.hostKeyFingerprint, algo: 'ssh-ed25519' });
    for (const pin of pins) {
      const existing = await prisma.oltIdentity.findFirst({ where: { oltId: olt.id, kind: pin.kind, status: 'pinned' } });
      if (!existing) {
        await prisma.oltIdentity.create({
          data: { oltId: olt.id, kind: pin.kind, value: pin.value, algo: pin.algo ?? null, status: 'pinned', pinnedAt: now, reason: 'seed-mock (dev/test)' },
        });
      }
    }
  }
  await seedMockAllowlist(prisma);
}

/** MOCK_HOSTKEY_FINGERPRINTS="mock-1=SHA256:...,mock-2=SHA256:..." */
export function parseFingerprints(env: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (env ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(mock-\d)=(SHA256:[A-Za-z0-9+/]{43})$/.exec(pair);
    if (!m) throw new Error(`invalid MOCK_HOSTKEY_FINGERPRINTS entry: ${pair.split('=')[0]}`);
    out[m[1]!] = m[2]!;
  }
  return out;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  const keyFile = process.env.OLT_CRED_PUBLIC_KEY_FILE;
  const pem = process.env.OLT_CRED_PUBLIC_KEY ?? (keyFile ? readFileSync(keyFile, 'utf8') : undefined);
  if (!url || !pem) {
    console.error('DATABASE_URL and OLT_CRED_PUBLIC_KEY (or OLT_CRED_PUBLIC_KEY_FILE) are required');
    process.exit(1);
  }
  const fps = parseFingerprints(process.env.MOCK_HOSTKEY_FINGERPRINTS);
  const prisma = createPrisma(url);
  try {
    await seedMockOlts(prisma, pem, MOCK_OLTS.map((m) => ({ ...m, ...(fps[m.name] ? { hostKeyFingerprint: fps[m.name] } : {}) })));
    console.log(`seeded ${MOCK_OLTS.length} mock OLTs`);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
