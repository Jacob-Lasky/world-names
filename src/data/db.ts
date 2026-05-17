// Browser-side SQLite query layer. Loads `world-names.sqlite` once via
// @sqlite.org/sqlite-wasm and exposes typed query methods.
//
// The DB is a singleton: the lazy `getDb()` promise dedupes concurrent
// callers, and the in-memory deserialized DB is shared across the app.
// 1MB blob, deserialized in-thread (no worker) — totally fine for our
// query volume; revisit Promiser/worker mode if init blocks UX.

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { ClusterSummary, CountryDetail, Exonym, InspectionDetail } from './types';

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

  /**
   * For a (selected target, hovered observer) pair, return everything the
   * inspection card needs: the observer country's name, the observer's
   * dominant language's name, the exonym it uses for the target, and the
   * cluster's label + etymology origin. Returns null when there's no
   * exonym row (uncovered observer language or non-country polygon).
   *
   * Keyed by the M49 numericIds the deck.gl polygons carry. Both must be
   * present — call sites should short-circuit before invoking when either
   * is null.
   */
  inspectionDetail(targetM49: string, observerM49: string): InspectionDetail | null {
    const rows = this.inner.exec({
      sql: `
        WITH target AS (
          SELECT iso3 FROM countries WHERE m49 = ?
        ),
        observer AS (
          SELECT iso3, name_en FROM countries WHERE m49 = ?
        )
        SELECT obs.iso3              AS observer_iso3,
               obs.name_en           AS observer_name_en,
               l.name_en             AS observer_language_name,
               e.exonym              AS exonym,
               cs.label              AS cluster_label,
               cs.etymology_origin   AS etymology_origin,
               cs.hue                AS hue,
               e.similarity_to_endonym AS similarity
        FROM observer obs
        JOIN target t ON 1=1
        JOIN country_languages cl
          ON cl.country_iso3 = obs.iso3
         AND cl.is_dominant_l1 = 1
        LEFT JOIN languages l ON l.code = cl.language_code
        LEFT JOIN exonyms e
          ON e.observer_language_code = cl.language_code
         AND e.target_country_iso3 = t.iso3
        LEFT JOIN clusters cs ON cs.id = e.cluster_id
        LIMIT 1
      `,
      bind: [targetM49, observerM49],
      returnValue: 'resultRows',
      rowMode: 'object',
    });
    if (rows.length === 0) return null;
    const r = rows[0];
    // exonym is the load-bearing field; if it's missing the row is useless
    // (observer's dominant language has no exonym entry for the target).
    if (r.exonym == null) return null;
    return {
      observer_iso3: r.observer_iso3 as string,
      observer_name_en: r.observer_name_en as string,
      observer_language_name: (r.observer_language_name as string | null) ?? null,
      exonym: r.exonym as string,
      cluster_label: (r.cluster_label as string | null) ?? null,
      etymology_origin: (r.etymology_origin as string | null) ?? null,
      hue: (r.hue as number | null) ?? null,
      similarity: (r.similarity as number | null) ?? null,
    };
  }

  /**
   * Every etymological cluster for the given target country, with the
   * number of observer countries (dominant-L1 languages) whose exonym
   * for the target falls in that cluster. Used by the Legend overlay to
   * render one chip per root with its member count.
   *
   * Ordering: largest cluster first — visually the legend reads as a
   * pareto-style breakdown, biggest root at the top.
   */
  clustersForTarget(targetM49: string): ClusterSummary[] {
    const rows = this.inner.exec({
      sql: `
        WITH target AS (
          SELECT iso3 FROM countries WHERE m49 = ?
        )
        SELECT cs.id              AS id,
               cs.label           AS label,
               cs.hue             AS hue,
               cs.etymology_origin AS etymology_origin,
               cs.auto_generated  AS auto_generated,
               COUNT(DISTINCT cl.country_iso3) AS member_count
        FROM clusters cs
        JOIN target t ON t.iso3 = cs.target_country_iso3
        LEFT JOIN exonyms e ON e.cluster_id = cs.id
        LEFT JOIN country_languages cl
          ON cl.language_code = e.observer_language_code
         AND cl.is_dominant_l1 = 1
        GROUP BY cs.id, cs.label, cs.hue, cs.etymology_origin, cs.auto_generated
        ORDER BY member_count DESC, cs.label ASC
      `,
      bind: [targetM49],
      returnValue: 'resultRows',
      rowMode: 'object',
    });
    return rows.map((r) => ({
      id: r.id as string,
      label: r.label as string,
      hue: r.hue as number,
      etymology_origin: (r.etymology_origin as string | null) ?? null,
      member_count: Number(r.member_count ?? 0),
      auto_generated: Number(r.auto_generated ?? 0) === 1,
    }));
  }
}
