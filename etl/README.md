# ETL — world-names data pipeline

Build-time Python pipeline that emits `public/world-names.sqlite` (the static DB shipped to the browser and queried via `@sqlite.org/sqlite-wasm`).

See Issue #1 for the full schema and dominance rule. Short version: most-L1-speakers wins (not "official language"), six normalized tables, status flags on `country_languages` carry the colonial/indigenous/contested signal as a side channel.

## Pipeline

| Stage | Script | Cache output | Status |
| --- | --- | --- | --- |
| 1 | `fetch_countries.py` | `cache/countries.jsonl` | ✓ 204 countries |
| 2 | `fetch_languages.py` | `cache/languages.jsonl` | ✓ 8246 languages |
| 3 | `fetch_country_languages.py` | `cache/country_languages.jsonl` | ✓ 204/204 with dominant set |
| 4 | `fetch_endonyms.py` | `cache/endonyms.jsonl` + `cache/labels.jsonl` | ✓ 195 endonyms |
| 5 | `fetch_exonyms.py` | `cache/exonyms.jsonl` | ✓ 17046 exonyms |
| 6 | `build_sqlite.py` | `../public/world-names.sqlite` | ✓ 1068 KB |

Each stage is idempotent. Caches are gitignored; pass `--force` to re-query Wikidata.

## End-to-end sanity probe

After running all six stages, the shipped SQLite answers:

```sql
SELECT endonym, language_code FROM endonyms WHERE country_iso3 = 'DEU';
-- → ('Deutschland', 'deu')

SELECT observer_language_code, exonym FROM exonyms
WHERE target_country_iso3 = 'DEU'
  AND observer_language_code IN ('eng', 'fra', 'spa', 'pol', 'fin', 'cmn')
ORDER BY observer_language_code;
-- → cmn: 德國
--    eng: Germany    (Germani root)
--    fin: Saksa      (Saxons root)
--    fra: Allemagne  (Alemanni root)
--    pol: Niemcy     (Slavic "mute" root)
--    spa: Alemania   (Alemanni root)
```

Six distinct etymological roots for Germany visible directly in the data — the visualization Issue #1 was designed for.

## L1-dominance sentinel check

Verifying the rule works non-colonially:

| Country | Dominant | Source | Note |
| --- | --- | --- | --- |
| ZAF | `zul` (Zulu) | Factbook 25.3% | Not Afrikaans/English |
| PRY | `grn` (Guaraní) | Factbook 34% | Not Spanish |
| USA | `eng` | Factbook 78.2% | |
| MEX | `spa` | Factbook 93.8% | |
| IND | `hin` | Factbook 43.6% | |
| ESP | `spa` | Factbook 74% | Castilian Spanish, not Catalan |
| TWN | `cmn` | Manual override | Wikidata P37 ordering picks Formosan langs first |
| CRI | `spa` | Wikidata P37 fallback | |

## Data sources

- **Wikidata** via SPARQL — primary source for the country set (stage 1), language set (stage 2), and rdfs:labels for endonyms / exonyms (stages 4-5).
- **CIA World Factbook** (`data/factbook_languages.json`, CC0, snapshotted from [factbook/factbook.json](https://github.com/factbook/factbook.json) @ 557b215) — per-country L1 percentages for ~95 countries with structured census-grade data. Refresh by re-cloning the source and re-running `extract_factbook.py`.

Hybrid sourcing in stage 3: Factbook for the ~95 countries with clean percentages, Wikidata P37 → P2936 fallback (sign languages filtered, language joins via ISO 639-3 to handle the Mandarin Q9192/Q727694/Q24841726 ambiguity) for the other ~109 countries.

## Known gaps

- ~9 endonyms missing (Kiribati, Niue, Palau, Tuvalu, Mozambique, Zambia, Seychelles, Sierra Leone, Papua New Guinea): the L1 dominant is correct (indigenous language per census), but Wikidata simply doesn't have the country's name in that language. Accept the gap.
- ~30 minor-language names in Factbook prose don't map to Wikidata's English labels (Kikongo, Asante, Tamacheq). Add to `LANGUAGE_NAME_OVERRIDES` as Issue #7 (diversity-map viz) starts surfacing them.

## Run

```sh
uv sync                                    # install deps
uv run pytest -q                           # unit tests (25)
uv run python fetch_countries.py           # stage 1
uv run python fetch_languages.py           # stage 2
uv run python fetch_country_languages.py   # stage 3
uv run python fetch_endonyms.py            # stage 4
uv run python fetch_exonyms.py             # stage 5
uv run python build_sqlite.py              # stage 6 → ../public/world-names.sqlite
```

Pass `--force` to any stage to bypass its cache and re-query Wikidata.
