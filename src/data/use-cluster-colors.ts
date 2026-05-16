// React hook: given the currently-selected country's M49, returns a Map of
// observer-country M49 → cluster hue + similarity, ready for WorldMap to
// consume in its getFillColor. Surfaces error state so a DB failure
// doesn't silently degrade the map to "no recoloring" with no user-visible
// explanation.
//
// Idle/loading/ready/error is derived during render from the cached result
// key, so the effect only ever calls setState asynchronously (post-await).
// The linter's react-hooks/set-state-in-effect rule rejects synchronous
// setState inside an effect body — see the cache-keyed-derivation pattern.

import { useEffect, useState } from 'react';
import { getDb } from './db';

export type ClusterColorMap = Map<string, { hue: number | null; cluster_id: string | null; similarity: number | null }>;

export type ClusterColorState =
  | { status: 'idle'; colors: null }
  | { status: 'loading'; colors: null }
  | { status: 'ready'; colors: ClusterColorMap }
  | { status: 'error'; colors: null; error: string };

type Cache =
  | { kind: 'empty' }
  | { kind: 'resolved'; key: string; colors: ClusterColorMap }
  | { kind: 'errored'; key: string; error: string };

export function useClusterColors(targetM49: string | null | undefined): ClusterColorState {
  const [cache, setCache] = useState<Cache>({ kind: 'empty' });

  useEffect(() => {
    if (!targetM49) return;
    let cancelled = false;
    (async () => {
      try {
        const db = await getDb();
        if (cancelled) return;
        const m = db.observerColorsByM49(targetM49);
        const out: ClusterColorMap = new Map();
        for (const [k, v] of m) out.set(k, { hue: v.hue, cluster_id: v.cluster_id, similarity: v.similarity });
        setCache({ kind: 'resolved', key: targetM49, colors: out });
      } catch (e: unknown) {
        if (cancelled) return;
        setCache({
          kind: 'errored',
          key: targetM49,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetM49]);

  if (!targetM49) return { status: 'idle', colors: null };
  if (cache.kind === 'resolved' && cache.key === targetM49) {
    return { status: 'ready', colors: cache.colors };
  }
  if (cache.kind === 'errored' && cache.key === targetM49) {
    return { status: 'error', colors: null, error: cache.error };
  }
  return { status: 'loading', colors: null };
}
