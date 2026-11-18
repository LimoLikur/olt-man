import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { login, scenario, sql, waitForPolls } from './helpers.js';

const SN = 'ZTEG0E2EF201';
const BRIDGE_SN = 'ZTEG0E2EF202';
const PPPOE_SN = 'ZTEG0E2EF203';
const BRIDGE_STATIC_SN = 'ZTEG0E2EF204';

/** Commands mock-1 logged in the last `seconds` (its evidence log is JSON on stdout). */
function mockCommands(seconds: number): string[] {
  const out = execFileSync('docker', ['compose', 'logs', '--no-log-prefix', '--since', `${seconds}s`, 'mock-olt-1'], { cwd: new URL('../../..', import.meta.url).pathname, encoding: 'utf8' });
  return out
    .split('\n')
    .filter((l) => l.includes('"ssh-command"'))
    .map((l) => (JSON.parse(l.slice(l.indexOf('{'))) as { command: string }).command);
}

test.afterAll(() => {
  scenario('reset'); // removes the registered ONU from the mock again
});

// I7 / SPEC §14 B15
test('teknisi submits an ONU registration, NOC approves, it runs end to end and is saved with write at once', async ({ page, browser }) => {
  await login(page, 'teknisi');
  await waitForPolls(page);
  const oltId = sql(`SELECT id FROM olt WHERE name = 'mock-1'`);
  const started = Date.now();

  await page.goto(`/provision/new?oltId=${oltId}`);
  await page.getByLabel('PON port').selectOption('1/1');
  await page.getByLabel('Serial number').fill(SN);
  await page.getByLabel('Customer name').fill('Pelanggan-F2');
  await page.getByLabel('ONU type').fill('ZTEG-F620');
  await page.getByLabel('T-CONT profile').selectOption('10M');
  await page.getByLabel('VLAN').selectOption('100');
  await page.getByRole('button', { name: 'Create preview' }).click();
  const preview = (await page.getByTestId('preview').textContent())!;
  await page.getByRole('button', { name: 'Submit to NOC' }).click();

  await expect(page).toHaveURL(/\/jobs\/\d+$/);
  await expect(page.getByTestId('job-status')).toHaveText('Awaiting NOC approval');
  const jobPath = new URL(page.url()).pathname;

  // NOC approves from the approvals list; the job runs only then.
  const nocCtx = await browser.newContext({ ignoreHTTPSErrors: true });
  const noc = await nocCtx.newPage();
  await login(noc, 'noc');
  await noc.goto('/approvals');
  await noc.getByTestId('approval-row').filter({ hasText: SN }).getByRole('link').click();
  await expect(noc).toHaveURL(new RegExp(`${jobPath}$`));
  await expect(noc.getByTestId('job-preview')).toHaveText(preview);
  await noc.getByRole('button', { name: 'Approve and run' }).click();
  await nocCtx.close();

  await expect(page.getByTestId('job-status')).toHaveText('Succeeded', { timeout: 60_000 });
  await expect(page.getByTestId('job-applied')).toHaveText(preview);

  // The mock received exactly the preview, in order.
  const sent = mockCommands(Math.ceil((Date.now() - started) / 1000) + 5).filter((c) => !c.startsWith('show '));
  const lines = preview.split('\n');
  const at = sent.indexOf(lines[0]!);
  expect(at).toBeGreaterThanOrEqual(0);
  expect(sent.slice(at, at + lines.length)).toEqual(lines);

  // The verified registration was saved at once: `write` is the preview's last line (owner decision 2026-11-13).
  expect(lines.at(-1)).toBe('write');
  await expect(page.getByRole('status').filter({ hasText: 'saved on the OLT' })).toBeVisible();

  // Admin: nothing left unsaved.
  const adminCtx = await browser.newContext({ ignoreHTTPSErrors: true });
  const admin = await adminCtx.newPage();
  await login(admin, 'admin');
  await admin.goto(`/olts/${oltId}`);
  await expect(admin.getByTestId('unsaved-empty')).toBeVisible();
  await adminCtx.close();
});

