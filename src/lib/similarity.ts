// Etymological-root clustering primitives.
//
// The viz colors countries by which root-cluster their exonym for the selected
// country belongs to (e.g. Germany → Germani / Alemanni / Deutsch / Niemcy /
// Saksa). String-distance is intentionally NOT the primary metric — different
// roots can rhyme by accident, and same-root names can have huge edit distance
// (Deutschland vs Tyskland). The ETL pipeline emits cluster labels per
// (observer, target) pair; runtime just looks them up.
//
// This module hosts the small helpers the UI uses for color assignment within
// a cluster (lightness gradient from cluster centroid, etc). Pure functions
// only — easy to unit-test with vitest.

export type Cluster = {
  /** Stable id, e.g. 'germany.deutsch'. */
  id: string;
  /** Human-readable label, e.g. 'Deutsch root'. */
  label: string;
  /** Hue in degrees [0, 360). Cluster's base color. */
  hue: number;
};

/**
 * Within-cluster color: same hue, lightness varies by intra-cluster distance.
 * `distance` is in [0, 1], where 0 = cluster centroid, 1 = farthest member.
 */
export function clusterColor(cluster: Cluster, distance: number): string {
  const clamped = Math.max(0, Math.min(1, distance));
  const lightness = 65 - clamped * 25; // 65% (close) → 40% (far)
  return `hsl(${cluster.hue} 70% ${lightness}%)`;
}

/**
 * HSL → 0-255 RGB tuple. Used to compute deck.gl polygon fill colors from
 * cluster hues stored in the SQLite. Defaults match `clusterColor`'s
 * centroid lightness so the live map fills line up with any CSS swatches.
 */
export function hslToRgb(h: number, s = 0.6, l = 0.5): [number, number, number] {
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
