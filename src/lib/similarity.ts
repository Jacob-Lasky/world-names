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
