import { expect, test } from '@playwright/test';
import { login, sql, waitForPolls } from './helpers.js';

// J1: the strict CSP from caddy (default-src 'self') must not break any page.
test('no CSP violations on the main pages', async ({ page }) => {
  const violations: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e: SecurityPolicyViolationEvent) => {
      (window as unknown as { __csp: string[] }).__csp ??= [];
      (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) violations.push(m.text());
  });

  const res = await page.goto('/login');
  expect(res?.headers()['content-security-policy']).toContain("default-src 'self'");
  await login(page, 'admin');
  await waitForPolls(page);
  const oltId = sql(`SELECT id FROM olt WHERE name = 'mock-1'`);
  const onuId = sql(`SELECT onu_id FROM onu_metric WHERE rx_dbm IS NOT NULL ORDER BY ts DESC LIMIT 1`);
  for (const path of ['/', `/olts/${oltId}`, '/onus', `/onus/${onuId}`, '/alarms', `/provision/new?oltId=${oltId}`, '/olts/new']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const caught = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
    violations.push(...caught.map((c) => `${path}: ${c}`));
  }
  expect(violations).toEqual([]);
});
