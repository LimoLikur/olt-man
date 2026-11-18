import { expect, test } from '@playwright/test';
import { login, sql, waitForPolls } from './helpers.js';

test.afterAll(() => {
  sql(`DELETE FROM olt WHERE name = 'olt-asli-e2e'`);
});

// I3
test('teknisi composes a registration; the preview shown is exactly the builder output stored by the api', async ({ page }) => {
  await login(page, 'teknisi');
  await waitForPolls(page);
  const oltId = sql(`SELECT id FROM olt WHERE name = 'mock-1'`);
  await page.getByRole('link', { name: 'ONU registration' }).click();
  await page.getByLabel('OLT').selectOption(oltId);
  await page.getByLabel('PON port').selectOption('1/1');
  await page.getByLabel('Serial number').fill('ZTEG0E2E0001');
  await page.getByLabel('Customer name').fill('Pelanggan-E2E');
  await page.getByLabel('ONU type').fill('ZTEG-F620');
  await page.getByLabel('T-CONT profile').selectOption('10M');
  await page.getByLabel('VLAN').selectOption('100');
  await page.getByRole('button', { name: 'Create preview' }).click();

  const preview = page.getByTestId('preview');
  await expect(preview).toContainText('onu ');
  const shown = (await preview.textContent())!;
  const stored = JSON.parse(sql(`SELECT json_build_object('preview', preview, 'hash', preview_sha256) FROM job WHERE kind = 'onu_register' ORDER BY id DESC LIMIT 1`)) as { preview: string; hash: string };
  expect(shown).toBe(stored.preview);
  await expect(page.getByTestId('preview-hash')).toHaveText(stored.hash);
  // mock-1 port 1/1/1 has 12 ONUs (seed), so the next free ID is 13.
  await expect(page.getByTestId('onu-id')).toHaveText('13');
  expect(shown.split('\n')[2]).toBe('onu 13 type ZTEG-F620 sn ZTEG0E2E0001');
});

test('an injection attempt is refused with an error message', async ({ page }) => {
  await login(page, 'teknisi');
  const oltId = sql(`SELECT id FROM olt WHERE name = 'mock-1'`);
  await page.goto(`/provision/new?oltId=${oltId}`);
  await page.getByLabel('PON port').selectOption('1/1');
  await page.getByLabel('Serial number').fill('ZTEG0E2E0002');
  await page.getByLabel('Customer name').fill('a;reboot');
  await page.getByLabel('ONU type').fill('ZTEG-F620');
  await page.getByLabel('T-CONT profile').selectOption('10M');
  await page.getByLabel('VLAN').selectOption('100');
  await page.getByRole('button', { name: 'Create preview' }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid input');
});

test('an OLT with CLI off shows no provisioning button and is not offered in the form; with CLI on it is', async ({ page }) => {
  // A registered real OLT, never polled (pending_pin, TEST-NET address outside OLT_TARGET_CIDRS), CLI off.
  // Fase 2 is open to real OLTs since 2026-11-13; the entry point depends on CLI being on.
  sql(`DELETE FROM olt WHERE name = 'olt-asli-e2e'`);
  const id = sql(`INSERT INTO olt (name, mgmt_ip, is_mock, oid_profile, snmp_version, snmp_cred_enc, status) VALUES ('olt-asli-e2e', '192.0.2.10', false, 'zte-c320-v2.1', 'v3', '\\x00', 'pending_pin') RETURNING id`).split('\n')[0];
  await login(page, 'admin');
  await page.goto(`/olts/${id}`);
  await expect(page.getByRole('heading', { name: /olt-asli-e2e/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Register ONU' }).and(page.locator('main a'))).toHaveCount(0);

  const mockId = sql(`SELECT id FROM olt WHERE name = 'mock-1'`);
  await page.goto(`/olts/${mockId}`);
  await expect(page.locator('main').getByRole('link', { name: 'Register ONU' })).toBeVisible();

  await page.goto('/provision/new');
  await expect(page.getByLabel('OLT').locator('option', { hasText: 'olt-asli-e2e' })).toHaveCount(0);

  sql(`UPDATE olt SET cli_enabled = true WHERE id = ${id}`);
  await page.goto('/provision/new');
  await expect(page.getByLabel('OLT').locator('option', { hasText: 'olt-asli-e2e' })).toHaveCount(1);
  sql(`DELETE FROM olt WHERE id = ${id}`);
});
