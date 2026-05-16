import { test, expect } from '@playwright/test';

// Inspection flow: with Germany selected, "inspecting" France (hover on
// desktop, tap on mobile) should surface what France calls Germany +
// the etymological cluster, without changing the selection.
//
// We drive both state transitions via the dev __setSelection / __setHover
// handles because deck.gl's pointer events don't propagate reliably in
// headless Chromium (see world-names #5). The handles call the same
// Zustand actions the real interactions trigger, so the UI flow they
// drive is identical to the production interaction.

test('inspection card surfaces observer exonym + cluster etymology', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console error: ${m.text()}`);
  });

  await page.goto('/');
  await page.waitForSelector('canvas');
  await page.waitForTimeout(400);

  // Select Germany (M49 276).
  await page.evaluate(() => {
    const set = (window as unknown as { __setSelection?: (c: unknown) => void }).__setSelection;
    if (!set) throw new Error('__setSelection dev handle missing — is the app in DEV mode?');
    set({ numericId: '276', name: 'Germany' });
  });

  // Wait for selection card to land (DB resolved).
  await expect(page.getByRole('heading', { name: /Deutschland/i })).toBeVisible({ timeout: 10_000 });

  // Inspection: France (M49 250).
  await page.evaluate(() => {
    const setHover = (window as unknown as { __setHover?: (id: string | null) => void }).__setHover;
    if (!setHover) throw new Error('__setHover dev handle missing');
    setHover('250');
  });

  // The inspection card should appear with France's exonym for Germany.
  const inspectionCard = page.getByTestId('inspection-card');
  await expect(inspectionCard).toBeVisible({ timeout: 5_000 });
  await expect(inspectionCard).toContainText(/France calls it/i);
  await expect(inspectionCard).toContainText(/Allemagne/i);
  // Etymology: France's alemanni cluster.
  await expect(inspectionCard).toContainText(/Alemanni/i);

  // Selection card should still be present and unchanged — inspection
  // doesn't displace the focus.
  await expect(page.getByRole('heading', { name: /Deutschland/i })).toBeVisible();

  // Clear inspection — card should disappear.
  await page.evaluate(() => {
    const setHover = (window as unknown as { __setHover?: (id: string | null) => void }).__setHover;
    setHover?.(null);
  });
  await expect(inspectionCard).not.toBeVisible();

  // Inspect again, this time Poland (M49 616). Different cluster — Niemcy.
  await page.evaluate(() => {
    const setHover = (window as unknown as { __setHover?: (id: string | null) => void }).__setHover;
    setHover?.('616');
  });
  await expect(inspectionCard).toBeVisible({ timeout: 5_000 });
  await expect(inspectionCard).toContainText(/Poland calls it/i);
  await expect(inspectionCard).toContainText(/Niemcy/i);

  // Visual artifact: full-page screenshot showing both cards (selected
  // Germany + inspecting Poland → Niemcy).
  await page.waitForTimeout(300);
  await page.screenshot({
    path: 'test-results/inspection-germany-poland.png',
    fullPage: true,
  });

  if (errors.length) {
    throw new Error(`browser errors during test:\n${errors.join('\n')}`);
  }
});

test('inspecting the selected country itself collapses to no inspection card', async ({ page }) => {
  // The handler ignores hover on the selected feature (handleCountryInspect
  // calls hover(null) instead). Verifies the inspection panel doesn't fight
  // for space with the selection card.
  await page.goto('/');
  await page.waitForSelector('canvas');
  await page.waitForTimeout(400);

  await page.evaluate(() => {
    const set = (window as unknown as { __setSelection?: (c: unknown) => void }).__setSelection;
    set?.({ numericId: '276', name: 'Germany' });
  });

  await expect(page.getByRole('heading', { name: /Deutschland/i })).toBeVisible({ timeout: 10_000 });

  // Hover GERMANY (the selected country). The store still accepts this
  // (the dev handle bypasses our handler), but the InspectionCard short-
  // circuits when hoveredId === selectedId.
  await page.evaluate(() => {
    const setHover = (window as unknown as { __setHover?: (id: string | null) => void }).__setHover;
    setHover?.('276');
  });

  await expect(page.getByTestId('inspection-card')).not.toBeVisible();
});