// Registration mode bridge (owner decision 2026-11-14); needs the mock-olt image with the bridge lines.
test('teknisi submits a bridge registration, NOC approves, the mock receives the bridge template and write', async ({ page, browser }) => {
  await login(page, 'teknisi');
  await waitForPolls(page);
  const oltId = sql(`SELECT id FROM olt WHERE name = 'mock-1'`);
  const started = Date.now();

  await page.goto(`/provision/new?oltId=${oltId}`);
  await page.getByLabel('PON port').selectOption('1/1');
  await page.getByLabel('Serial number').fill(BRIDGE_SN);
  await page.getByLabel('ONU type').fill('ZTEG-F620');
  await page.getByLabel('T-CONT profile').selectOption('10M');
  await page.getByLabel('VLAN').selectOption('100');
  await page.getByLabel('Mode').selectOption('bridge');
  await page.getByLabel('LAN ports').selectOption('2');
  await page.getByLabel('Customer name').fill('Pelanggan-F3');
  await page.getByLabel('Description').fill('Rumah-F3');
  await page.getByRole('button', { name: 'Create preview' }).click();
  const preview = (await page.getByTestId('preview').textContent())!;
  const lines = preview.split('\n');
  expect(lines).toContain('description Rumah-F3');
  expect(lines).toContain('service bridging gemport 1 vlan 100');
  expect(lines.filter((l) => l.startsWith('vlan port'))).toEqual(['vlan port eth_0/1 mode tag vlan 100', 'vlan port eth_0/2 mode tag vlan 100']);
  expect(lines.at(-1)).toBe('write');
  await page.getByRole('button', { name: 'Submit to NOC' }).click();
  await expect(page.getByTestId('job-status')).toHaveText('Awaiting NOC approval');

  const nocCtx = await browser.newContext({ ignoreHTTPSErrors: true });
  const noc = await nocCtx.newPage();
  await login(noc, 'noc');
  await noc.goto('/approvals');
  const card = noc.getByTestId('approval-row').filter({ hasText: BRIDGE_SN });
  await expect(card).toContainText('Bridge');
  await expect(card).toContainText('2 LAN ports');
  await expect(card).toContainText('Rumah-F3');
  await card.getByRole('link').click();
  await expect(noc.getByTestId('job-preview')).toHaveText(preview);
  await noc.getByRole('button', { name: 'Approve and run' }).click();
  await nocCtx.close();

  await expect(page.getByTestId('job-status')).toHaveText('Succeeded', { timeout: 60_000 });
  await expect(page.getByTestId('job-applied')).toHaveText(preview);
  const sent = mockCommands(Math.ceil((Date.now() - started) / 1000) + 5).filter((c) => !c.startsWith('show '));
  const at = sent.indexOf(lines[0]!);
  expect(at).toBeGreaterThanOrEqual(0);
  expect(sent.slice(at, at + lines.length)).toEqual(lines);
});

