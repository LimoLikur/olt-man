// Testcontainers helper for integration tests (D1 and later packages).
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createPrisma, type PrismaClient } from './client.js';

const run = promisify(execFile);
const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

export interface TestDatabase {
  url: string;
  prisma: PrismaClient;
  container: StartedPostgreSqlContainer;
  stop(): Promise<void>;
}

/** Applies all migrations with the Prisma CLI, exactly as a deploy would. */
export async function migrateDeploy(databaseUrl: string): Promise<string> {
  const { stdout } = await run('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: PACKAGE_DIR, env: { ...process.env, DATABASE_URL: databaseUrl } });
  return stdout;
}

export async function startTestDatabase(options: { migrate?: boolean } = {}): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer('postgres:17-alpine').withDatabase('olt').start();
  const url = container.getConnectionUri();
  if (options.migrate !== false) await migrateDeploy(url);
  const prisma = createPrisma(url);
  return {
    url,
    prisma,
    container,
    async stop() {
      await prisma.$disconnect();
      await container.stop();
    },
  };
}
