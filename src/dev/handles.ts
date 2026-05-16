// Dev-only test affordances. Tree-shaken from production by the
// `import.meta.env.DEV` guard. Kept in a dedicated module so app code
// (App.tsx, components, store) stays free of test concerns.
//
// Why this exists: deck.gl's click events don't fire reliably in headless
// Playwright (see world-names #5). To exercise state transitions in
// mobile-stability and similar tests, we expose a window handle that drives
// the Zustand selection store directly.

import { useSelection } from '../store/selection';

if (import.meta.env.DEV) {
  (window as unknown as { __setSelection?: unknown }).__setSelection =
    useSelection.getState().selectCountry;
}
