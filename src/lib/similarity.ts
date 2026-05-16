// Color encoding for the world-names map.
//
// Two channels combine to color each country when one is selected:
//   1. HUE  = which etymological cluster the observer's exonym belongs to.
//             (Germany → Germani / Alemanni / Deutsch / Niemcy / Saksa / ...)
//             Hand-curated in etl/roots/<iso3>.yaml, joined into the SQLite.
//   2. LIGHTNESS / SATURATION = orthographic similarity of the exonym to
//             the selected country's endonym. Computed at ETL build time by
//             _lib.normalized_similarity. similarity=1 (exonym IS the
//             endonym, e.g. Germany clicking itself sees "Deutschland")
//             yields near-white; similarity=0 (no shared characters, e.g.
//             Japanese "ドイツ" vs "Deutschland") yields the cluster's base
//             saturated hue.
//
// Together: hue tells you "which family of names does this country use",
// lightness tells you "how foreign-sounding is that name relative to what
// the target calls itself." Same cluster, different scripts → same hue,
// different brightness — visually legible at a glance.
//
// Pure functions only; easy to unit-test with vitest.

export type Cluster = {
  /** Stable id, e.g. 'deu.deutsch'. */
  id: string;
  /** Human-readable label, e.g. 'Deutsch root'. */
  label: string;
  /** Hue in degrees [0, 360). Cluster's base color. */
  hue: number;
};

// Endpoints of the similarity lerp. Base = the cluster's saturated hue
// (similarity 0, "fully foreign"). Self-like = near-white tinted by the
// hue (similarity 1, "this IS the endonym"). Tuned by eye for legible
// gradient on the dark map background.
export const CLUSTER_BASE_SATURATION = 0.7;
export const CLUSTER_BASE_LIGHTNESS = 0.55;
export const SELF_LIKE_SATURATION = 0.18;
export const SELF_LIKE_LIGHTNESS = 0.92;

/**
 * Polygon fill for a country, given its cluster's hue and the orthographic
 * similarity of its exonym to the selected country's endonym (in [0, 1]).
 *
 * similarity = 1 → nearly white with a faint hue tint (this country's name
 *   IS what the target calls itself).
 * similarity = 0 → fully saturated cluster hue (this country's name is
 *   wholly foreign to the endonym's spelling).
 *
 * The selected country itself flows through this same function with
 * similarity = 1.0 — no special-case fill code needed in WorldMap.
 */
export function clusterFill(hue: number, similarity: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, similarity));
  const s = CLUSTER_BASE_SATURATION + (SELF_LIKE_SATURATION - CLUSTER_BASE_SATURATION) * t;
  const l = CLUSTER_BASE_LIGHTNESS + (SELF_LIKE_LIGHTNESS - CLUSTER_BASE_LIGHTNESS) * t;
  return hslToRgb(hue, s, l);
}

/**
 * CSS color string for the DetailPanel heading, using the same hue + lightness
 * gradient as the polygon fill. Pure function so the conditional fallback
 * behavior is unit-testable.
 *
 * Returns `null` for the caller to fall back to its own default (e.g. an
 * accent CSS variable) when:
 *   - no cluster data is ready (loading / error / no selection)
 *   - the selected country has no cluster row (target isn't covered by an
 *     etl/roots/<iso3>.yaml yet)
 */
export function selectedHeadingColor(
  row: { hue: number | null; similarity: number | null } | null | undefined,
): string | null {
  if (!row || row.hue == null) return null;
  const [r, g, b] = clusterFill(row.hue, row.similarity ?? 1);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * HSL → 0-255 RGB tuple. Used by clusterFill; exported because the polygon
 * stroke + hover paths sometimes want an HSL-derived color of their own.
 */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0, g1 = 0, b1 = 0;
  if (hp < 1) { r1 = c; g1 = x; }
  else if (hp < 2) { r1 = x; g1 = c; }
  else if (hp < 3) { g1 = c; b1 = x; }
  else if (hp < 4) { g1 = x; b1 = c; }
  else if (hp < 5) { r1 = x; b1 = c; }
  else { r1 = c; b1 = x; }
  const m = l - c / 2;
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
}
