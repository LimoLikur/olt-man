import { expect, test } from '@playwright/test';

const html = (page: import('@playwright/test').Page) => page.locator('html');

test('theme: system by default, Dark persists across reloads, System follows the OS', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/login');
  await expect(html(page)).not.toHaveClass(/\bdark\b/);

  await page.getByRole('button', { name: 'Theme' }).click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(html(page)).toHaveClass(/\bdark\b/);

  // public/theme-init.js applies the stored choice before the app bundle runs.
  await page.reload();
  await expect(html(page)).toHaveClass(/\bdark\b/);

  await page.getByRole('button', { name: 'Theme' }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitemradio', { name: 'System' }).click();
  await expect(html(page)).not.toHaveClass(/\bdark\b/);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html(page)).toHaveClass(/\bdark\b/);
});
