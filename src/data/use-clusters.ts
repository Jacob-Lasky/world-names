// React hook: given the currently-selected country's M49, returns the
// list of etymological-root clusters for that target with their hue,
// label, etymology origin, and observer-country count.
//
// Cache-keyed-derivation pattern (matches use-cluster-colors,
// use-country-detail, use-inspection-detail). The effect only calls
// setState asynchronously, keeping react-hooks/set-state-in-effect
// happy.

import { useEffect, useState } from 'react';
import { getDb } from './db';
import type { ClusterSummary } from './types';

export type ClustersState =
  | { status: 'idle'; clusters: null }
  | { status: 'loading'; clusters: null }
  | { status: 'ready'; clusters: ClusterSummary[] }
  | { status: 'error'; clusters: null; error: string };

type Cache =
  | { kind: 'empty' }
  | { kind: 'resolved'; key: string; clusters: ClusterSummary[] }
  | { kind: 'errored'; key: string; error: string };

export function useClusters(targetM49: string | null | undefined): ClustersState {
  const [cache, setCache] = useState<Cache>({ kind: 'empty' });

  useEffect(() => {
    if (!targetM49) return;
    let cancelled = false;
    (async () => {
      try {
        const db = await getDb();
        if (cancelled) return;
        const clusters = db.clustersForTarget(targetM49);
        setCache({ kind: 'resolved', key: targetM49, clusters });
      } catch (e: unknown) {
        if (cancelled) return;
        setCache({ kind: 'errored', key: targetM49, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetM49]);

  if (!targetM49) return { status: 'idle', clusters: null };
  if (cache.kind === 'resolved' && cache.key === targetM49) {
    return { status: 'ready', clusters: cache.clusters };
  }
  if (cache.kind === 'errored' && cache.key === targetM49) {
    return { status: 'error', clusters: null, error: cache.error };
  }
  return { status: 'loading', clusters: null };
}
