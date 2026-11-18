// Adds the Fase 2 allowlist to every mock OLT that lacks it (after mocks are registered from the
// UI, runbook J2 step 8). Idempotent. Usage: DATABASE_URL=... node dist/seed-allowlist.js
import { createPrisma } from './client.js';
import { seedMockAllowlist } from './seed.js';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const prisma = createPrisma(url);
  try {
    console.log(`added ${await seedMockAllowlist(prisma)} allowlist entries`);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
