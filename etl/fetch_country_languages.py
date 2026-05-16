"""Stage 3 of the world-names ETL pipeline.

Joins CIA World Factbook language demographics (`etl/data/factbook_languages.json`)
to the country and language caches from stages 1 and 2. Produces
`etl/cache/country_languages.jsonl` with one row per (country, language) pair
where Factbook reports a percentage.

For countries Factbook reports as a list-only (Nigeria, China, etc.), no
rows are emitted here; downstream stages will fall back to Wikidata P37
"first official" as the dominant. Coverage stats are printed.

The L1-dominance rule per Issue #1: `is_dominant_l1=True` for the row with
MAX(l1_pct) per country. Sentinels we expect to surface non-colonially:
ZAF → zul, PRY → grn, USA → eng, MEX → spa, IND → hin.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from _lib import sparql_query

ETL = Path(__file__).parent
FACTBOOK_DATA = ETL / "data" / "factbook_languages.json"
COUNTRIES_CACHE = ETL / "cache" / "countries.jsonl"
LANGUAGES_CACHE = ETL / "cache" / "languages.jsonl"
OUT = ETL / "cache" / "country_languages.jsonl"

# Country names that differ between Factbook's "conventional short form" and
# Wikidata's English label. Factbook → ISO3 alpha-3. Keep small; expand only
# when sentinels would otherwise drop.
COUNTRY_NAME_OVERRIDES = {
    "United States": "USA",
    "Bahamas, The": "BHS",
    "Gambia, The": "GMB",
    "Korea, North": "PRK",
    "Korea, South": "KOR",
    "Burma": "MMR",
    "Cabo Verde": "CPV",
    "Czechia": "CZE",
    "Eswatini": "SWZ",
    "Micronesia, Federated States of": "FSM",
    "Timor-Leste": "TLS",
    "Holy See (Vatican City)": "VAT",
    "Congo, Democratic Republic of the": "COD",
    "Congo, Republic of the": "COG",
    "Cote d'Ivoire": "CIV",
    "Ivory Coast": "CIV",
    "Sao Tome and Principe": "STP",
}

# Final-mile dominance overrides for countries where the data-driven path
# picks a language nobody would call "dominant" in everyday use. Each entry
# is justified by what the country's L1-plurality language actually is per
# census data; the data path was either picking sign languages (filtered),
# small Formosan/Austronesian relatives (Wikidata P37 ordering noise), or
# a regional minority that happens to be listed first.
COUNTRY_DOMINANT_OVERRIDES = {
    "TWN": "cmn",  # Mandarin Chinese; Wikidata P37 surfaces Formosan languages first.
    "TLS": "tet",  # Tetum; P37/P2936 ordering surfaces Mambai/Kemak otherwise.
    "BRN": "msa",  # Malay; P37 sometimes returns British English first.
}

# Factbook language names that don't match Wikidata's primary English label.
# Factbook string → ISO 639-3.
LANGUAGE_NAME_OVERRIDES = {
    "isiZulu": "zul",
    "Zulu": "zul",
    "isiXhosa": "xho",
    "Xhosa": "xho",
    "Sepedi": "nso",  # Wikidata calls it "Northern Sotho"
    "Pedi": "nso",
    "Northern Sotho": "nso",
    "Setswana": "tsn",
    "Tswana": "tsn",
    "Sesotho": "sot",
    "Sotho": "sot",
    "Xitsonga": "tso",
    "Tsonga": "tso",
    "siSwati": "ssw",
    "Swati": "ssw",
    "Tshivenda": "ven",
    "Venda": "ven",
    "isiNdebele": "nbl",
    "Ndebele": "nbl",
    "Mandarin": "cmn",
    "Standard Chinese or Mandarin": "cmn",
    "Standard Chinese": "cmn",
    "Cantonese": "yue",
    "Guarani": "grn",
    "Castilian": "spa",
    "Castilian Spanish": "spa",
    "Filipino": "fil",
    "Tagalog": "tgl",
    "Farsi": "fas",
    "Persian": "fas",
    "Pashto": "pus",
    "Pushtu": "pus",
}

# Stop-word "language" entries that aren't actual languages.
LANGUAGE_BLOCKLIST = {
    "other", "unspecified", "no response", "none", "unknown",
    "indigenous languages", "indigenous", "other indigenous languages",
    "various", "various languages", "minority languages", "regional languages",
    "other languages", "other indigenous",
}

# Pattern: "<name> [(parenthetical)] <pct>%"
PCT_PATTERN = re.compile(
    r"""
    (?P<name>[A-Za-z][A-Za-zÀ-ɏ'\-\s]*?)   # language name
    \s*
    (?:\([^)]*\))?                                    # optional parenthetical
    \s*
    (?P<pct>\d+(?:\.\d+)?)\s*%                        # percentage
    """,
    re.VERBOSE,
)


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line]


def normalize_lang_name(raw: str) -> str:
    """Strip qualifiers like '(official)', 'only X' / 'X only', '<lang> or X' alternatives."""
    s = re.sub(r"\([^)]*\)", "", raw).strip()
    # "only " prefix and " only" suffix both appear in Factbook prose.
    s = re.sub(r"^only\s+", "", s, flags=re.IGNORECASE).strip()
    s = re.sub(r"\s+only$", "", s, flags=re.IGNORECASE).strip()
    # Take the first "X or Y" alternative if present
    s = re.split(r"\s+or\s+", s, maxsplit=1, flags=re.IGNORECASE)[0].strip()
    return s


def lookup_language(raw_name: str, name_to_iso: dict[str, str]) -> str | None:
    """Map a raw Factbook language name to ISO 639-3. Tries the override table
    first, then the English-label lookup. Returns None for blocklisted or
    unmappable names."""
    norm = normalize_lang_name(raw_name)
    if norm.lower() in LANGUAGE_BLOCKLIST:
        return None
    if norm in LANGUAGE_NAME_OVERRIDES:
        return LANGUAGE_NAME_OVERRIDES[norm]
    # Wikidata's `name_en` is the lookup; case-insensitive.
    return name_to_iso.get(norm.lower())


def is_official(segment: str) -> bool:
    """True if the segment contains the word 'official' as a standalone token.
    Catches '(official)', '(subsidiary official)', and 'official language',
    without matching 'unofficial' or 'officially' (no word boundary there)."""
    return bool(re.search(r"\bofficial\b", segment, re.IGNORECASE))


def parse_factbook_languages(text: str) -> list[tuple[str, float, bool]]:
    """Return [(language_name, pct, is_official)] tuples from Factbook prose.

    Handles entries like:
      'isiZulu or Zulu (official) 25.3%'
      'English only (official) 78.2%'
      'Spanish 13.4%'
    Skips:
      'other 7.3%' (blocklist via lookup_language)
      'over 500 additional indigenous languages' (no percentage)
    """
    out: list[tuple[str, float, bool]] = []
    for m in PCT_PATTERN.finditer(text):
        name = m.group("name").strip()
        pct = float(m.group("pct"))
        # Capture the bracketed context if it preceded the percentage; the
        # full match span is used to look at surrounding text for "(official)".
        start = m.start()
        end = m.end()
        segment = text[max(0, start - 2): end]
        out.append((name, pct, is_official(segment)))
    return out


def fetch_wikidata_dominance_fallback(country_qids: list[str]) -> dict[str, str]:
    """For each country QID, return the ISO 639-3 of a sensible "dominant"
    fallback language. Prefers P37 (official); if a country lacks P37
    (Uruguay, e.g.), falls back to P2936 (languages used).

    Filters out language Q-IDs without an ISO 639-3 (British English,
    classical Greek) and looks up by ISO directly rather than Q-ID —
    multiple Wikidata entities can share an ISO code (Mandarin is Q9192
    *and* Q24841726, both `cmn`), and joining via ISO sidesteps that.

    Returns {country_qid: iso639_3}.
    """
    if not country_qids:
        return {}
    values = " ".join(f"wd:{q}" for q in country_qids)
    # `priority` orders the result so P37 hits sort before P2936; the
    # caller takes the first per country.
    # FILTER excludes sign languages (P31/P279* of Q34228 "sign language"),
    # which sometimes surface first via P37 for political reasons (Taiwan's
    # Taiwanese Sign Language, NZ's NZSL). The viz tracks spoken L1 plurality.
    query = f"""
    SELECT ?country ?iso ?priority WHERE {{
      VALUES ?country {{ {values} }}
      {{
        ?country wdt:P37 ?lang .
        ?lang wdt:P220 ?iso .
        FILTER NOT EXISTS {{ ?lang wdt:P31/wdt:P279* wd:Q34228 }}
        BIND(1 AS ?priority)
      }} UNION {{
        ?country wdt:P2936 ?lang .
        ?lang wdt:P220 ?iso .
        FILTER NOT EXISTS {{ ?lang wdt:P31/wdt:P279* wd:Q34228 }}
        BIND(2 AS ?priority)
      }}
    }}
    ORDER BY ?country ?priority
    """
    bindings = sparql_query(query)
    result: dict[str, str] = {}
    for b in bindings:
        cq = b["country"]["value"].rsplit("/", 1)[-1]
        iso = b["iso"]["value"]
        if cq not in result:
            result[cq] = iso
    return result


def main() -> int:
    factbook = json.loads(FACTBOOK_DATA.read_text())["entries"]
    countries = load_jsonl(COUNTRIES_CACHE)
    languages = load_jsonl(LANGUAGES_CACHE)

    # Build lookups
    name_to_iso3: dict[str, str] = {c["name_en"].lower(): c["iso3"] for c in countries}
    for fb_name, iso3 in COUNTRY_NAME_OVERRIDES.items():
        name_to_iso3[fb_name.lower()] = iso3
    lang_name_to_iso: dict[str, str] = {l["name_en"].lower(): l["iso639_3"] for l in languages}

    rows: list[dict] = []
    stats = {
        "fb_entries_total": len(factbook),
        "fb_with_text": 0,
        "fb_with_parsed_pct": 0,
        "fb_no_country_match": 0,
        "fb_no_pct_parsed": 0,
        "lang_unmatched": [],   # for debug; capped
    }
    seen_unmatched: set[str] = set()

    for entry in factbook:
        text = entry.get("languages_text") or ""
        if not text:
            continue
        stats["fb_with_text"] += 1
        country_name = entry.get("country_name") or ""
        iso3 = name_to_iso3.get(country_name.lower()) if country_name else None
        if not iso3:
            stats["fb_no_country_match"] += 1
            continue
        parsed = parse_factbook_languages(text)
        if not parsed:
            stats["fb_no_pct_parsed"] += 1
            continue
        # Map names to ISO 639-3, keep only matched
        country_rows: list[dict] = []
        for name, pct, official in parsed:
            iso = lookup_language(name, lang_name_to_iso)
            if not iso:
                if name not in seen_unmatched:
                    seen_unmatched.add(name)
                    if len(stats["lang_unmatched"]) < 30:
                        stats["lang_unmatched"].append((country_name, name))
                continue
            country_rows.append({
                "country_iso3": iso3,
                "language_code": iso,
                "l1_pct": pct,
                "is_dominant_l1": False,  # filled in below
                "is_official": official,
            })
        if not country_rows:
            continue
        stats["fb_with_parsed_pct"] += 1
        # Mark is_dominant_l1 for MAX(l1_pct) per country
        top = max(country_rows, key=lambda r: r["l1_pct"])
        top["is_dominant_l1"] = True
        rows.extend(country_rows)

    # Wikidata P37 fallback for countries Factbook didn't give us a dominant.
    # The viz needs a dominant per country to render meaningfully.
    covered = {r["country_iso3"] for r in rows if r["is_dominant_l1"]}
    country_to_qid = {c["iso3"]: c["qid"] for c in countries}
    uncovered_iso3 = [c["iso3"] for c in countries if c["iso3"] not in covered]
    uncovered_qids = [country_to_qid[i] for i in uncovered_iso3 if country_to_qid.get(i)]
    qid_to_iso3 = {country_to_qid[i]: i for i in uncovered_iso3 if country_to_qid.get(i)}

    # The P37 fallback returns iso639_3 directly (filtered by `wdt:P220`).
    # Languages.jsonl is keyed by iso639_3 anyway, so the existence check is
    # just "is this code in our index" — should always succeed for any P220.
    lang_codes = {l["iso639_3"] for l in languages}

    wikidata_map = fetch_wikidata_dominance_fallback(uncovered_qids)
    fallback_rows = 0
    for cq, iso in wikidata_map.items():
        iso3 = qid_to_iso3.get(cq)
        if not iso3 or iso not in lang_codes:
            continue
        # Manual override wins over the data-driven pick.
        if iso3 in COUNTRY_DOMINANT_OVERRIDES:
            iso = COUNTRY_DOMINANT_OVERRIDES[iso3]
        rows.append({
            "country_iso3": iso3,
            "language_code": iso,
            "l1_pct": None,
            "is_dominant_l1": True,
            "is_official": True,
        })
        fallback_rows += 1

    # Some countries are in COUNTRY_DOMINANT_OVERRIDES but landed in
    # `covered` via Factbook (with the wrong choice). Force-override those too.
    by_iso3: dict[str, list[dict]] = {}
    for r in rows:
        by_iso3.setdefault(r["country_iso3"], []).append(r)
    for iso3, override_lang in COUNTRY_DOMINANT_OVERRIDES.items():
        country_rows = by_iso3.get(iso3, [])
        if not country_rows:
            # Country had no rows at all — emit an override row.
            if override_lang in lang_codes:
                rows.append({
                    "country_iso3": iso3,
                    "language_code": override_lang,
                    "l1_pct": None,
                    "is_dominant_l1": True,
                    "is_official": True,
                })
            continue
        # Clear any existing dominant flag and set on the override (creating row if needed)
        if not any(r["language_code"] == override_lang for r in country_rows):
            country_rows.append({
                "country_iso3": iso3,
                "language_code": override_lang,
                "l1_pct": None,
                "is_dominant_l1": False,
                "is_official": True,
            })
            rows.append(country_rows[-1])
        for r in country_rows:
            r["is_dominant_l1"] = (r["language_code"] == override_lang)

    rows.sort(key=lambda r: (r["country_iso3"], -(r["l1_pct"] or 0)))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n")
    stats["wikidata_p37_fallback_rows"] = fallback_rows

    print(f"wrote {len(rows)} (country, language) rows to {OUT}")
    print(f"  factbook entries:        {stats['fb_entries_total']}")
    print(f"  with languages_text:     {stats['fb_with_text']}")
    print(f"  matched to a country:    {stats['fb_with_text'] - stats['fb_no_country_match']}")
    print(f"  had parseable pct rows:  {stats['fb_with_parsed_pct']}")
    print(f"  wikidata fallback rows:  {stats['wikidata_p37_fallback_rows']}")
    countries_covered = len({r['country_iso3'] for r in rows if r['is_dominant_l1']})
    print(f"  dominant set for:        {countries_covered} / {len(countries)} countries")
    print(f"  unmatched language names (first 30):")
    for cn, ln in stats["lang_unmatched"]:
        print(f"    [{cn}] {ln}")

    print("\n=== L1-dominance sentinel check ===")
    by_country: dict[str, list[dict]] = {}
    for r in rows:
        by_country.setdefault(r["country_iso3"], []).append(r)
    expected = (("ZAF", "zul"), ("USA", "eng"), ("MEX", "spa"),
                ("PRY", "grn"), ("IND", "hin"), ("CRI", "spa"))
    for iso3, expected_dom in expected:
        country_rows = by_country.get(iso3, [])
        dom = next((r for r in country_rows if r["is_dominant_l1"]), None)
        if dom:
            mark = "✓" if dom["language_code"] == expected_dom else "✗"
            print(f"  {mark} {iso3}: dominant={dom['language_code']} ({dom['l1_pct']}%), expected={expected_dom}")
        else:
            print(f"  ? {iso3}: no parsed data (expected {expected_dom})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
