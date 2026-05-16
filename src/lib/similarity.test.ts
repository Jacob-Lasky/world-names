import { describe, it, expect } from 'vitest';
import {
  clusterFill,
  hslToRgb,
  selectedHeadingColor,
  CLUSTER_BASE_LIGHTNESS,
  CLUSTER_BASE_SATURATION,
  SELF_LIKE_LIGHTNESS,
  SELF_LIKE_SATURATION,
} from './similarity';

describe('hslToRgb', () => {
  it('emits red at hue 0', () => {
    expect(hslToRgb(0, 1, 0.5)).toEqual([255, 0, 0]);
  });
  it('emits green at hue 120', () => {
    expect(hslToRgb(120, 1, 0.5)).toEqual([0, 255, 0]);
  });
  it('emits blue at hue 240', () => {
    expect(hslToRgb(240, 1, 0.5)).toEqual([0, 0, 255]);
  });
  it('emits gray at zero saturation', () => {
    const [r, g, b] = hslToRgb(123, 0, 0.5);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });
  it('handles hue wrapping past 360', () => {
    expect(hslToRgb(720, 1, 0.5)).toEqual(hslToRgb(0, 1, 0.5));
  });
});

describe('clusterFill', () => {
  // The contract: similarity=0 returns the cluster's saturated base color,
  // similarity=1 returns a near-white tint of the same hue. Anything in
  // between lerps both saturation and lightness.

  it('at similarity 0, equals the base cluster color', () => {
    expect(clusterFill(30, 0)).toEqual(
      hslToRgb(30, CLUSTER_BASE_SATURATION, CLUSTER_BASE_LIGHTNESS),
    );
  });

  it('at similarity 1, equals the near-white self-like color', () => {
    expect(clusterFill(30, 1)).toEqual(
      hslToRgb(30, SELF_LIKE_SATURATION, SELF_LIKE_LIGHTNESS),
    );
  });

  it('at similarity 1, the result is much brighter than at similarity 0', () => {
    // Channel-by-channel: each component of the similarity=1 fill should be
    // strictly brighter (closer to 255) than the similarity=0 fill. This is
    // the visual contract — "more similar" is "more white."
    const dim = clusterFill(30, 0);
    const bright = clusterFill(30, 1);
    for (let i = 0; i < 3; i++) {
      expect(bright[i]).toBeGreaterThan(dim[i]);
    }
  });

  it('clamps out-of-range similarity', () => {
    expect(clusterFill(30, -0.5)).toEqual(clusterFill(30, 0));
    expect(clusterFill(30, 1.7)).toEqual(clusterFill(30, 1));
  });

  it('preserves hue across the gradient', () => {
    // A grayscale value (R==G==B) would only happen at exactly s=0; otherwise
    // the hue should leave a clear chromatic signature. For hue=30 (orange)
    // the red channel should dominate at every similarity step.
    for (const sim of [0, 0.25, 0.5, 0.75]) {
      const [r, g, b] = clusterFill(30, sim);
      expect(r).toBeGreaterThan(b);
      expect(r).toBeGreaterThanOrEqual(g);
    }
  });

  it('similarity=1 is close to pure white but not identical', () => {
    // We want "near-white tinted by the hue", not literal #ffffff — the tint
    // is how the eye still groups same-cluster countries together at the
    // bright end of the gradient.
    const [r, g, b] = clusterFill(30, 1);
    expect(Math.min(r, g, b)).toBeGreaterThan(200);
    expect(Math.max(r, g, b)).toBeLessThan(255);
  });
});

describe('selectedHeadingColor', () => {
  // Pure helper used by DetailPanel. Returns the CSS rgb() string when the
  // selected country has a cluster row with a real hue, null otherwise.
  // null means "caller falls back to its own default (e.g. --accent)".

  it('returns null when row is null (no cluster data)', () => {
    expect(selectedHeadingColor(null)).toBeNull();
  });

  it('returns null when row is undefined', () => {
    expect(selectedHeadingColor(undefined)).toBeNull();
  });

  it('returns null when hue is null (cluster row exists but no YAML coverage)', () => {
    expect(selectedHeadingColor({ hue: null, similarity: 1 })).toBeNull();
  });

  it('returns an rgb string at similarity=1 for a real hue', () => {
    // Matches the polygon at the self-like end of the gradient — heading
    // text reads the same color as the country's polygon fill on the map.
    const result = selectedHeadingColor({ hue: 200, similarity: 1 });
    expect(result).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    const match = result?.match(/^rgb\((\d+), (\d+), (\d+)\)$/);
    expect(match).not.toBeNull();
    if (match) {
      const [, r, g, b] = match.map(Number);
      // Near-white range
      expect(Math.min(r, g, b)).toBeGreaterThan(200);
    }
  });

  it('defaults similarity to 1 when null (treats selected country as self)', () => {
    // The selected country's own exonym IS its endonym, so similarity should
    // be 1 in the SQLite — but if it ever lands as null we default to 1
    // (self-like) rather than 0 (foreign).
    expect(selectedHeadingColor({ hue: 200, similarity: null })).toBe(
      selectedHeadingColor({ hue: 200, similarity: 1 }),
    );
  });
});
