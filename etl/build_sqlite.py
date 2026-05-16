"""Stage 6 of the world-names ETL pipeline.

Packs the five JSONL caches into a single SQLite file matching the schema
in Issue #1, copies it to `../public/world-names.sqlite` for the front-end
to consume via sqlite-wasm.

Idempotent: deletes any existing output file before rebuild.
"""
from __future__ import annotations

import json
import shutil
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _lib import normalized_similarity  # noqa: E402

ETL = Path(__file__).parent
PUBLIC_DEST = ETL.parent / "public" / "world-names.sqlite"
TEMP_DB = ETL / "cache" / "world-names.sqlite"

COUNTRIES = ETL / "cache" / "countries.jsonl"
LANGUAGES = ETL / "cache" / "languages.jsonl"
COUNTRY_LANGUAGES = ETL / "cache" / "country_languages.jsonl"
ENDONYMS = ETL / "cache" / "endonyms.jsonl"
EXONYMS = ETL / "cache" / "exonyms.jsonl"
CLUSTERS = ETL / "cache" / "clusters.jsonl"

SCHEMA = """
CREATE TABLE countries (
  iso3         TEXT PRIMARY KEY,
  name_en      TEXT NOT NULL,
  m49          TEXT,
  qid          TEXT,
  is_contested INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE languages (
  code         TEXT PRIMARY KEY,  -- ISO 639-3
  name_en      TEXT NOT NULL,
  qid          TEXT
);

CREATE TABLE country_languages (
  country_iso3   TEXT NOT NULL REFERENCES countries(iso3),
  language_code  TEXT NOT NULL REFERENCES languages(code),
  l1_speakers    INTEGER,
  l1_pct         REAL,
  is_dominant_l1 INTEGER NOT NULL DEFAULT 0,
  is_official    INTEGER NOT NULL DEFAULT 0,
  is_recognized  INTEGER NOT NULL DEFAULT 0,
  is_indigenous  INTEGER NOT NULL DEFAULT 0,
  is_contested   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (country_iso3, language_code)
);
CREATE INDEX idx_cl_dominant ON country_languages(country_iso3) WHERE is_dominant_l1 = 1;
CREATE INDEX idx_cl_lang ON country_languages(language_code);

CREATE TABLE endonyms (
  country_iso3  TEXT PRIMARY KEY REFERENCES countries(iso3),
  language_code TEXT NOT NULL REFERENCES languages(code),
  endonym       TEXT NOT NULL
);

CREATE TABLE exonyms (
  observer_language_code  TEXT NOT NULL REFERENCES languages(code),
  target_country_iso3     TEXT NOT NULL REFERENCES countries(iso3),
  exonym                  TEXT NOT NULL,
  cluster_id              TEXT,  -- populated by Issue #2 (etymological clustering)
  -- Similarity to the target's endonym in [0, 1]. 1.0 = identical after
  -- casefold + NFKD (this exonym IS what the country calls itself); 0.0 =
  -- fully foreign (different script, no shared characters). Computed in
  -- _lib.normalized_similarity at build time so the front-end consumes a
  -- ready-made channel for the polygon-fill lightness gradient — no
  -- string-distance code ships to the browser.
  similarity_to_endonym   REAL,
  PRIMARY KEY (observer_language_code, target_country_iso3)
);
CREATE INDEX idx_exo_target ON exonyms(target_country_iso3);

CREATE TABLE clusters (
  id                  TEXT PRIMARY KEY,
  target_country_iso3 TEXT NOT NULL REFERENCES countries(iso3),
  label               TEXT NOT NULL,
  hue                 REAL NOT NULL,
  etymology_origin    TEXT
);

CREATE TABLE blurbs (
  country_iso3  TEXT PRIMARY KEY REFERENCES countries(iso3),
  narrative_md  TEXT NOT NULL,
  generated_at  TEXT,
  model         TEXT
);

-- Schema version + provenance, for the front-end to sanity-check.
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"""


def load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line]


def to_bool(v) -> int:
    """Cast Python truthy/falsy/None to SQLite-friendly 0/1 integer."""
    return 1 if v else 0


