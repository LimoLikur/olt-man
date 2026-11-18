import { defineConfig } from 'prisma/config';

// DATABASE_URL is read lazily: `prisma generate` does not need a database.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
