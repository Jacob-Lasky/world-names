import { test, expect } from '@playwright/test';

// Visual artifact for the similarity-encoding feature. Captures a screenshot
// after selecting Germany so the cluster recolor + bold black outline are
// observable post-deploy. Pairs with src/lib/similarity.test.ts (unit
// coverage of the color math) — Vitest fixtures prove parser shape, this
// screenshot proves the encoding renders end-to-end through deck.gl + the
// real SQLite WASM payload.

test('selecting Germany renders the cluster recolor with bold outline + tinted heading', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console error: ${m.text()}`);
  });

  await page.goto('/');
  await page.waitForSelector('canvas');
  // Let deck.gl finish its initial render before we drive selection — the
  // first frame can otherwise paint the default fills.
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    const set = (window as unknown as { __setSelection?: (c: unknown) => void }).__setSelection;
    if (!set) throw new Error('__setSelection dev handle missing — is the app in DEV mode?');
    set({ numericId: '276', name: 'Germany' });
  });

  // Wait for the endonym heading to land (DB resolved) — the cluster recolor
  // lands at the same time since both go through useClusterColors.
  const heading = page.getByRole('heading', { name: /Deutschland/i });
  await expect(heading).toBeVisible({ timeout: 10_000 });

  // The heading should be tinted with a cluster color, not the default accent
  // var. We don't assert the exact rgb (depends on cluster YAML hue choices)
  // but we DO assert it's not the accent color and not transparent.
  const headingColor = await heading.evaluate((el) => getComputedStyle(el).color);
  // Accent is set in the CSS as a specific orange. Whatever the cluster tint
  // is, it shouldn't equal the orange (--accent: #ffb86b).
  expect(headingColor).not.toBe('rgb(255, 184, 107)');
  expect(headingColor).toMatch(/^rgb\(/);

  // Give the cluster recolor one more frame to paint before the screenshot.
  await page.waitForTimeout(300);

  // Visual artifact: full-page screenshot showing the recolored map + tinted
  // heading. Saved under test-results/ where CI picks it up as an artifact.
  await page.screenshot({
    path: 'test-results/cluster-encoding-germany.png',
    fullPage: true,
  });

  if (errors.length) {
    throw new Error(`browser errors during test:\n${errors.join('\n')}`);
  }
});