def main() -> int:
    countries = load_jsonl(COUNTRIES)
    languages = load_jsonl(LANGUAGES)
    country_langs = load_jsonl(COUNTRY_LANGUAGES)
    endonyms = load_jsonl(ENDONYMS)
    exonyms = load_jsonl(EXONYMS)
    clusters = load_jsonl(CLUSTERS)

    if not countries or not languages:
        print("ERROR: countries.jsonl or languages.jsonl is empty. Run stages 1-2 first.")
        return 1

    # Filter languages.jsonl down to those actually referenced by other tables,
    # to keep the shipped SQLite small (8200 → ~120 rows).
    referenced = set()
    for r in country_langs:
        referenced.add(r["language_code"])
    for r in endonyms:
        referenced.add(r["language_code"])
    for r in exonyms:
        referenced.add(r["observer_language_code"])
    languages_filtered = [l for l in languages if l["iso639_3"] in referenced]

    if TEMP_DB.exists():
        TEMP_DB.unlink()
    TEMP_DB.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(TEMP_DB)
    con.executescript(SCHEMA)
    con.execute("PRAGMA foreign_keys = ON")

    con.executemany(
        "INSERT INTO countries (iso3, name_en, m49, qid, is_contested) VALUES (?, ?, ?, ?, ?)",
        [(c["iso3"], c["name_en"], c.get("m49"), c.get("qid"), 0) for c in countries],
    )
    con.executemany(
        "INSERT INTO languages (code, name_en, qid) VALUES (?, ?, ?)",
        [(l["iso639_3"], l["name_en"], l.get("qid")) for l in languages_filtered],
    )
    # country_languages: filter + dedupe. Factbook prose sometimes lists the
    # same language twice in a country (Samoa has English twice with different
    # L1 categories). Keep the row marked is_dominant_l1; otherwise keep the
    # one with the higher l1_pct.
    cl_filtered: list[dict] = []
    cl_seen: dict[tuple[str, str], dict] = {}
    for r in country_langs:
        if r["language_code"] not in referenced:
            continue
        key = (r["country_iso3"], r["language_code"])
        prev = cl_seen.get(key)
        if not prev:
            cl_seen[key] = r
            continue
        # Prefer dominant; otherwise prefer higher l1_pct.
        if r.get("is_dominant_l1") and not prev.get("is_dominant_l1"):
            cl_seen[key] = r
        elif (r.get("l1_pct") or 0) > (prev.get("l1_pct") or 0) and not prev.get("is_dominant_l1"):
            cl_seen[key] = r
    cl_filtered = list(cl_seen.values())
    con.executemany(
        """INSERT INTO country_languages
           (country_iso3, language_code, l1_speakers, l1_pct,
            is_dominant_l1, is_official, is_recognized, is_indigenous, is_contested)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [
            (r["country_iso3"], r["language_code"], None, r.get("l1_pct"),
             to_bool(r.get("is_dominant_l1")), to_bool(r.get("is_official")),
             0, 0, 0)
            for r in cl_filtered
        ],
    )
    con.executemany(
        "INSERT INTO endonyms (country_iso3, language_code, endonym) VALUES (?, ?, ?)",
        [(e["country_iso3"], e["language_code"], e["endonym"]) for e in endonyms],
    )
    con.executemany(
        """INSERT INTO clusters
           (id, target_country_iso3, label, hue, etymology_origin)
           VALUES (?, ?, ?, ?, ?)""",
        [(c["id"], c["target_country_iso3"], c["label"], c["hue"], c.get("etymology_origin")) for c in clusters],
    )
    # similarity_to_endonym: precomputed per (target, observer) pair so the
    # front-end's lightness channel comes out of the SQLite as-is. Keyed by
    # target ISO3; for any exonym whose target has no endonym in our data
    # (vanishingly rare — happens only if the upstream Wikidata fetch
    # missed a country), leave the value NULL and the front-end falls back
    # to the cluster's base lightness.
    endonym_by_iso3 = {e["country_iso3"]: e["endonym"] for e in endonyms}
    con.executemany(
        """INSERT INTO exonyms
           (observer_language_code, target_country_iso3, exonym, cluster_id, similarity_to_endonym)
           VALUES (?, ?, ?, ?, ?)""",
        [
            (
                e["observer_language_code"],
                e["target_country_iso3"],
                e["exonym"],
                e.get("cluster_id"),
                normalized_similarity(e["exonym"], endonym_by_iso3[e["target_country_iso3"]])
                if e["target_country_iso3"] in endonym_by_iso3 else None,
            )
            for e in exonyms
        ],
    )

    con.execute("INSERT INTO meta (key, value) VALUES ('schema_version', '2')")
    con.execute("INSERT INTO meta (key, value) VALUES ('source', 'github.com/Jacob-Lasky/world-names')")
    con.execute("INSERT INTO meta (key, value) VALUES ('phase', 'phase-2-similarity-encoding')")
    con.commit()

    # Vacuum to reclaim space.
    con.execute("VACUUM")
    con.close()

    PUBLIC_DEST.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(TEMP_DB, PUBLIC_DEST)

    size = PUBLIC_DEST.stat().st_size
    print(f"built {PUBLIC_DEST} ({size / 1024:.1f} KB)")
    print(f"  countries:          {len(countries)}")
    print(f"  languages (used):   {len(languages_filtered)} (of {len(languages)} total)")
    print(f"  country_languages:  {len(cl_filtered)}")
    print(f"  endonyms:           {len(endonyms)}")
    print(f"  exonyms:            {len(exonyms)}")
    print(f"  clusters:           {len(clusters)}")
    clustered = sum(1 for e in exonyms if e.get("cluster_id"))
    print(f"  exonyms w/ cluster: {clustered} / {len(exonyms)}")
    with_sim = sum(1 for e in exonyms if e["target_country_iso3"] in endonym_by_iso3)
    print(f"  exonyms w/ sim:     {with_sim} / {len(exonyms)}")

    # Sanity probe: select a country and read its endonym + exonyms
    probe = sqlite3.connect(PUBLIC_DEST)
    print("\n=== sanity probe: Germany endonym + selected exonyms ===")
    row = probe.execute("SELECT endonym, language_code FROM endonyms WHERE country_iso3 = 'DEU'").fetchone()
    print(f"  endonym: {row}")
    probe_observers = ('eng', 'fra', 'spa', 'pol', 'fin', 'cmn')
    placeholders = ",".join("?" * len(probe_observers))
    rows = probe.execute(
        f"""SELECT observer_language_code, exonym
            FROM exonyms
            WHERE target_country_iso3 = 'DEU' AND observer_language_code IN ({placeholders})
            ORDER BY observer_language_code""",
        probe_observers,
    ).fetchall()
    for r in rows:
        print(f"  exonym in {r[0]}: {r[1]}")
    probe.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
