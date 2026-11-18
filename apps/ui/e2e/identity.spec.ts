import { expect, test } from '@playwright/test';
import { login, pinMock1HostKey, scenario, sql, waitForPolls } from './helpers.js';

// FAKE mock credentials (packages/shared/src/mock-credentials.ts).
const MOCK = { user: 'mockuser', authKey: 'mock-auth-key-fake-0001', privKey: 'mock-priv-key-fake-0001', cliUser: 'mockadmin', cliPassword: 'mock-ssh-password-fake' };

test.afterAll(() => {
  sql(`DELETE FROM olt WHERE name = 'mock-2-e2e'`);
});

// H3
test('admin registers a mock OLT from the UI and pins its identity', async ({ page }) => {
  await login(page, 'admin');
  sql(`DELETE FROM olt WHERE name = 'mock-2-e2e'`);
  await page.getByRole('link', { name: 'Add OLT' }).click();
  await page.getByLabel('OLT name').fill('mock-2-e2e');
  await page.getByLabel('Management IP').fill('172.30.0.12');
  await page.getByLabel('OID profile').selectOption('zte-c320-v2.2');
  await page.getByLabel('SNMPv3 user').fill(MOCK.user);
  await page.getByLabel('Auth key').fill(MOCK.authKey);
  await page.getByLabel('Priv key').fill(MOCK.privKey);
  await page.getByLabel('CLI username').fill(MOCK.cliUser);
  await page.getByLabel('CLI password').fill(MOCK.cliPassword);
  await page.getByRole('button', { name: 'Register OLT' }).click();

  await expect(page.getByText('Pending pin')).toBeVisible();
  const panel = page.getByTestId('identity-panel');
  // The worker's identity.probe fills the candidates (engine ID + host key).
  await expect(panel.getByTestId('identity-candidates')).toHaveCount(2, { timeout: 60_000 });
  // The engine ID of the same mock as currently pinned for mock-2 (it can change: engineid-change).
  const engineId = sql(`SELECT value FROM olt_identity i JOIN olt ON olt.id = i.olt_id WHERE olt.name = 'mock-2' AND i.kind = 'snmp_engine_id' AND i.status = 'pinned'`);
  await expect(panel).toContainText(engineId);
  await panel.getByRole('button', { name: 'Pin candidate' }).click();
  await expect(page.getByText('Operational', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Strong identity')).toBeVisible();
  expect(sql(`SELECT count(*) FROM audit_log WHERE action = 'olt.identity_pinned'`)).not.toBe('0');
});

test('hostkey-rotate -> Quarantined badge; the dialog refuses a wrong name and accepts the right one', async ({ page }) => {
  pinMock1HostKey();
  await login(page, 'admin');
  await waitForPolls(page);
  scenario('hostkey-rotate');
  const onu = sql(`SELECT o.id FROM onu o JOIN olt ON olt.id = o.olt_id WHERE olt.name = 'mock-1' AND o.archived_at IS NULL ORDER BY o.id LIMIT 1`);
  await page.goto(`/onus/${onu}`);
  await page.getByRole('button', { name: 'Refresh from OLT' }).click();
  await expect(page.getByRole('status')).toContainText('SSH host key changed', { timeout: 60_000 });

  await page.goto('/');
  const card = page.getByTestId('olt-card').filter({ hasText: 'mock-1' });
  await expect(card.getByText('Quarantined')).toBeVisible({ timeout: 20_000 });

  await card.getByRole('link', { name: 'mock-1' }).click();
  await page.getByRole('button', { name: 'Accept change…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Accept identity change' });
  await dialog.getByLabel('Reason').fill('kartu kontrol diganti (uji e2e)');
  await dialog.getByLabel('Type the OLT name').fill('mock-x');
  await dialog.getByRole('button', { name: 'Accept and resume polling' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('The OLT name does not match.');

  await dialog.getByLabel('Type the OLT name').fill('mock-1');
  await dialog.getByRole('button', { name: 'Accept and resume polling' }).click();
  await expect(page.getByText('Operational', { exact: true })).toBeVisible({ timeout: 15_000 });
  expect(sql(`SELECT count(*) FROM audit_log WHERE action = 'olt.identity_change_accepted'`)).not.toBe('0');
});
