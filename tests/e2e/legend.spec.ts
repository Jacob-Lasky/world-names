import { test, expect } from '@playwright/test';

// Legend overlay: shows one chip per etymological-root cluster when a
// country with cluster coverage is selected. Clicking a chip pins
// focus to that cluster.

test('legend renders one chip per cluster after selecting Germany', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console error: ${m.text()}`);
  });

  await page.goto('/');
  await page.waitForSelector('canvas');
  await page.waitForTimeout(400);

  // No selection yet → no legend.
  await expect(page.getByTestId('cluster-legend')).not.toBeVisible();

  // Select Germany via the dev handle.
  await page.evaluate(() => {
    const set = (window as unknown as { __setSelection?: (c: unknown) => void }).__setSelection;
    set?.({ numericId: '276', name: 'Germany' });
  });

  // Wait for the detail panel to resolve before checking the legend —
  // both consume the same SQLite, so once one's ready they both are.
  await expect(page.getByRole('heading', { name: /Deutschland/i })).toBeVisible({ timeout: 10_000 });

  // Legend shows up.
  const legend = page.getByTestId('cluster-legend');
  await expect(legend).toBeVisible();

  // DEU.yaml has 7 clusters. The chip text is the short etymological
  // root name (the part before " — " in the cluster label). Match
  // chips by their accessible name (includes " cluster" suffix), not
  // by raw text — "Germani" appears as a substring of "Proto-Germanic"
  // so a plain text match collides.
  for (const root of [/^Germani cluster/, /^Alemanni cluster/, /^Proto-Germanic .* cluster/, /^Slavic .* cluster/, /^Saxons cluster/]) {
    await expect(legend.getByRole('button', { name: root })).toBeVisible();
  }

  // Each chip is a button — pick one and exercise the focus toggle.
  const germaniChip = legend.getByRole('button', { name: /Germani cluster/i });
  await expect(germaniChip).toHaveAttribute('aria-pressed', 'false');

  // Click to focus the cluster — aria-pressed flips.
  await germaniChip.click();
  await expect(germaniChip).toHaveAttribute('aria-pressed', 'true');

  // Other chips remain unpressed (only one focus at a time).
  const slavicChip = legend.getByRole('button', { name: /Slavic .* cluster/i });
  await expect(slavicChip).toHaveAttribute('aria-pressed', 'false');

  // Click slavic → focus moves there, germani releases.
  await slavicChip.click();
  await expect(germaniChip).toHaveAttribute('aria-pressed', 'false');
  await expect(slavicChip).toHaveAttribute('aria-pressed', 'true');

  // Click again → focus clears.
  await slavicChip.click();
  await expect(slavicChip).toHaveAttribute('aria-pressed', 'false');

  // Visual artifact with the Germani cluster focused.
  await germaniChip.click();
  await page.waitForTimeout(300);
  await page.screenshot({
    path: 'test-results/legend-germani-focused.png',
    fullPage: true,
  });

  if (errors.length) {
    throw new Error(`browser errors during test:\n${errors.join('\n')}`);
  }
});

test('legend focus clears when selection changes between countries', async ({ page }) => {
  // After auto-clustering, every country gets a legend, so the test
  // is about focus-reset across selections rather than legend
  // disappearance. The store's selectCountry action clears
  // focusedClusterId atomically — pinning a cluster on Germany must
  // not carry into France.
  await page.goto('/');
  await page.waitForSelector('canvas');
  await page.waitForTimeout(400);

  await page.evaluate(() => {
    const set = (window as unknown as { __setSelection?: (c: unknown) => void }).__setSelection;
    set?.({ numericId: '276', name: 'Germany' });
  });
  await expect(page.getByTestId('cluster-legend')).toBeVisible({ timeout: 10_000 });

  // Pin a cluster.
  const chip = page.getByTestId('cluster-legend').getByRole('button').first();
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');

  // Switch to France (auto-clustered post #14, still shows a legend).
  await page.evaluate(() => {
    const set = (window as unknown as { __setSelection?: (c: unknown) => void }).__setSelection;
    set?.({ numericId: '250', name: 'France' });
  });

  // Legend still visible, but with France's clusters; no chip pressed.
  await expect(page.getByTestId('cluster-legend')).toBeVisible({ timeout: 5_000 });
  const franceFirstChip = page.getByTestId('cluster-legend').getByRole('button').first();
  await expect(franceFirstChip).toHaveAttribute('aria-pressed', 'false');

  // Re-select Germany — focused cluster must NOT persist.
  await page.evaluate(() => {
    const set = (window as unknown as { __setSelection?: (c: unknown) => void }).__setSelection;
    set?.({ numericId: '276', name: 'Germany' });
  });
  await expect(page.getByTestId('cluster-legend')).toBeVisible({ timeout: 10_000 });
  const chipAfter = page.getByTestId('cluster-legend').getByRole('button').first();
  await expect(chipAfter).toHaveAttribute('aria-pressed', 'false');
});

test('auto-detected indicator appears for auto-generated clusters, hides for hand-curated', async ({ page }) => {
  // Germany is hand-curated (etl/roots/DEU.yaml without auto_generated
  // flag) → no indicator. France is auto-generated → indicator.
  await page.goto('/');
  await page.waitForSelector('canvas');
  await page.waitForTimeout(400);

  // Germany: hand-curated. Indicator absent.
  await page.evaluate(() => {
    const set = (window as unknown as { __setSelection?: (c: unknown) => void }).__setSelection;
    set?.({ numericId: '276', name: 'Germany' });
  });
  await expect(page.getByTestId('cluster-legend')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('legend-auto-indicator')).not.toBeVisible();

  // France: auto-generated. Indicator visible with descriptive tooltip.
  await page.evaluate(() => {
    const set = (window as unknown as { __setSelection?: (c: unknown) => void }).__setSelection;
    set?.({ numericId: '250', name: 'France' });
  });
  const indicator = page.getByTestId('legend-auto-indicator');
  await expect(indicator).toBeVisible({ timeout: 5_000 });
  await expect(indicator).toHaveText(/auto/i);
});
