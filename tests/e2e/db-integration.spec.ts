import { test, expect } from '@playwright/test';

test('selecting Germany shows Deutschland once the DB resolves', async ({ page }) => {
  // Forward browser console errors to the test runner so SQLite init failures
  // surface as the test reason rather than an opaque "no Deutschland" timeout.
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console error: ${m.text()}`);
  });

  await page.goto('/');
  await page.waitForSelector('canvas');
  await page.waitForTimeout(400); // let the deck.gl render settle

  // Drive selection via the dev handle since headless deck.gl clicks
  // don't fire (tracked in world-names #5).
  await page.evaluate(() => {
    const set = (window as unknown as { __setSelection?: (c: unknown) => void }).__setSelection;
    if (!set) throw new Error('__setSelection dev handle missing — is the app in DEV mode?');
    set({ numericId: '276', name: 'Germany' });
  });

  // First the polygon name appears in the loading state, then the DB resolves
  // and Deutschland takes over.
  await expect(page.getByRole('heading', { name: /Deutschland/i })).toBeVisible({ timeout: 10_000 });

  // Sanity: language line shows the German language.
  await expect(page.getByText(/spoken language: German/i)).toBeVisible();
  await expect(page.getByText(/ISO DEU/i)).toBeVisible();

  if (errors.length) {
    throw new Error(`browser errors during test:\n${errors.join('\n')}`);
  }
});
