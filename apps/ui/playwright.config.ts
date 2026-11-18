import { defineConfig, devices } from '@playwright/test';

// Runs against the dev stack behind caddy: `docker compose --profile dev up -d --wait` first
// (rebuild the caddy image after UI changes). Only mock OLTs exist in that stack.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 4 * 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `https://localhost:${process.env.HTTPS_PORT ?? 443}`,
    ignoreHTTPSErrors: true, // caddy `tls internal` in dev
    locale: 'en-GB',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
