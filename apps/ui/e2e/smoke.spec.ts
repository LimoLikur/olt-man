import { expect, test } from '@playwright/test';
import { login, scenario, sql, waitForCleanState, waitForPolls } from './helpers.js';

test.afterEach(() => {
  scenario('olt-up');
  scenario('reset');
});

// G4
test('los-mass shows one parent alarm with 5 children; NOC ack is recorded', async ({ page }) => {
  await login(page, 'noc');
  await waitForPolls(page);
  await waitForCleanState();
  scenario('los-mass');
  await page.goto('/alarms');
  const mass = page.getByTestId('alarm').filter({ hasText: 'Mass LOS' });
  await expect(mass).toHaveCount(1, { timeout: 120_000 });
  // Exactly the 5 ONUs as onu_los children. Repeated runs may add onu_flapping children for the
  // same ONUs (>= 3 drops within the mock-fast window), which is the rule working as intended.
  await expect(mass.getByRole('listitem').filter({ hasText: /^ONU LOS/ })).toHaveCount(5);
  await mass.getByRole('button', { name: 'Ack' }).click();
  await expect(mass.getByText(/Acknowledged/)).toBeVisible();
  expect(Number(sql(`SELECT count(*) FROM audit_log WHERE action = 'alarm.ack'`))).toBeGreaterThan(0);
});

test('teknisi sees alarms but no ack button', async ({ page }) => {
  await login(page, 'teknisi');
  await waitForPolls(page);
  scenario('onu-los');
  await page.goto('/alarms');
  await expect(page.getByTestId('alarm').first()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('button', { name: 'Ack' })).toHaveCount(0);
});

test('olt-down: ONUs show "Unknown (last: ...)"', async ({ page }) => {
  await login(page, 'noc');
  await waitForPolls(page);
  await waitForCleanState();
  scenario('olt-down');
  // 2 status cycles -> unreachable.
  await expect.poll(() => sql(`SELECT status FROM olt WHERE name = 'mock-1'`), { timeout: 180_000, intervals: [5000] }).toBe('unreachable');
  const oltId = sql(`SELECT id FROM olt WHERE name = 'mock-1'`);
  await page.goto(`/onus?oltId=${oltId}`);
  await expect(page.getByTestId('onu-row').first()).toContainText(/Unknown \(last: working, \d{2}:\d{2}\)/);
});
