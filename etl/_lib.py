"""Shared SPARQL + cache helpers for the world-names ETL pipeline.

Every stage in `etl/` follows the same shape: run a SPARQL query against
Wikidata, parse each binding into a flat dict, dedupe + sort by primary key,
write JSONL to `etl/cache/<stage>.jsonl`. This module owns that flow so the
per-stage scripts only need to specify the query, the parser, and the PK.

Reads are idempotent: if the cache exists, we return parsed rows without
hitting Wikidata. Pass `--force` (handled by callers) to bypass.

Also hosts pure-function utilities used by build_sqlite (Unicode-normalized
Levenshtein-based string similarity) so the viz's "how foreign-sounding is
this exonym vs the endonym" lightness channel can be precomputed at build
time and shipped in the SQLite payload.
"""
from __future__ import annotations

import json
import re
import time
import unicodedata
from pathlib import Path
from typing import Callable

import httpx
from unidecode import unidecode

# Wikidata's etiquette policy requires an identifying User-Agent on every
# query. Anonymous or generic UAs can be rate-limited or blocked.
# Per https://meta.wikimedia.org/wiki/User-Agent_policy.
UA = (
    "world-names-etl/0.1 "
    "(https://github.com/Jacob-Lasky/world-names; jacob.s.lasky@gmail.com)"
)
SPARQL_ENDPOINT = "https://query.wikidata.org/sparql"


def sparql_query(query: str, *, max_retries: int = 3) -> list[dict]:
    """Run a SPARQL query, return the bindings list. Retries on 429/5xx with
    exponential backoff."""
    headers = {
        "Accept": "application/sparql-results+json",
        "User-Agent": UA,
    }
    last_status = None
    for attempt in range(max_retries):
        with httpx.Client(timeout=120) as client:
            r = client.post(SPARQL_ENDPOINT, data={"query": query}, headers=headers)
        last_status = r.status_code
        if r.status_code == 200:
            return r.json()["results"]["bindings"]
        if r.status_code in (429, 500, 502, 503, 504):
            wait = 2 ** attempt
            print(f"  retry {attempt + 1}/{max_retries} after HTTP {r.status_code}, sleeping {wait}s")
            time.sleep(wait)
            continue
        r.raise_for_status()
    raise RuntimeError(f"SPARQL failed after {max_retries} retries (last status: {last_status})")


def sparql_to_jsonl(
    query: str,
    cache_path: Path,
    parse_row: Callable[[dict], dict | None],
    *,
    primary_key: str,
    extra_rows: list[dict] | None = None,
    force: bool = False,
) -> list[dict]:
    """Cache-aware SPARQL pipeline. Returns parsed rows, dedupe-by-PK,
    sorted by PK, written to JSONL. Skip the network if the cache exists
    unless `force=True`.

    `extra_rows` lets a caller inject manual entries (e.g. entities that
    Wikidata's ISO3 index doesn't cover but Natural Earth still draws as
    polygons, like Kosovo). Manual rows lose to SPARQL rows on PK collision,
    so they only fill gaps, never override real data.
    """
    if cache_path.exists() and not force:
        return [json.loads(line) for line in cache_path.read_text().splitlines() if line]

    bindings = sparql_query(query)
    rows_by_pk: dict[str, dict] = {}
    for b in bindings:
        row = parse_row(b)
        if row is None:
            continue
        pk = row[primary_key]
        # First write wins. SPARQL can return duplicates when OPTIONAL clauses
        # match multiple values (e.g. population stamped across years).
        if pk not in rows_by_pk:
            rows_by_pk[pk] = row

    for row in extra_rows or []:
        pk = row[primary_key]
        if pk not in rows_by_pk:
            rows_by_pk[pk] = row

    rows = sorted(rows_by_pk.values(), key=lambda r: r[primary_key])
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n"
    )
    return rows


def value(binding: dict, key: str) -> str | None:
    """Extract `.value` from a SPARQL binding cell, or None if the key is absent."""
    cell = binding.get(key)
    return cell["value"] if cell else None


