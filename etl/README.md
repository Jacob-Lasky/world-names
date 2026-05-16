# ETL — world-names data pipeline

Build-time Python pipeline that emits `public/world-names.sqlite` (the static DB shipped to the browser and queried via `@sqlite.org/sqlite-wasm`).

## Stages

1. **`fetch_endonyms.py`** — Wikidata SPARQL query: for each country (Q-id with P31:Q6256), pull its native label in its dominant language(s).
2. **`fetch_exonyms.py`** — For each (observer-country × target-country) pair, pull the target's name in the observer's dominant language.
3. **`cluster_etymology.py`** — Group exonyms by etymological root cluster (Germani / Alemanni / Deutsch / Niemcy / Saksa for Germany, analogous families for each target country). Source: Wiktionary etymology sections, hand-curated overrides where Wiktionary is silent.
4. **`generate_blurbs.py`** — One LLM call per country to generate the etymology narrative (~195 calls, ~few cents on Haiku). Cached in DB; never regenerated unless schema changes.
5. **`build_sqlite.py`** — Pack everything into `world-names.sqlite` (a single file, ~1MB), copy to `../public/`.

## Tables

```
countries(iso3 PK, name_en, endonym, language, latitude, longitude)
clusters(id PK, target_iso3, label, hue, etymology_origin)
exonyms(observer_iso3, target_iso3, exonym, cluster_id, intra_cluster_distance)
blurbs(target_iso3 PK, narrative_md)
```

## Run

```sh
uv sync
uv run python build_sqlite.py
```

Output: `../public/world-names.sqlite`.
