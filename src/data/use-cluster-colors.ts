// React hook: given the currently-selected country's M49, returns a Map of
// observer-country M49 → cluster hue, ready for WorldMap to consume in
// its getFillColor. Surfaces error state so a DB failure doesn't silently
// degrade the map to "no recoloring" with no user-visible explanation.

import { useEffect, useState } from 'react';
import { getDb } from './db';

export type ClusterColorMap = Map<string, { hue: number | null; cluster_id: string | null }>;

export type ClusterColorState =
  | { status: 'idle'; colors: null }
  | { status: 'loading'; colors: null }
  | { status: 'ready'; colors: ClusterColorMap }
  | { status: 'error'; colors: null; error: string };

export function useClusterColors(targetM49: string | null | undefined): ClusterColorState {
  const [state, setState] = useState<ClusterColorState>({ status: 'idle', colors: null });

  useEffect(() => {
    if (!targetM49) {
      setState({ status: 'idle', colors: null });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading', colors: null });

    (async () => {
      try {
        const db = await getDb();
        if (cancelled) return;
        const m = db.observerColorsByM49(targetM49);
        const out: ClusterColorMap = new Map();
        for (const [k, v] of m) out.set(k, { hue: v.hue, cluster_id: v.cluster_id });
        setState({ status: 'ready', colors: out });
      } catch (e: unknown) {
        if (cancelled) return;
        setState({
          status: 'error',
          colors: null,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [targetM49]);

  return state;
}