def qid(binding: dict, key: str) -> str | None:
    """Extract the Q-ID slug from a Wikidata entity URI binding."""
    uri = value(binding, key)
    if not uri:
        return None
    return uri.rsplit("/", 1)[-1]


def fetch_country_labels(
    country_qids: list[str],
    cache_path: Path,
    *,
    chunk_size: int = 50,
    force: bool = False,
) -> dict[str, dict[str, str]]:
    """For each country QID, return {bcp47_tag: label}. Stages 4 and 5 both
    consume this; the cache means stage 5 doesn't re-hit Wikidata after
    stage 4 ran.

    Cache shape on disk: JSONL, one row per (country_qid, lang_tag) tuple,
    sorted deterministically. ~25-30K rows for 204 countries.
    """
    if cache_path.exists() and not force:
        result: dict[str, dict[str, str]] = {}
        for line in cache_path.read_text().splitlines():
            if not line:
                continue
            row = json.loads(line)
            result.setdefault(row["country_qid"], {})[row["lang_tag"]] = row["label"]
        return result

    result = {}
    for i in range(0, len(country_qids), chunk_size):
        chunk = country_qids[i:i + chunk_size]
        values = " ".join(f"wd:{q}" for q in chunk)
        query = f"""
        SELECT ?country ?label WHERE {{
          VALUES ?country {{ {values} }}
          ?country rdfs:label ?label .
        }}
        """
        bindings = sparql_query(query)
        for b in bindings:
            cq = b["country"]["value"].rsplit("/", 1)[-1]
            label_cell = b["label"]
            lang_tag = label_cell.get("xml:lang") or ""
            text = label_cell.get("value") or ""
            if not lang_tag or not text:
                continue
            result.setdefault(cq, {})[lang_tag] = text
        print(f"  fetched labels for countries {i + 1}-{i + len(chunk)} of {len(country_qids)}")

    # Persist
    rows = []
    for cq in sorted(result):
        for lang_tag in sorted(result[cq]):
            rows.append({"country_qid": cq, "lang_tag": lang_tag, "label": result[cq][lang_tag]})
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n")
    print(f"  wrote {len(rows)} labels to {cache_path}")
    return result


# BCP47 overrides used by both stages 4 and 5. Centralized here so the two
# callers can't drift out of sync. Each entry: Wikidata's primary entity for
# the ISO 639-3 lacks `wdt:P218` (alpha-2), but actual rdfs:label tags in
# Wikidata use the alpha-2 we list — so we map directly.
ISO_TO_BCP47_OVERRIDES: dict[str, str] = {
    "cmn": "zh",   # Mandarin: Q9192/Q727694/Q24841726 all lack P218
    "heb": "he",   # Modern Hebrew: same shape
    "nor": "no",   # Norwegian (macro)
    "zho": "zh",
}


def resolve_bcp47(iso639_3: str, qid_to_alpha2: dict[str, str | None], iso_to_qid: dict[str, str]) -> str:
    """Pick the BCP47 lang tag for an ISO 639-3 code, with this priority:
    1. ISO_TO_BCP47_OVERRIDES (for cases Wikidata's primary entity is missing P218)
    2. P218 alpha-2 from Wikidata
    3. The ISO 639-3 code itself (Wikidata accepts it as a fallback lang tag)
    """
    if iso639_3 in ISO_TO_BCP47_OVERRIDES:
        return ISO_TO_BCP47_OVERRIDES[iso639_3]
    qid = iso_to_qid.get(iso639_3)
    if qid:
        alpha2 = qid_to_alpha2.get(qid)
        if alpha2:
            return alpha2
    return iso639_3


_NON_ALNUM = re.compile(r"[^a-z0-9]")
_WHITESPACE = re.compile(r"\s+")

