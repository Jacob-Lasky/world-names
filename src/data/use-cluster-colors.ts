// React hook: given the currently-selected country's M49, returns a Map of
// observer-country M49 → cluster hue, ready for WorldMap to consume in
// its getFillColor. Returns null while idle / loading.

import { useEffect, useState } from 'react';
import { getDb } from './db';

export type ClusterColorMap = Map<string, { hue: number | null; cluster_id: string | null }>;

export function useClusterColors(targetM49: string | null | undefined): ClusterColorMap | null {
  const [colors, setColors] = useState<ClusterColorMap | null>(null);

  useEffect(() => {
    if (!targetM49) {
      setColors(null);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const db = await getDb();
        if (cancelled) return;
        const m = db.observerColorsByM49(targetM49);
        const out: ClusterColorMap = new Map();
        for (const [k, v] of m) out.set(k, { hue: v.hue, cluster_id: v.cluster_id });
        setColors(out);
      } catch (e) {
        if (cancelled) return;
        console.error('useClusterColors failed:', e);
        setColors(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [targetM49]);

  return colors;
}
