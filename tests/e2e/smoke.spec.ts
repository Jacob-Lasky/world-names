import { test, expect } from '@playwright/test';

test('app shell renders with header, map slot, and detail panel', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'World Names' })).toBeVisible();
  await expect(page.getByTestId('world-map')).toBeVisible();
  await expect(page.getByTestId('detail-panel')).toBeVisible();
});

test('country polygons render to a visible canvas', async ({ page }) => {
  await page.goto('/');
  const map = page.getByTestId('world-map');
  const canvas = map.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: 10_000 });

  // Allow topojson decode + first deck.gl frame.
  await page.waitForTimeout(500);

  // Sanity: the canvas should occupy meaningful area.
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(400);
  expect(box!.height).toBeGreaterThan(300);

  // Visual artifact — flushed to test-results/ for review.
  await page.screenshot({ path: 'test-results/world-map-loaded.png', fullPage: true });
});
