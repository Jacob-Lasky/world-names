// Browser-side SQLite query layer. Loads `world-names.sqlite` once via
// @sqlite.org/sqlite-wasm and exposes typed query methods.
//
// The DB is a singleton: the lazy `getDb()` promise dedupes concurrent
// callers, and the in-memory deserialized DB is shared across the app.
// 1MB blob, deserialized in-thread (no worker) — totally fine for our
// query volume; revisit Promiser/worker mode if init blocks UX.

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { CountryDetail, Exonym } from './types';

// The package doesn't ship types. We use `any` for the SQLite handles
// and lean on this wrapper class for app-side type safety.
type AnySqlite = {
  oo1: { DB: new (filename: string, flags: string) => AnyDB };
  wasm: { allocFromTypedArray: (a: Uint8Array) => number };
  capi: {
    sqlite3_deserialize: (
      pDb: number,
      schema: string,
      pData: number,
      dataLength: number,
      bufferLength: number,
      flags: number,
    ) => number;
    SQLITE_DESERIALIZE_FREEONCLOSE: number;
    SQLITE_DESERIALIZE_READONLY: number;
  };
};

type AnyDB = {
  pointer: number;
  exec: (opts: {
    sql: string;
    bind?: unknown[];
    returnValue: 'resultRows';
    rowMode: 'object';
  }) => Record<string, unknown>[];
};

let dbPromise: Promise<WorldNamesDB> | null = null;

export function getDb(): Promise<WorldNamesDB> {
  if (!dbPromise) {
    dbPromise = initDb();
  }
  return dbPromise;
}

async function initDb(): Promise<WorldNamesDB> {
  const sqlite3 = (await sqlite3InitModule({
    print: console.log,
    printErr: console.error,
  })) as AnySqlite;

  const url = `${import.meta.env.BASE_URL}world-names.sqlite`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to load ${url}: HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();

  const db = new sqlite3.oo1.DB(':memory:', 'c');
  const ptr = sqlite3.wasm.allocFromTypedArray(new Uint8Array(buffer));
  const rc = sqlite3.capi.sqlite3_deserialize(
    db.pointer,
    'main',
    ptr,
    buffer.byteLength,
    buffer.byteLength,
    sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_READONLY,
  );
  if (rc !== 0) {
    throw new Error(`sqlite3_deserialize failed with rc=${rc}`);
  }

  return new WorldNamesDB(db);
}

export class WorldNamesDB {
  private inner: AnyDB;

  constructor(inner: AnyDB) {
    this.inner = inner;
  }

  countryDetailByM49(m49: string): CountryDetail | null {
    const rows = this.inner.exec({
      sql: `
        SELECT c.iso3, c.name_en, e.endonym, e.language_code,
               l.name_en AS language_name
        FROM countries c
        LEFT JOIN endonyms e ON e.country_iso3 = c.iso3
        LEFT JOIN languages l ON l.code = e.language_code
        WHERE c.m49 = ?
      `,
      bind: [m49],
      returnValue: 'resultRows',
      rowMode: 'object',
    });
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      iso3: r.iso3 as string,
      name_en: r.name_en as string,
      endonym: (r.endonym as string | null) ?? null,
      language_code: (r.language_code as string | null) ?? null,
      language_name: (r.language_name as string | null) ?? null,
    };
  }

  exonymsForTarget(targetIso3: string): Exonym[] {
    const rows = this.inner.exec({
      sql: `
        SELECT observer_language_code, exonym
        FROM exonyms
        WHERE target_country_iso3 = ?
        ORDER BY observer_language_code
      `,
      bind: [targetIso3],
      returnValue: 'resultRows',
      rowMode: 'object',
    });
    return rows.map((r) => ({
      observer_language_code: r.observer_language_code as string,
      exonym: r.exonym as string,
    }));
  }

  /**
   * For the given target country (its M49 numeric id, since that's what
   * the deck.gl polygons key on), return a map: observer-country M49 →
   * { cluster_id, hue, exonym }. Observers are countries whose L1-dominant
   * language has an exonym for the target. Rows with no cluster_id assigned
   * yet (cluster YAMLs haven't covered them) get hue = null.
   *
   * The polygon recolor on selection consumes this directly.
   */
  observerColorsByM49(targetM49: string): Map<string, { cluster_id: string | null; hue: number | null; exonym: string; similarity: number | null }> {
    const rows = this.inner.exec({
      sql: `
        WITH target AS (
          SELECT iso3 FROM countries WHERE m49 = ?
        )
        SELECT obs.m49 AS observer_m49,
               e.exonym,
               e.cluster_id,
               e.similarity_to_endonym,
               cs.hue
        FROM country_languages cl
        JOIN countries obs ON obs.iso3 = cl.country_iso3
        JOIN target t ON 1=1
        JOIN exonyms e
          ON e.observer_language_code = cl.language_code
         AND e.target_country_iso3 = t.iso3
        LEFT JOIN clusters cs ON cs.id = e.cluster_id
        WHERE cl.is_dominant_l1 = 1
          AND obs.m49 IS NOT NULL
      `,
      bind: [targetM49],
      returnValue: 'resultRows',
      rowMode: 'object',
    });
    const out = new Map<string, { cluster_id: string | null; hue: number | null; exonym: string; similarity: number | null }>();
    for (const r of rows) {
      const m49 = r.observer_m49 as string;
      // First write wins — multiple observer countries can share a dominant
      // language, but we keyed by the observer's M49 not by language, so each
      // M49 only appears once anyway.
      if (!out.has(m49)) {
        out.set(m49, {
          cluster_id: (r.cluster_id as string | null) ?? null,
          hue: (r.hue as number | null) ?? null,
          exonym: r.exonym as string,
          similarity: (r.similarity_to_endonym as number | null) ?? null,
        });
      }
    }
    return out;
  }
}
