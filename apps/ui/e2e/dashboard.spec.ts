import { expect, test } from '@playwright/test';
import { login, scenario, waitForCleanState, waitForPolls } from './helpers.js';

test.afterEach(() => scenario('reset'));

// G2
test('3 mock cards with the MOCK badge and about 210 ONUs', async ({ page }) => {
  await login(page, 'noc');
  await waitForPolls(page);
  await page.reload();
  await expect(page.getByTestId('olt-card')).toHaveCount(3);
  for (const card of await page.getByTestId('olt-card').all()) await expect(card.getByText('MOCK', { exact: true })).toBeVisible();
  const total = Number(await page.getByTestId('total-onus').textContent());
  expect(total).toBeGreaterThanOrEqual(200);
  expect(total).toBeLessThanOrEqual(220);
});

test('onu-los raises the offline count without a reload within 2 minutes', async ({ page }) => {
  await login(page, 'noc');
  await waitForPolls(page);
  await waitForCleanState();
  await page.reload();
  const before = Number(await page.getByTestId('total-offline').textContent());
  scenario('onu-los');
  await expect.poll(async () => Number(await page.getByTestId('total-offline').textContent()), { timeout: 120_000, intervals: [2000] }).toBe(before + 1);
});
