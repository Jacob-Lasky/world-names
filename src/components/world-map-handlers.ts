// Pure functions for deck.gl click handlers, extracted so we can unit-test the
// state transitions without going through deck.gl + Playwright (which doesn't
// fire click events on the canvas in headless Chromium — see world-names #5).
//
// Both handlers also clear the hover state. Touch devices don't emit pointer-
// leave, so the layer's onHover never fires `null` on its own. Without an
// explicit clear, the last-tapped country sits in hover color after deselect.

import type { CountrySelection } from '../store/selection';
import type { Feature, Geometry } from 'geojson';

type CountryProps = { name: string };
type CountryFeature = Feature<Geometry, CountryProps>;

export type SelectionActions = {
  selectCountry: (country: CountrySelection | null) => void;
  hover: (numericId: string | null) => void;
};

export function featureId(f: CountryFeature): string {
  return String(f.id ?? '');
}

export function handleCountryClick(f: CountryFeature, actions: SelectionActions): void {
  actions.selectCountry({
    numericId: featureId(f),
    name: f.properties?.name ?? 'Unknown',
  });
  actions.hover(null);
}

export function handleBackgroundClick(picked: unknown, actions: SelectionActions): void {
  // Only deselect when the click missed a feature — clicks on a country are
  // already handled by the layer-level onClick.
  if (!picked) {
    actions.selectCountry(null);
    actions.hover(null);
  }
}
