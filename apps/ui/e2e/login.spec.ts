import { expect, test } from '@playwright/test';
import { login } from './helpers.js';

// G1
test('NOC login lands on the dashboard', async ({ page }) => {
  await login(page, 'noc');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('a wrong password shows an error message', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Username').fill('noc');
  await page.getByLabel('Password').fill('salah-sekali');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Incorrect username or password.');
});

test('reloading a deep link (/onus/1) does not 404', async ({ page }) => {
  await login(page, 'noc');
  const res = await page.goto('/onus/1');
  expect(res?.status()).toBe(200);
  await page.reload();
  await expect(page.getByTestId('whoami')).toBeVisible();
});

test('without a session the app redirects to /login', async ({ page }) => {
  await page.goto('/alarms');
  await expect(page).toHaveURL(/\/login$/);
});
