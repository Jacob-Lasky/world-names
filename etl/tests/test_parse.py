"""Unit tests for the SPARQL row parsers. Static binding fixtures, no network."""
from __future__ import annotations

import sys
from pathlib import Path

# Make the flat etl/ scripts importable without a package layout.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from _lib import qid, value  # noqa: E402
from fetch_countries import parse_row as parse_country  # noqa: E402
from fetch_languages import parse_row as parse_language  # noqa: E402


def make_country_binding(
    country_uri: str, iso3: str | None, m49: str | None, name_en: str | None
) -> dict:
    b: dict = {}
    if country_uri:
        b["country"] = {"type": "uri", "value": country_uri}
    if iso3 is not None:
        b["iso3"] = {"type": "literal", "value": iso3}
    if m49 is not None:
        b["m49"] = {"type": "literal", "value": m49}
    if name_en is not None:
        b["nameEn"] = {"type": "literal", "xml:lang": "en", "value": name_en}
    return b


def make_language_binding(
    lang_uri: str, iso639_3: str | None, name_en: str | None
) -> dict:
    b: dict = {}
    if lang_uri:
        b["language"] = {"type": "uri", "value": lang_uri}
    if iso639_3 is not None:
        b["iso639_3"] = {"type": "literal", "value": iso639_3}
    if name_en is not None:
        b["nameEn"] = {"type": "literal", "xml:lang": "en", "value": name_en}
    return b


# --- shared helpers ---------------------------------------------------------

def test_value_returns_string_or_none():
    b = {"foo": {"type": "literal", "value": "bar"}}
    assert value(b, "foo") == "bar"
    assert value(b, "missing") is None


def test_qid_strips_uri_to_slug():
    b = {"country": {"type": "uri", "value": "http://www.wikidata.org/entity/Q30"}}
    assert qid(b, "country") == "Q30"
    assert qid(b, "missing") is None


# --- parse_country (stage 1) -----------------------------------------------

def test_country_parse_complete():
    b = make_country_binding(
        "http://www.wikidata.org/entity/Q30", "USA", "840", "United States of America"
    )
    assert parse_country(b) == {
        "qid": "Q30",
        "iso3": "USA",
        "m49": "840",
        "name_en": "United States of America",
    }


def test_country_parse_keeps_missing_m49():
    """Some smaller countries lack a stated M49 code. That's OK — row stays valid."""
    b = make_country_binding(
        "http://www.wikidata.org/entity/Q1014", "LSO", None, "Lesotho"
    )
    row = parse_country(b)
    assert row is not None
    assert row["m49"] is None
    assert row["iso3"] == "LSO"


def test_country_parse_rejects_short_code():
    """An alpha-2 leaking into the alpha-3 slot would corrupt downstream joins."""
    b = make_country_binding(
        "http://www.wikidata.org/entity/Q31", "BE", "056", "Belgium"
    )
    assert parse_country(b) is None


def test_country_parse_rejects_lowercase_code():
    """ISO 3166-1 alpha-3 is always uppercase."""
    b = make_country_binding(
        "http://www.wikidata.org/entity/Q31", "bel", "056", "Belgium"
    )
    assert parse_country(b) is None


def test_country_parse_rejects_missing_iso3():
    b = make_country_binding(
        "http://www.wikidata.org/entity/Q200", None, None, "Microstate"
    )
    assert parse_country(b) is None


# --- parse_language (stage 2) ----------------------------------------------

def test_language_parse_complete():
    b = make_language_binding(
        "http://www.wikidata.org/entity/Q1860", "eng", "English"
    )
    assert parse_language(b) == {
        "qid": "Q1860",
        "iso639_3": "eng",
        "name_en": "English",
    }


def test_language_parse_keeps_indigenous_codes():
    """Stage 2 must surface languages like Zulu — they're the targets of the
    L1-dominance rule and the whole point of avoiding the colonial default."""
    b = make_language_binding(
        "http://www.wikidata.org/entity/Q10179", "zul", "Zulu"
    )
    assert parse_language(b) == {
        "qid": "Q10179",
        "iso639_3": "zul",
        "name_en": "Zulu",
    }


def test_language_parse_rejects_uppercase_code():
    """ISO 639-3 codes are always lowercase by spec."""
    b = make_language_binding(
        "http://www.wikidata.org/entity/Q1860", "ENG", "English"
    )
    assert parse_language(b) is None


def test_language_parse_rejects_wrong_length():
    """639-1 alpha-2 leaking into the 639-3 slot would corrupt joins.
    Same for 4+ letter constructs that aren't ISO 639-3."""
    b = make_language_binding(
        "http://www.wikidata.org/entity/Q1860", "en", "English"
    )
    assert parse_language(b) is None


def test_language_parse_rejects_missing_iso():
    b = make_language_binding(
        "http://www.wikidata.org/entity/Q200", None, "Unknown"
    )
    assert parse_language(b) is None
