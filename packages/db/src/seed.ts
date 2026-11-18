// Seeds the three users (from env) and the Fase 2 allowlist of every mock OLT. Idempotent.
// Usage: DATABASE_URL=... [SEED_ADMIN_PASSWORD=...] SEED_NOC_PASSWORD=... SEED_TEKNISI_PASSWORD=... pnpm --filter @olt/db seed
import { hash } from '@node-rs/argon2';
import { z } from 'zod';
import { createPrisma, type PrismaClient } from './client.js';
import type { AllowlistKind, Role } from './generated/prisma/enums.js';

const password = z.string().min(12, 'must be at least 12 characters');
const username = z.string().regex(/^[a-z0-9._-]{3,64}$/);

/**
 * Admin password when SEED_ADMIN_PASSWORD is empty or unset (owner decision 2026-11-11). It
 * meets the 12-character rule but is known from the repo: change it after the first login (UI:
 * "Ganti password"). Applies to a new admin, or to an existing one with SEED_RESET_PASSWORDS=1.
 */
export const DEFAULT_ADMIN_PASSWORD = 'DataUtama*26';
const emptyAsUnset = (v: unknown) => (v === '' ? undefined : v);

export const seedEnvSchema = z.object({
  DATABASE_URL: z.url(),
  SEED_ADMIN_USERNAME: username.default('admin'),
  SEED_ADMIN_PASSWORD: z.preprocess(emptyAsUnset, password.optional()),
  SEED_NOC_USERNAME: username.default('noc'),
  SEED_NOC_PASSWORD: password,
  SEED_TEKNISI_USERNAME: username.default('teknisi'),
  SEED_TEKNISI_PASSWORD: password,
  /** "1" overwrites the passwords of existing seed users. */
  SEED_RESET_PASSWORDS: z.enum(['0', '1']).default('0'),
});
export type SeedEnv = z.infer<typeof seedEnvSchema>;

/** Values Fase 2 may use on mock OLTs (SPEC §8.5): manual Bab IV-A plus the seed's profiles. */
export const MOCK_ALLOWLIST: Record<AllowlistKind, string[]> = {
  onu_type: ['ZTEG-F620', 'ZTEG-F660', 'ZTEG-F609', 'ZTEG-F670L'],
  tcont_profile: ['10M', 'UP-10M', 'UP-20M', 'UP-50M', 'UP-100M'],
  vlan: ['100', '1245', '1247'],
};

export async function seedUsers(prisma: PrismaClient, env: SeedEnv): Promise<void> {
  const users: [Role, string, string][] = [
    ['admin', env.SEED_ADMIN_USERNAME, env.SEED_ADMIN_PASSWORD ?? DEFAULT_ADMIN_PASSWORD],
    ['noc', env.SEED_NOC_USERNAME, env.SEED_NOC_PASSWORD],
    ['teknisi', env.SEED_TEKNISI_USERNAME, env.SEED_TEKNISI_PASSWORD],
  ];
  for (const [role, name, pw] of users) {
    const passwordHash = await hash(pw); // Argon2id (library default)
    await prisma.user.upsert({
      where: { username: name },
      create: { username: name, role, passwordHash },
      update: env.SEED_RESET_PASSWORDS === '1' ? { role, passwordHash, passwordChangedAt: new Date() } : {},
    });
  }
}

export async function seedMockAllowlist(prisma: PrismaClient): Promise<number> {
  const olts = await prisma.olt.findMany({ where: { isMock: true }, select: { id: true } });
  const data = olts.flatMap(({ id }) =>
    (Object.entries(MOCK_ALLOWLIST) as [AllowlistKind, string[]][]).flatMap(([kind, values]) => values.map((value) => ({ oltId: id, kind, value }))),
  );
  const { count } = await prisma.provisionAllowlist.createMany({ data, skipDuplicates: true });
  return count;
}

async function main(): Promise<void> {
  const parsed = seedEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Name the variables, never echo their values.
    console.error(`Invalid seed environment: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    process.exit(1);
  }
  const prisma = createPrisma(parsed.data.DATABASE_URL);
  try {
    await seedUsers(prisma, parsed.data);
    const added = await seedMockAllowlist(prisma);
    console.log(`seeded 3 users, ${added} allowlist entries`);
    // Never echo the value itself; it is documented in seed.ts.
    if (parsed.data.SEED_ADMIN_PASSWORD === undefined) console.log('admin: SEED_ADMIN_PASSWORD empty, a new or reset admin gets the default password; change it after the first login');
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
