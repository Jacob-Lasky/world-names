"""Stage 2 of the world-names ETL pipeline.

Pulls every language with an ISO 639-3 code from Wikidata into
`etl/cache/languages.jsonl`. The ISO 639-3 code is the join key for stages
3 (country_languages) and 5 (exonyms — keyed by observer language).
"""
from __future__ import annotations

import sys
from pathlib import Path

from _lib import qid, sparql_to_jsonl, value

CACHE = Path(__file__).parent / "cache" / "languages.jsonl"

# Every entity with a `wdt:P220` (ISO 639-3) value. The presence of an ISO
# 639-3 code is the "this is a real, indexed language" filter — covers
# natural languages plus some constructed ones (Esperanto epo, Klingon tlh
# under user-assigned codes). ~7800 rows expected.
QUERY = """
SELECT DISTINCT ?language ?iso639_3 ?nameEn WHERE {
  ?language wdt:P220 ?iso639_3 .
  ?language rdfs:label ?nameEn .
  FILTER(LANG(?nameEn) = "en")
}
ORDER BY ?iso639_3
"""


def parse_row(b: dict) -> dict | None:
    """Convert a SPARQL binding to a flat dict, or None if invalid."""
    iso = value(b, "iso639_3")
    # ISO 639-3 is exactly 3 lowercase letters by spec.
    if not iso or len(iso) != 3 or not iso.isalpha() or not iso.islower():
        return None
    return {
        "qid": qid(b, "language"),
        "iso639_3": iso,
        "name_en": value(b, "nameEn"),
    }


def main() -> int:
    force = "--force" in sys.argv
    rows = sparql_to_jsonl(QUERY, CACHE, parse_row, primary_key="iso639_3", force=force)
    print(f"wrote {len(rows)} languages to {CACHE}")

    # Sanity check: confirm the languages the L1-dominance rule expects to
    # surface as dominant somewhere in stage 3.
    by_iso = {r["iso639_3"]: r for r in rows}
    sentinels = (
        ("eng", "English"),
        ("zul", "Zulu"),               # ZAF L1 plurality
        ("grn", "Guarani"),            # PRY (~90% of population)
        ("hau", "Hausa"),               # NGA L1 plurality
        ("spa", "Spanish"),
        ("hin", "Hindi"),
        ("cmn", "Mandarin Chinese"),
        ("deu", "German"),
        ("ara", "Arabic"),
        ("nld", "Dutch"),
        ("fra", "French"),
        ("rus", "Russian"),
        ("jpn", "Japanese"),
    )
    for code, expected in sentinels:
        r = by_iso.get(code)
        if r:
            print(f"  {code}: {r['name_en']} ({r['qid']})")
        else:
            print(f"  WARN: {code} ({expected}) missing from results")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