// Registration mode pppoe_map (owner decision 2026-11-15); needs the mock-olt image with the PPPoE MAP lines.
test('admin runs a PPPoE MAP registration; the mock receives the PPPoE template and write', async ({ page }) => {
  await login(page, 'admin');
  await waitForPolls(page);
  const oltId = sql(`SELECT id FROM olt WHERE name = 'mock-1'`);
  sql(`INSERT INTO provision_allowlist (olt_id, kind, value) VALUES (${oltId}, 'vlan', '600') ON CONFLICT DO NOTHING`);
  const started = Date.now();

  await page.goto(`/provision/new?oltId=${oltId}`);
  await page.getByLabel('PON port').selectOption('1/1');
  await page.getByLabel('Serial number').fill(PPPOE_SN);
  await page.getByLabel('ONU type').fill('ZTEG-F620');
  await page.getByLabel('T-CONT profile').selectOption('10M');
  await page.getByLabel('VLAN').selectOption('600');
  await page.getByLabel('Mode').selectOption('pppoe_map');
  await page.getByLabel('PPPoE username').fill('AUD-03-E2E01-001');
  await page.getByLabel('PPPoE password').fill('rahasia.e2e');
  await page.getByLabel('Customer name').fill('Pelanggan-F4');
  await page.getByRole('button', { name: 'Create preview' }).click();
  const preview = (await page.getByTestId('preview').textContent())!;
  const lines = preview.split('\n');
  expect(lines).not.toContainEqual(expect.stringMatching(/^description /));
  expect(lines).toContain('gemport 1 name AUD tcont 1');
  expect(lines).toContain('wan-ip 1 mode pppoe username AUD-03-E2E01-001 password rahasia.e2e vlan-profile PPPoE host 1');
  expect(lines.at(-1)).toBe('write');
  await page.getByRole('button', { name: 'Confirm and run' }).click();

  await expect(page.getByTestId('job-status')).toHaveText('Succeeded', { timeout: 60_000 });
  await expect(page.getByTestId('job-applied')).toHaveText(preview);
  const sent = mockCommands(Math.ceil((Date.now() - started) / 1000) + 5).filter((c) => !c.startsWith('show '));
  const at = sent.indexOf(lines[0]!);
  expect(at).toBeGreaterThanOrEqual(0);
  expect(sent.slice(at, at + lines.length)).toEqual(lines);
});

// Registration mode bridge_static (owner decision 2026-11-17); needs the mock-olt image with the Bridge Static lines.
test('admin runs a Bridge Static registration; the mock receives both services and write', async ({ page }) => {
  await login(page, 'admin');
  await waitForPolls(page);
  const oltId = sql(`SELECT id FROM olt WHERE name = 'mock-1'`);
  const started = Date.now();

  await page.goto(`/provision/new?oltId=${oltId}`);
  await page.getByLabel('PON port').selectOption('1/1');
  await page.getByLabel('Serial number').fill(BRIDGE_STATIC_SN);
  await page.getByLabel('ONU type').fill('ZTEG-F620');
  await page.getByLabel('T-CONT profile').selectOption('10M');
  await page.getByLabel('VLAN').selectOption('100');
  await page.getByLabel('Mode').selectOption('bridge_static');
  await page.getByLabel('LAN ports').selectOption('2');
  await page.getByLabel('Bridge T-CONT profile').selectOption('UP-20M');
  await page.getByLabel('Bridge VLAN').selectOption('1245');
  await page.getByLabel('Customer name').fill('Pelanggan-F5');
  await page.getByLabel('Description').fill('JBB-F5');
  await page.getByRole('button', { name: 'Create preview' }).click();
  const preview = (await page.getByTestId('preview').textContent())!;
  const lines = preview.split('\n');
  expect(lines).toEqual(expect.arrayContaining(['tcont 1 profile 10M', 'tcont 2 profile UP-20M', 'service-port 2 vport 2 user-vlan 1245 vlan 1245']));
  expect(lines).toEqual(expect.arrayContaining(['service static gemport 1 vlan 100', 'service bridging gemport 2 vlan 1245']));
  expect(lines).toContain('port-identification sub-option remote-id enable vport 2');
  expect(lines.filter((l) => l.startsWith('vlan port'))).toEqual(['vlan port eth_0/1 mode tag vlan 1245', 'vlan port eth_0/2 mode tag vlan 1245']);
  expect(lines.at(-1)).toBe('write');
  await page.getByRole('button', { name: 'Confirm and run' }).click();

  await expect(page.getByTestId('job-status')).toHaveText('Succeeded', { timeout: 60_000 });
  await expect(page.getByTestId('job-applied')).toHaveText(preview);
  const sent = mockCommands(Math.ceil((Date.now() - started) / 1000) + 5).filter((c) => !c.startsWith('show '));
  const at = sent.indexOf(lines[0]!);
  expect(at).toBeGreaterThanOrEqual(0);
  expect(sent.slice(at, at + lines.length)).toEqual(lines);
});
