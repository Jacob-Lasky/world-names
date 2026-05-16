import { test, expect } from '@playwright/test';

test('app shell renders with header, map slot, and detail panel', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'World Names' })).toBeVisible();
  await expect(page.getByTestId('world-map')).toBeVisible();
  await expect(page.getByTestId('detail-panel')).toBeVisible();
});
