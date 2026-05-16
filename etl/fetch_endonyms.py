"""Stage 4 of the world-names ETL pipeline.

For each country, the endonym is its rdfs:label in the language with the
highest L1 plurality. Stage 3 set `is_dominant_l1=True` on one row per
country in `cache/country_languages.jsonl`; this stage joins on that.

Wikidata's rdfs:label uses BCP47 lang tags. Most major languages have an
ISO 639-1 alpha-2 (P218) — German = `de`, Zulu = `zu`. For languages
without an alpha-2 (Guaraní: P218 is `gn`, also alpha-2; many smaller
languages have nothing), Wikidata sometimes uses the ISO 639-3 directly.
We try alpha-2 first then fall back to 639-3.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from _lib import fetch_country_labels, fetch_language_bcp47, resolve_bcp47

ETL = Path(__file__).parent
COUNTRIES_CACHE = ETL / "cache" / "countries.jsonl"
LANGUAGES_CACHE = ETL / "cache" / "languages.jsonl"
COUNTRY_LANG_CACHE = ETL / "cache" / "country_languages.jsonl"
LABELS_CACHE = ETL / "cache" / "labels.jsonl"
OUT = ETL / "cache" / "endonyms.jsonl"


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line]


def main() -> int:
    force = "--force" in sys.argv
    countries = load_jsonl(COUNTRIES_CACHE)
    languages = load_jsonl(LANGUAGES_CACHE)
    country_langs = load_jsonl(COUNTRY_LANG_CACHE)

    # Lookups
    country_qid_by_iso3 = {c["iso3"]: c["qid"] for c in countries}
    country_iso3_by_qid = {c["qid"]: c["iso3"] for c in countries}
    lang_qid_by_iso = {l["iso639_3"]: l["qid"] for l in languages}
    dominant_lang_by_country = {
        r["country_iso3"]: r["language_code"]
        for r in country_langs if r["is_dominant_l1"]
    }

    # The dominant-language set across all 204 countries (deduped).
    dominant_isos = sorted(set(dominant_lang_by_country.values()))
    dominant_qids = [lang_qid_by_iso[iso] for iso in dominant_isos if iso in lang_qid_by_iso]

    print(f"fetching BCP47 tags for {len(dominant_qids)} dominant languages...")
    qid_to_bcp47 = fetch_language_bcp47(dominant_qids)
    iso_to_bcp47: dict[str, str] = {
        iso: resolve_bcp47(iso, qid_to_bcp47, lang_qid_by_iso) for iso in dominant_isos
    }

    print(f"fetching country labels (cache: {LABELS_CACHE})...")
    country_labels = fetch_country_labels(
        [c["qid"] for c in countries],
        LABELS_CACHE,
        force=force,
    )

    # Derive endonyms
    endonyms = []
    missed: list[tuple[str, str]] = []
    for country in countries:
        iso3 = country["iso3"]
        dominant_iso = dominant_lang_by_country.get(iso3)
        if not dominant_iso:
            missed.append((iso3, "no dominant"))
            continue
        bcp47 = iso_to_bcp47.get(dominant_iso, dominant_iso)
        labels = country_labels.get(country["qid"], {})
        # Try the BCP47 alpha-2 first, then ISO 639-3, then BCP47 with regional suffix stripping
        endonym = labels.get(bcp47) or labels.get(dominant_iso)
        if not endonym:
            # Some Wikidata labels carry a region suffix like "en-GB".
            for tag, lab in labels.items():
                if tag.split("-")[0] == bcp47:
                    endonym = lab
                    break
        if not endonym:
            missed.append((iso3, f"no label in {bcp47} or {dominant_iso}"))
            continue
        endonyms.append({
            "country_iso3": iso3,
            "language_code": dominant_iso,
            "endonym": endonym,
        })

    endonyms.sort(key=lambda r: r["country_iso3"])
    OUT.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in endonyms) + "\n")
    print(f"wrote {len(endonyms)} endonyms to {OUT}")
    print(f"missed: {len(missed)}")
    for iso3, reason in missed[:20]:
        print(f"  {iso3}: {reason}")

    print("\n=== sentinel endonyms ===")
    by_iso = {e["country_iso3"]: e for e in endonyms}
    sentinels = (
        ("DEU", "deu", "Deutschland"),
        ("FRA", "fra", "France"),
        ("ESP", "spa", "España"),
        ("RUS", "rus", "Россия"),
        ("JPN", "jpn", "日本"),
        ("ZAF", "zul", "iNingizimu Afrika"),  # rough; Wikidata label varies
        ("PRY", "grn", "Paraguái"),           # Guaraní endonym
        ("USA", "eng", "United States"),
        ("CHN", "cmn", "中华人民共和国"),
        ("BRA", "por", "Brasil"),
    )
    for iso3, expected_lang, hint in sentinels:
        e = by_iso.get(iso3)
        if e:
            match = "✓" if e["language_code"] == expected_lang else "≈"
            print(f"  {match} {iso3} in {e['language_code']}: \"{e['endonym']}\"  (hint: {hint})")
        else:
            print(f"  ✗ {iso3}: no endonym")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
