import { expect, test } from '@playwright/test';
import { login, pinMock1HostKey, sql, waitForPolls } from './helpers.js';

// G3
test('search by SN gives exactly one row', async ({ page }) => {
  await login(page, 'teknisi');
  await waitForPolls(page);
  const sn = sql(`SELECT sn FROM onu WHERE archived_at IS NULL ORDER BY id LIMIT 1`);
  await page.goto('/onus');
  await page.getByLabel('Search ONUs').fill(sn);
  await expect(page.getByTestId('onu-row')).toHaveCount(1);
  await expect(page.getByTestId('onu-row')).toContainText(sn);
});

test('the Rx chart has at least one point', async ({ page }) => {
  await login(page, 'noc');
  // poll.optical runs every 5 min; wait for the first one.
  await expect.poll(() => Number(sql(`SELECT count(*) FROM onu_metric`)), { timeout: 330_000, intervals: [5000] }).toBeGreaterThan(0);
  const id = sql(`SELECT onu_id FROM onu_metric WHERE rx_dbm IS NOT NULL ORDER BY ts DESC LIMIT 1`);
  await page.goto(`/onus/${id}`);
  await expect(page.getByTestId('rx-chart')).toBeVisible();
  expect(Number(await page.getByTestId('rx-chart').getAttribute('data-points'))).toBeGreaterThanOrEqual(1);
});

test('refresh shows the offline history from the mock', async ({ page }) => {
  pinMock1HostKey();
  await login(page, 'noc');
  await waitForPolls(page);
  // The manual's ONU 1/2/5:5 on mock-1 has 10 history rows.
  const id = sql(`SELECT o.id FROM onu o JOIN olt ON olt.id = o.olt_id JOIN pon_port p ON p.id = o.pon_port_id WHERE olt.name = 'mock-1' AND p.slot = 2 AND p.port = 5 AND o.onu_index = 5 AND o.archived_at IS NULL`);
  await page.goto(`/onus/${id}`);
  await page.getByRole('button', { name: 'Refresh from OLT' }).click();
  await expect(page.getByRole('status')).toHaveText('ONU details updated.', { timeout: 60_000 });
  await expect(page.getByTestId('offline-history-row')).toHaveCount(10);
  await expect(page.getByTestId('offline-history-row').nth(8)).toContainText('LOSi');
});
