// React hook that resolves a polygon's M49 numericId to a CountryDetail
// (endonym, dominant language, name) by querying the in-memory SQLite.
//
// The DB initializes on first call (lazy singleton). Loading vs idle vs
// ready vs error is derived during render from the cached result key, so
// the effect only ever calls setState asynchronously (post-await). The
// linter's react-hooks/set-state-in-effect rule rejects synchronous
// setState inside an effect body — see the cache-keyed-derivation pattern.

import { useEffect, useState } from 'react';
import { getDb } from './db';
import type { CountryDetail } from './types';

export type CountryDetailState =
  | { status: 'idle'; detail: null }
  | { status: 'loading'; detail: null }
  | { status: 'ready'; detail: CountryDetail | null }
  | { status: 'error'; detail: null; error: string };

type Cache =
  | { kind: 'empty' }
  | { kind: 'resolved'; key: string; detail: CountryDetail | null }
  | { kind: 'errored'; key: string; error: string };

export function useCountryDetail(m49: string | null | undefined): CountryDetailState {
  const [cache, setCache] = useState<Cache>({ kind: 'empty' });

  useEffect(() => {
    if (!m49) return;
    let cancelled = false;
    (async () => {
      try {
        const db = await getDb();
        if (cancelled) return;
        const detail = db.countryDetailByM49(m49);
        setCache({ kind: 'resolved', key: m49, detail });
      } catch (e: unknown) {
        if (cancelled) return;
        setCache({ kind: 'errored', key: m49, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [m49]);

  if (!m49) return { status: 'idle', detail: null };
  if (cache.kind === 'resolved' && cache.key === m49) {
    return { status: 'ready', detail: cache.detail };
  }
  if (cache.kind === 'errored' && cache.key === m49) {
    return { status: 'error', detail: null, error: cache.error };
  }
  return { status: 'loading', detail: null };
}