# Languages that systematically prepend a "country of …" / "republic of …" /
# "islands of …" classifier to their country-name exonyms. The classifier
# becomes phonetic noise after unidecode (Thai 'ประเทศ' → 'praeths' added
# to every exonym; Lao 'ປະເທດ' → 'paethd' likewise), which inflates
# edit-distance to every other language's bare name for that country and
# pushes Thai + Lao exonyms into their own dead-end clusters instead of
# letting them join the main phonetic group. Detected at ETL time and
# stripped from the cluster-key form ONLY — the full exonym is still
# stored, displayed in the InspectionCard, and shown verbatim in tooltips.
#
# Coverage decision: only languages where the classifier prepends to a
# clear majority of exonyms get an entry. Thai prepends ประเทศ to 187 /
# 204 of its exonyms; Lao prepends ປະເທດ to 127 / 158. Add more as you
# discover them — Vietnamese 'nước', Korean '대한', Burmese, etc. all
# have analogous patterns. Order matters: longest prefix first so the
# stripper tries 'สาธารณรัฐ' (republic) before falling back to 'ประเทศ'
# (country).
COUNTRY_OF_PREFIXES: dict[str, tuple[str, ...]] = {
    "tha": ("สาธารณรัฐ", "ประเทศ", "หมู่เกาะ", "นครรัฐ"),
    "lao": ("ສາທາລະນະລັດ", "ປະເທດ", "ໝູ່ເກາະ"),
}


def _strip_country_prefix(s: str, lang: str | None) -> str:
    """If `s` starts with a known "country of …" prefix for `lang`,
    return `s` with the prefix removed (and surrounding whitespace
    cleaned up). Otherwise return `s` unchanged."""
    if not lang or not s:
        return s
    for prefix in COUNTRY_OF_PREFIXES.get(lang, ()):
        if s.startswith(prefix):
            stripped = s[len(prefix):].strip()
            if stripped:
                return stripped
    return s


def _is_latin_letter(c: str) -> bool:
    """Letters whose Unicode name starts with 'LATIN' (Basic Latin +
    Latin-1 Supplement + Latin Extended A/B + IPA Extensions). Returns
    False for non-letters and for letters in any other script."""
    if not c.isalpha():
        return False
    try:
        return "LATIN" in unicodedata.name(c, "")
    except ValueError:
        return False


def pronunciation(s: str) -> str | None:
    """Display-form transliteration of `s` for the UI's pronunciation
    guide. Returns None when no pronunciation is helpful — either
    because `s` is already Latin script, or because Latin chars
    dominate so the unidecode output would mostly echo the original
    (e.g. "Slavic *němьcь" → "Slavic *nem'c'", strictly worse).

    Examples that DO get a pronunciation:
        'Россия'             → 'Rossiia'
        'ประเทศญี่ปุ่น'      → 'praethsyiipun'
        '中華人民共和国'        → 'Zhong Hua Ren Min Gong He Guo'
        '대한민국'             → 'daehanmingug'

    Examples that DO NOT (returns None):
        'Allemagne'          (all Latin)
        'Naïve'              (Latin + accents; unidecode just drops accents)
        'Slavic *němьcь'     (Latin-dominant; the few Cyrillic chars
                              don't justify the noisy "Slavic *nem'c'")

    Distinct from `_normalize_for_similarity` — that one strips spaces
    + non-alnum + casefolds for edit-distance comparison. This one
    preserves spaces + case so the result reads as a natural
    pronunciation, not a cluster key.
    """
    latin = 0
    non_latin = 0
    for c in s:
        if not c.isalpha():
            continue
        if _is_latin_letter(c):
            latin += 1
        else:
            non_latin += 1
    if non_latin == 0:
        return None
    # Dominant-script rule: only transliterate when non-Latin letters
    # outnumber Latin ones. Otherwise the source is already mostly
    # readable to a Latin-alphabet reader.
    if non_latin <= latin:
        return None
    result = unidecode(s).strip()
    result = _WHITESPACE.sub(" ", result)
    return result or None


