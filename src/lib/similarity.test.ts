import { describe, it, expect } from 'vitest';
import { clusterColor, hslToRgb, type Cluster } from './similarity';

const cluster: Cluster = { id: 'test', label: 'Test', hue: 30 };

describe('clusterColor', () => {
  it('emits a centroid-bright color at distance 0', () => {
    expect(clusterColor(cluster, 0)).toBe('hsl(30 70% 65%)');
  });

  it('emits a darker color at maximum distance', () => {
    expect(clusterColor(cluster, 1)).toBe('hsl(30 70% 40%)');
  });

  it('clamps out-of-range distances', () => {
    expect(clusterColor(cluster, -0.5)).toBe('hsl(30 70% 65%)');
    expect(clusterColor(cluster, 2)).toBe('hsl(30 70% 40%)');
  });

  it('preserves cluster hue across the gradient', () => {
    for (const d of [0, 0.25, 0.5, 0.75, 1]) {
      expect(clusterColor(cluster, d)).toMatch(/^hsl\(30 70% \d+(\.\d+)?%\)$/);
    }
  });
});

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
