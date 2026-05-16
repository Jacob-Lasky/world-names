// React hook: given the currently-selected country's M49 + the inspected
// country's M49 (from a hover or tap), resolves the secondary inspection
// detail — what the inspected country calls the selected country, plus
// the etymological cluster label and origin.
//
// Cache-keyed-derivation pattern (matches use-cluster-colors + use-country-
// detail): idle/loading/ready/error is computed during render from a
// cached result keyed on (target, observer), so the effect only calls
// setState after the await. Keeps react-hooks/set-state-in-effect happy.

import { useEffect, useState } from 'react';
import { getDb } from './db';
import type { InspectionDetail } from './types';

export type InspectionDetailState =
  | { status: 'idle'; detail: null }
  | { status: 'loading'; detail: null }
  | { status: 'ready'; detail: InspectionDetail | null }
  | { status: 'error'; detail: null; error: string };

type CacheKey = `${string}::${string}`;
type Cache =
  | { kind: 'empty' }
  | { kind: 'resolved'; key: CacheKey; detail: InspectionDetail | null }
  | { kind: 'errored'; key: CacheKey; error: string };

function makeKey(target: string, observer: string): CacheKey {
  return `${target}::${observer}`;
}

export function useInspectionDetail(
  targetM49: string | null | undefined,
  observerM49: string | null | undefined,
): InspectionDetailState {
  const [cache, setCache] = useState<Cache>({ kind: 'empty' });

  useEffect(() => {
    if (!targetM49 || !observerM49) return;
    const key = makeKey(targetM49, observerM49);
    let cancelled = false;
    (async () => {
      try {
        const db = await getDb();
        if (cancelled) return;
        const detail = db.inspectionDetail(targetM49, observerM49);
        setCache({ kind: 'resolved', key, detail });
      } catch (e: unknown) {
        if (cancelled) return;
        setCache({ kind: 'errored', key, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetM49, observerM49]);

  if (!targetM49 || !observerM49) return { status: 'idle', detail: null };
  const key = makeKey(targetM49, observerM49);
  if (cache.kind === 'resolved' && cache.key === key) {
    return { status: 'ready', detail: cache.detail };
  }
  if (cache.kind === 'errored' && cache.key === key) {
    return { status: 'error', detail: null, error: cache.error };
  }
  return { status: 'loading', detail: null };
}
