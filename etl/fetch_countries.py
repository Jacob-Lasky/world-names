"""Stage 1 of the world-names ETL pipeline.

Pulls every current sovereign state from Wikidata into
`etl/cache/countries.jsonl`. Downstream stages join everything else on
`iso3` (ISO 3166-1 alpha-3), so the goal here is a clean, complete list.
"""
from __future__ import annotations

import sys
from pathlib import Path

from _lib import qid, sparql_to_jsonl, value

CACHE = Path(__file__).parent / "cache" / "countries.jsonl"

# Filter to Q6256 (country, the universal class) with an ISO 3166-1 alpha-3.
# Q6256 is tagged on sovereign states, states with limited recognition
# (Kosovo, Taiwan, Palestine), associated states (Cook Islands, Niue), AND
# constituent countries (Curaçao, Aruba, Sint Maarten) — so a single filter
# catches everything Natural Earth draws as a separate polygon.
#
# The ISO3 filter handles the temporal cut: historical entities like the
# USSR don't have current alpha-3 codes, so they're excluded even though
# Wikidata still tags them as Q6256.
QUERY = """
SELECT DISTINCT ?country ?iso3 ?m49 ?nameEn WHERE {
  ?country wdt:P31 wd:Q6256 ;
           wdt:P298 ?iso3 .
  OPTIONAL { ?country wdt:P2082 ?m49 . }
  ?country rdfs:label ?nameEn .
  FILTER(LANG(?nameEn) = "en")
}
ORDER BY ?iso3
"""


# Entities not surfaced by Wikidata's ISO3 index but drawn by Natural Earth.
# Kosovo: XKX is user-assigned per ISO 3166-1's reserved-range convention.
# Wikidata doesn't carry a `P298` value for it (it's not formally an ISO code).
# Natural Earth draws the polygon but doesn't assign an M49 either; downstream
# join to the polygon happens by name.
MANUAL_OVERRIDES: list[dict] = [
    {"qid": "Q1246", "iso3": "XKX", "m49": None, "name_en": "Kosovo"},
]


def parse_row(b: dict) -> dict | None:
    """Convert a SPARQL binding to a flat dict, or None if the row is invalid."""
    iso3 = value(b, "iso3")
    # ISO 3166-1 alpha-3 codes are exactly 3 uppercase letters; anything else
    # is bad data (and would break downstream joins).
    if not iso3 or len(iso3) != 3 or not iso3.isalpha() or not iso3.isupper():
        return None
    return {
        "qid": qid(b, "country"),
        "iso3": iso3,
        "m49": value(b, "m49"),
        "name_en": value(b, "nameEn"),
    }


def main() -> int:
    force = "--force" in sys.argv
    rows = sparql_to_jsonl(
        QUERY,
        CACHE,
        parse_row,
        primary_key="iso3",
        extra_rows=MANUAL_OVERRIDES,
        force=force,
    )
    print(f"wrote {len(rows)} countries to {CACHE}")

    # Sanity check: confirm a few sentinel countries are present, especially
    # the ones the L1-dominance rule is meant to handle non-colonially.
    by_iso = {r["iso3"]: r for r in rows}
    for sentinel in ("ZAF", "USA", "DEU", "PRY", "NGA", "TWN", "PSE"):
        r = by_iso.get(sentinel)
        if r:
            print(f"  {sentinel}: {r['name_en']} ({r['qid']})")
        else:
            print(f"  WARN: {sentinel} missing from results")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
