import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*', 'vitest.root.config.ts'],
    passWithNoTests: true,
  },
});
