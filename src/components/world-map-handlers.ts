// Pure functions for deck.gl click handlers, extracted so we can unit-test the
// state transitions without going through deck.gl + Playwright (which doesn't
// fire click events on the canvas in headless Chromium — see world-names #5).
//
// Two distinct intents, four platform mappings:
//
//   INSPECT (show a country's name for the current selection — transient)
//     Desktop: hover
//     Mobile:  tap
//
//   SELECT  (change which country drives the map recolor — durable)
//     Desktop: click
//     Mobile:  long-press
//
// Both select handlers also clear the hover state, because changing focus
// makes any prior inspection stale. Touch devices don't emit pointer-leave,
// so the layer's onHover never fires `null` on its own — explicit clears
// keep the last-tapped country from sitting in hover color after deselect.

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

/** Did this deck.gl event originate from a touchscreen?
 *
 *  deck.gl attaches the underlying browser event at runtime via
 *  `info.event`, but the typed PickingInfo doesn't include it (event is
 *  the second arg of the layer's onClick signature; deck.gl's runtime
 *  layers it onto the info object regardless). We runtime-narrow the
 *  shape rather than cast: PointerEvents expose `pointerType`, and
 *  `'touch'` is the value we care about for forking desktop (mouse →
 *  click=SELECT, hover=INSPECT) from mobile (touch → tap=INSPECT,
 *  long-press=SELECT).
 *
 *  Takes `unknown` so call sites pass deck.gl's PickingInfo directly
 *  without local casts. Returns false for any non-touch / malformed
 *  shape — never throws.
 */
export function isTouchEvent(info: unknown): boolean {
  if (!info || typeof info !== 'object') return false;
  const event = (info as { event?: unknown }).event;
  if (!event || typeof event !== 'object') return false;
  const srcEvent = (event as { srcEvent?: unknown }).srcEvent;
  if (!srcEvent || typeof srcEvent !== 'object') return false;
  return (srcEvent as { pointerType?: unknown }).pointerType === 'touch';
}

/** SELECT: change focus to this country. Clears any open inspection. */
export function handleCountrySelect(f: CountryFeature, actions: SelectionActions): void {
  actions.selectCountry({
    numericId: featureId(f),
    name: f.properties?.name ?? 'Unknown',
  });
  actions.hover(null);
}

/** INSPECT: highlight this country and surface what it calls the selected
 *  country. Leaves the existing selection untouched.
 *
 *  No-op when the inspected country IS the selected country — the
 *  inspection card has nothing extra to add about a country relative to
 *  itself.
 */
export function handleCountryInspect(
  f: CountryFeature,
  actions: SelectionActions,
  selectedId: string | null,
): void {
  const id = featureId(f);
  if (id === selectedId) {
    actions.hover(null);
    return;
  }
  actions.hover(id);
}

/** DESELECT: triggered by a click that missed every feature (desktop only).
 *  Clears both selection and inspection.
 */
export function handleBackgroundDeselect(picked: unknown, actions: SelectionActions): void {
  if (!picked) {
    actions.selectCountry(null);
    actions.hover(null);
  }
}

/** Mobile background tap: clear inspection without disturbing the
 *  selection. Wayward background taps shouldn't blow away the user's
 *  focus; they often happen mid-pan.
 */
export function handleBackgroundDismissInspection(picked: unknown, actions: SelectionActions): void {
  if (!picked) {
    actions.hover(null);
  }
}
