import { expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

// FAKE dev passwords from .env.example (seed service, profile dev).
export const PASSWORDS = {
  // Empty in .env.example: the seeder's DEFAULT_ADMIN_PASSWORD (packages/db/src/seed.ts).
  admin: process.env.SEED_ADMIN_PASSWORD || 'DataUtama*26',
  noc: process.env.SEED_NOC_PASSWORD ?? 'dev-noc-password-change-me',
  teknisi: process.env.SEED_TEKNISI_PASSWORD ?? 'dev-teknisi-password-change-me',
};

export async function login(page: Page, role: keyof typeof PASSWORDS): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(role);
  await page.getByLabel('Password').fill(PASSWORDS[role]);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('whoami')).toContainText(role);
}

const compose = (...args: string[]) => execFileSync('docker', ['compose', ...args], { cwd: ROOT, encoding: 'utf8' });

/** Same as `docker compose exec mock-olt-1 scenario <name>`. */
export const scenario = (name: string, mock = 'mock-olt-1') => compose('exec', '-T', mock, 'scenario', name);

export const sql = (query: string) => compose('exec', '-T', 'postgres', 'psql', '-U', 'olt', '-d', 'olt', '-tAc', query).trim();

/**
 * Test fixture until H1 (identity probe + pin from the UI): pin mock-1's SSH host key as seen
 * through the dev port forward, so CLI refresh is allowed.
 */
export function pinMock1HostKey(): void {
  const scan = execFileSync('sh', ['-c', 'ssh-keyscan -t ed25519 -p 2222 127.0.0.1 2>/dev/null | ssh-keygen -lf - | cut -d" " -f2'], { encoding: 'utf8' }).trim();
  if (!/^SHA256:[A-Za-z0-9+/]{43}$/.test(scan)) throw new Error('could not read mock-1 host key');
  sql(`UPDATE olt_identity SET status = 'retired' WHERE kind = 'ssh_hostkey' AND status = 'pinned' AND olt_id = (SELECT id FROM olt WHERE name = 'mock-1') AND value <> '${scan}'`);
  sql(
    `INSERT INTO olt_identity (olt_id, kind, value, algo, status, pinned_at, reason) SELECT id, 'ssh_hostkey', '${scan}', 'ssh-ed25519', 'pinned', now(), 'e2e fixture' FROM olt WHERE name = 'mock-1' AND NOT EXISTS (SELECT 1 FROM olt_identity i WHERE i.olt_id = olt.id AND i.kind = 'ssh_hostkey' AND i.status = 'pinned' AND i.value = '${scan}')`,
  );
}

/** Waits until the worker has polled every mock at least once. */
export async function waitForPolls(page: Page): Promise<void> {
  await expect.poll(() => Number(sql(`SELECT count(*) FROM olt WHERE is_mock AND last_poll_ok_at IS NOT NULL`)), { timeout: 150_000 }).toBe(3);
  void page;
}

/**
 * Scenarios from earlier tests linger in the database until a poll has seen the reset: wait
 * until no mock ONU is LOS or DyingGasp before reading a baseline.
 */
export async function waitForCleanState(): Promise<void> {
  await expect
    .poll(() => Number(sql(`SELECT count(*) FROM onu_state s JOIN onu o ON o.id = s.onu_id JOIN olt ON olt.id = o.olt_id WHERE olt.is_mock AND o.archived_at IS NULL AND s.phase_state IN ('los', 'dying_gasp')`)), { timeout: 150_000, intervals: [3000] })
    .toBe(0);
}
