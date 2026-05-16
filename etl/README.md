# ETL — world-names data pipeline

Build-time Python pipeline that emits `public/world-names.sqlite` (the static DB shipped to the browser and queried via `@sqlite.org/sqlite-wasm`).

See Issue #1 on the repo for the full schema and dominance rule. Short version: most-L1-speakers wins (not "official language"), six normalized tables, status flags on `country_languages` carry the colonial/indigenous/contested signal as a side channel.

## Files

- `_lib.py` — shared helpers: `sparql_query`, `sparql_to_jsonl`, value/qid extractors. Centralizes the Wikidata user-agent and retry-on-429/5xx logic so per-stage scripts only specify the query, the parser, and the PK.
- `fetch_countries.py` — **stage 1**. Pulls every current country with an ISO 3166-1 alpha-3 from Wikidata, plus a manual override row for Kosovo (XKX is user-assigned, Wikidata won't surface it). Cache: `cache/countries.jsonl`.
- `tests/test_parse.py` — pure-function tests for the row parsers. Static binding fixtures, no network. `pytest -q`.

Future stages (not yet implemented; see Issue #1):

- `fetch_languages.py` — every language Q-ID with an ISO 639-3 code.
- `fetch_country_languages.py` — L1 speaker counts per (country, language) via `P1098`. Computes `l1_pct`, marks `is_dominant_l1` for `MAX(l1_pct)` per country.
- `fetch_endonyms.py` — `P1448` (native label) of each country in its dominant language.
- `fetch_exonyms.py` — labels of each country in every "dominant" world language.
- `build_sqlite.py` — packs everything into `world-names.sqlite`, copies to `../public/`.

## Cache strategy

Each stage writes JSONL to `cache/<stage>.jsonl`. Stages are idempotent: rerunning skips the network if the cache exists. Pass `--force` to bypass and re-query Wikidata.

`cache/` is gitignored — the data is reproducible from Wikidata + the manual overrides in each fetcher.

## Run

```sh
uv sync                                  # install deps
uv run pytest -q                         # unit tests (no network)
uv run python fetch_countries.py         # stage 1 (uses cache if present)
uv run python fetch_countries.py --force # bypass cache, re-query Wikidata
```

Final build target once all stages exist:

```sh
uv run python build_sqlite.py
```

Output: `../public/world-names.sqlite`.
