// React hook that resolves a polygon's M49 numericId to a CountryDetail
// (endonym, dominant language, name) by querying the in-memory SQLite.
//
// The DB initializes on first call (lazy singleton). The hook tracks a
// loading flag so DetailPanel can show a placeholder during the ~200ms
// init window on first selection.

import { useEffect, useState } from 'react';
import { getDb } from './db';
import type { CountryDetail } from './types';

export type CountryDetailState =
  | { status: 'idle'; detail: null }
  | { status: 'loading'; detail: null }
  | { status: 'ready'; detail: CountryDetail | null }
  | { status: 'error'; detail: null; error: string };

export function useCountryDetail(m49: string | null | undefined): CountryDetailState {
  const [state, setState] = useState<CountryDetailState>({ status: 'idle', detail: null });

  useEffect(() => {
    if (!m49) {
      setState({ status: 'idle', detail: null });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading', detail: null });

    (async () => {
      try {
        const db = await getDb();
        if (cancelled) return;
        const detail = db.countryDetailByM49(m49);
        setState({ status: 'ready', detail });
      } catch (e: unknown) {
        if (cancelled) return;
        setState({
          status: 'error',
          detail: null,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [m49]);

  return state;
}
