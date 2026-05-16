"""Stage 5 of the world-names ETL pipeline.

For each (observer language, target country) pair where the observer
language is the L1 dominant of at least one country, fetch the target's
rdfs:label in that language. The output table is keyed by language (not
by observer country) so that USA and UK don't double-store English rows
— their exonyms for Germany are both "Germany", once.

Reads from the labels cache populated by stage 4. Stage 5 doesn't
re-fetch from Wikidata; running stage 4 first is the only requirement.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from _lib import fetch_country_labels, fetch_language_bcp47

# Same overrides as fetch_endonyms.py — must stay in sync.
ISO_TO_BCP47_OVERRIDES = {
    "cmn": "zh",
    "heb": "he",
    "nor": "no",
    "zho": "zh",
}

ETL = Path(__file__).parent
COUNTRIES_CACHE = ETL / "cache" / "countries.jsonl"
LANGUAGES_CACHE = ETL / "cache" / "languages.jsonl"
COUNTRY_LANG_CACHE = ETL / "cache" / "country_languages.jsonl"
LABELS_CACHE = ETL / "cache" / "labels.jsonl"
OUT = ETL / "cache" / "exonyms.jsonl"


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line]


def main() -> int:
    force = "--force" in sys.argv
    countries = load_jsonl(COUNTRIES_CACHE)
    languages = load_jsonl(LANGUAGES_CACHE)
    country_langs = load_jsonl(COUNTRY_LANG_CACHE)

    lang_qid_by_iso = {l["iso639_3"]: l["qid"] for l in languages}

    # All distinct dominant languages across the 204 countries.
    dominant_isos = sorted({
        r["language_code"] for r in country_langs if r["is_dominant_l1"]
    })

    print(f"distinct dominant languages: {len(dominant_isos)}")

    # BCP47 tags for each dominant language.
    dominant_qids = [lang_qid_by_iso[iso] for iso in dominant_isos if iso in lang_qid_by_iso]
    qid_to_alpha2 = fetch_language_bcp47(dominant_qids)
    iso_to_bcp47: dict[str, str] = {}
    for iso in dominant_isos:
        if iso in ISO_TO_BCP47_OVERRIDES:
            iso_to_bcp47[iso] = ISO_TO_BCP47_OVERRIDES[iso]
            continue
        q = lang_qid_by_iso.get(iso)
        alpha2 = qid_to_alpha2.get(q) if q else None
        iso_to_bcp47[iso] = alpha2 or iso

    # Country labels — reuses the cache populated by stage 4.
    print(f"loading country labels from {LABELS_CACHE}...")
    country_labels = fetch_country_labels(
        [c["qid"] for c in countries],
        LABELS_CACHE,
        force=force,
    )

    # Derive exonyms
    exonyms = []
    per_lang_counts: dict[str, int] = {}
    for observer_iso in dominant_isos:
        bcp47 = iso_to_bcp47[observer_iso]
        count = 0
        for target in countries:
            labels = country_labels.get(target["qid"], {})
            # Try BCP47, then iso639_3, then BCP47 with regional-suffix prefix match.
            exonym = labels.get(bcp47) or labels.get(observer_iso)
            if not exonym:
                for tag, lab in labels.items():
                    if tag.split("-")[0] == bcp47:
                        exonym = lab
                        break
            if exonym:
                exonyms.append({
                    "observer_language_code": observer_iso,
                    "target_country_iso3": target["iso3"],
                    "exonym": exonym,
                })
                count += 1
        per_lang_counts[observer_iso] = count

    exonyms.sort(key=lambda r: (r["observer_language_code"], r["target_country_iso3"]))
    OUT.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in exonyms) + "\n")
    print(f"wrote {len(exonyms)} exonyms to {OUT}")

    # Coverage stats: how many target countries each observer language covered.
    full_coverage = sum(1 for c in per_lang_counts.values() if c == len(countries))
    print(f"  observer languages with full {len(countries)}-country coverage: {full_coverage} / {len(dominant_isos)}")
    low_coverage = [(iso, c) for iso, c in per_lang_counts.items() if c < 20]
    if low_coverage:
        print(f"  observer languages with <20 target labels (gaps):")
        for iso, c in sorted(low_coverage, key=lambda x: x[1]):
            print(f"    {iso}: {c}")

    # Spot-check Germany's exonyms across major languages — the famous example.
    print("\n=== Germany (DEU) exonyms across major observers ===")
    deu_exonyms = [e for e in exonyms if e["target_country_iso3"] == "DEU"]
    by_observer = {e["observer_language_code"]: e["exonym"] for e in deu_exonyms}
    for observer in ("eng", "deu", "fra", "spa", "ita", "por", "rus", "pol", "ces", "fin", "tur", "ara", "cmn", "jpn"):
        ex = by_observer.get(observer, "(missing)")
        print(f"  {observer}: {ex}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