def _normalize_for_similarity(s: str) -> str:
    """Transliterate to ASCII, then casefold + NFKD + strip non-alnum.

    Used before edit-distance so two exonyms in different scripts can
    still be meaningfully compared — without this, 'Россия' vs 'Russia'
    has distance 1.0 (no overlap) and every cross-script pair lands in
    its own cluster. After this:

        'Россия'      → 'rossiia'
        '中国'         → 'zhongguo'
        'ドイツ'        → 'doitsu'
        'Venäjä'      → 'venaja'
        "K'azak'stan" → 'kazakstan'

    Transliteration is via the `unidecode` package: pure-Python,
    deterministic, decent quality on major scripts (Cyrillic / CJK /
    Devanagari / Thai are good; Arabic gets a rougher Buckwalter-style
    output but at least lands non-Arabic exonyms in roughly comparable
    Latin form). Non-alphanumeric stripping ('zhong guo' → 'zhongguo')
    keeps word-boundary whitespace from inflating edit distance.

    DO NOT remove unidecode and revert to "preserve script differences"
    — the auto-clusterer specifically depends on phonetic comparison
    across scripts; the cross-script-similarity-zero behavior is a bug,
    not a feature.
    """
    transliterated = unidecode(s)
    folded = transliterated.casefold()
    decomposed = unicodedata.normalize("NFKD", folded)
    no_marks = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return _NON_ALNUM.sub("", no_marks)


def _levenshtein(a: str, b: str) -> int:
    """Iterative two-row Levenshtein. ~17k pairs * avg ~10-char strings is
    trivial Python; no rapidfuzz dep needed."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    if len(a) < len(b):
        a, b = b, a  # ensure a is the longer one; smaller inner row
    prev = list(range(len(b) + 1))
    curr = [0] * (len(b) + 1)
    for i, ca in enumerate(a, start=1):
        curr[0] = i
        for j, cb in enumerate(b, start=1):
            cost = 0 if ca == cb else 1
            curr[j] = min(
                prev[j] + 1,        # deletion
                curr[j - 1] + 1,    # insertion
                prev[j - 1] + cost, # substitution
            )
        prev, curr = curr, prev
    return prev[len(b)]


def normalized_similarity(exonym: str, endonym: str) -> float:
    """Return a similarity score in [0, 1] where:
      - 1.0 = identical after casefold + NFKD (e.g. 'Aruba' vs 'Aruba')
      - 0.0 = completely disjoint (e.g. 'ドイツ' vs 'Deutschland')

    Computed as 1 - levenshtein(a, b) / max(len(a), len(b)) on the
    normalized strings. The denominator means strings of vastly different
    lengths (or different scripts) bottom out near 0, which is what we
    want — they ARE foreign-sounding to the endonym.

    Used as the lightness channel in the map's cluster recolor: hue
    encodes etymological cluster (categorical), similarity encodes
    orthographic closeness to the endonym (continuous). Together they
    let the viewer see, at a glance, "this country calls itself X, and
    its neighbors say things that sound mostly like / kinda like / not
    at all like X."
    """
    if not exonym and not endonym:
        return 1.0
    a = _normalize_for_similarity(exonym)
    b = _normalize_for_similarity(endonym)
    if not a and not b:
        return 1.0
    denom = max(len(a), len(b))
    if denom == 0:
        return 1.0
    return 1.0 - _levenshtein(a, b) / denom


def fetch_language_bcp47(
    language_qids: list[str],
) -> dict[str, str | None]:
    """For each language QID, return its ISO 639-1 alpha-2 (BCP47 short tag),
    or None if it doesn't have one. Languages without an alpha-2 (e.g. Zulu
    has 'zu' but many indigenous languages don't) fall back to using their
    ISO 639-3 tag directly, which Wikidata also accepts."""
    if not language_qids:
        return {}
    values = " ".join(f"wd:{q}" for q in language_qids)
    query = f"""
    SELECT ?lang ?alpha2 WHERE {{
      VALUES ?lang {{ {values} }}
      OPTIONAL {{ ?lang wdt:P218 ?alpha2 }}
    }}
    """
    bindings = sparql_query(query)
    out: dict[str, str | None] = {q: None for q in language_qids}
    for b in bindings:
        lq = b["lang"]["value"].rsplit("/", 1)[-1]
        alpha2 = b.get("alpha2", {}).get("value")
        if alpha2:
            out[lq] = alpha2
    return out
