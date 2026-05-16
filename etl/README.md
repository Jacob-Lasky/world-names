# ETL — world-names data pipeline

Build-time Python pipeline that emits `public/world-names.sqlite` (the static DB shipped to the browser and queried via `@sqlite.org/sqlite-wasm`).

See Issue #1 on the repo for the full schema and dominance rule. Short version: most-L1-speakers wins (not "official language"), six normalized tables, status flags on `country_languages` carry the colonial/indigenous/contested signal as a side channel.

## Pipeline

| Stage | Script | Cache output | Status |
| --- | --- | --- | --- |
| 1 | `fetch_countries.py` | `cache/countries.jsonl` (204 countries) | ✓ |
| 2 | `fetch_languages.py` | `cache/languages.jsonl` (~8200 languages) | ✓ |
| 3 | `fetch_country_languages.py` | `cache/country_languages.jsonl` (~440 rows) | ✓ |
| 4 | `fetch_endonyms.py` | `cache/endonyms.jsonl` | TODO |
| 5 | `fetch_exonyms.py` | `cache/exonyms.jsonl` | TODO |
| 6 | `build_sqlite.py` | `../public/world-names.sqlite` | TODO |

Each stage is idempotent. Caches are gitignored; pass `--force` to re-query Wikidata.

## Stage 3 data sources

Per-country language demographics are hybrid:

- **CIA World Factbook** (`data/factbook_languages.json`, committed snapshot from [factbook/factbook.json](https://github.com/factbook/factbook.json), CC0). Has clean L1 percentages for ~95 countries (USA, ZAF, IND, MEX, etc.). Refresh by re-cloning and re-running `extract_factbook.py --source <path> --commit <hash>`.
- **Wikidata P37 → P2936 fallback** for the ~109 countries Factbook reports as list-only or doesn't cover. Picks the first official language with an ISO 639-3 code, falling back to "languages used" when P37 is empty (Uruguay).

Together: dominant_l1 set for **204 / 204 countries**. Sentinels verified non-colonially:

- ZAF → `zul` (Zulu, 25.3% L1 plurality — not Afrikaans/English)
- PRY → `grn` (Guaraní, 34% Guaraní-only — not Spanish)
- USA → `eng`, MEX → `spa`, IND → `hin`

## Files

- `_lib.py` — shared SPARQL helpers (`sparql_query`, `sparql_to_jsonl`). Centralizes Wikidata user-agent, retries, deterministic sort.
- `fetch_countries.py` — stage 1.
- `fetch_languages.py` — stage 2.
- `fetch_country_languages.py` — stage 3 (Factbook parse + Wikidata fallback merge).
- `extract_factbook.py` — one-shot preprocessor; reads a local clone of factbook.json, writes the committed snapshot.
- `data/factbook_languages.json` — committed Factbook snapshot (~65KB).
- `tests/` — pytest suite. 25 tests covering parsers, lookups, normalization, blocklists.

## Known long-tail gaps

The Factbook parser leaves ~30 minor-language names unmatched per run (Kikongo, Sekalanga, Sepedi-vs-Pedi distinctions, Asante-vs-Twi, Tamacheq, etc.). They don't affect any country's dominant — they're 1-3% L2 mentions in long lists. Add to `LANGUAGE_NAME_OVERRIDES` in `fetch_country_languages.py` as they become relevant for the diversity-map viz (Issue #7).

## Run

```sh
uv sync                                    # install deps
uv run pytest -q                           # unit tests (no network)
uv run python fetch_countries.py           # stage 1
uv run python fetch_languages.py           # stage 2
uv run python fetch_country_languages.py   # stage 3 (Factbook + Wikidata fallback)
# Pass --force to bypass cache.
```
