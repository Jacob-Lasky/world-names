import { describe, it, expect } from 'vitest';
import { clusterColor, type Cluster } from './similarity';

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
