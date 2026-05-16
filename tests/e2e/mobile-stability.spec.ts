import { test, expect } from '@playwright/test';

test('mobile: map area stays stable when panel content changes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); // iPhone 14
  await page.goto('/');
  const map = page.getByTestId('world-map');
  await expect(map).toBeVisible();
  await page.waitForTimeout(800);

  const before = await map.boundingBox();
  await page.screenshot({ path: 'test-results/mobile-empty.png', fullPage: false });

  // Drive the Zustand store directly to simulate a selection with a blurb,
  // since headless deck.gl clicks aren't reliable. This tests the layout
  // behavior, not the click path (which has its own component-level test).
  await page.evaluate(() => {
    // @ts-expect-error - this requires the dev-only debug handle wired by App
    const set = window.__setSelection;
    if (set) {
      set({
        numericId: '276',
        name: 'Germany',
        iso3: 'DEU',
        endonym: 'Deutschland',
        language: 'German',
        blurb: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ' +
               'Sed do eiusmod tempor incididunt ut labore et dolore magna ' +
               'aliqua. Ut enim ad minim veniam, quis nostrud exercitation ' +
               'ullamco laboris nisi ut aliquip ex ea commodo consequat.',
      });
    }
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/mobile-selected.png', fullPage: false });

  const after = await map.boundingBox();

  // Same dimensions before and after content change → map row didn't reflow.
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  expect(after!.height).toBe(before!.height);
  expect(after!.width).toBe(before!.width);
});
