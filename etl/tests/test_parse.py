"""Unit tests for the SPARQL row parsers. Use static binding fixtures so we
don't hit Wikidata in tests."""
from __future__ import annotations

import sys
from pathlib import Path

# Make the flat etl/ scripts importable without a package layout.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from _lib import qid, value  # noqa: E402
from fetch_countries import parse_row  # noqa: E402


def make_binding(country_uri: str, iso3: str | None, m49: str | None, name_en: str | None) -> dict:
    """Build a Wikidata-shaped SPARQL binding dict for parse_row tests."""
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


# --- helpers ---------------------------------------------------------------

def test_value_returns_string_or_none():
    b = {"foo": {"type": "literal", "value": "bar"}}
    assert value(b, "foo") == "bar"
    assert value(b, "missing") is None


def test_qid_strips_uri_to_slug():
    b = {"country": {"type": "uri", "value": "http://www.wikidata.org/entity/Q30"}}
    assert qid(b, "country") == "Q30"
    assert qid(b, "missing") is None


# --- parse_row -------------------------------------------------------------

def test_parse_complete_row():
    b = make_binding(
        "http://www.wikidata.org/entity/Q30", "USA", "840", "United States of America"
    )
    assert parse_row(b) == {
        "qid": "Q30",
        "iso3": "USA",
        "m49": "840",
        "name_en": "United States of America",
    }


def test_parse_keeps_missing_m49():
    """Some smaller countries lack a stated M49 code on Wikidata. That's OK,
    the row should still be valid (m49 is None)."""
    b = make_binding("http://www.wikidata.org/entity/Q1014", "LSO", None, "Lesotho")
    row = parse_row(b)
    assert row is not None
    assert row["m49"] is None
    assert row["iso3"] == "LSO"


def test_parse_rejects_short_code():
    """An ISO 3166-1 alpha-2 code accidentally landing in the alpha-3 slot
    would corrupt downstream joins. Reject."""
    b = make_binding("http://www.wikidata.org/entity/Q31", "BE", "056", "Belgium")
    assert parse_row(b) is None


def test_parse_rejects_lowercase_code():
    """Defensive: alpha-3 codes are always uppercase."""
    b = make_binding("http://www.wikidata.org/entity/Q31", "bel", "056", "Belgium")
    assert parse_row(b) is None


def test_parse_rejects_missing_iso3():
    """Without an alpha-3 code we can't join on this row anyway."""
    b = make_binding("http://www.wikidata.org/entity/Q200", None, None, "Microstate")
    assert parse_row(b) is None
