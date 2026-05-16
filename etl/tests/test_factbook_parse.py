"""Unit tests for the Factbook languages-text parser.

The Factbook prose has multiple shapes per country. These tests cover the
high-stakes ones: clean percentage lists, "only X" / "X only" prefixes
and suffixes, multilingual bilingual statements (Paraguay), and the
blocklist filters that keep 'other' and 'unspecified' out of the data.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fetch_country_languages import (  # noqa: E402
    is_official,
    lookup_language,
    normalize_lang_name,
    parse_factbook_languages,
)


# --- normalize_lang_name ---------------------------------------------------

def test_normalize_strips_parenthetical_modifier():
    assert normalize_lang_name("English (official)") == "English"


def test_normalize_strips_only_prefix():
    assert normalize_lang_name("only Guarani") == "Guarani"


def test_normalize_strips_only_suffix():
    """Factbook USA uses 'English only (official) 78.2%' — without trailing
    'only' stripping, this parses to a non-language and the L1-dominance
    rule fails on the most obvious case."""
    assert normalize_lang_name("English only") == "English"


def test_normalize_picks_first_alternative_in_or_pair():
    """ZAF uses 'isiZulu or Zulu (official)' — both forms appear; we pick
    the first and rely on LANGUAGE_NAME_OVERRIDES to map it."""
    assert normalize_lang_name("isiZulu or Zulu") == "isiZulu"


def test_normalize_handles_combined_prefix_suffix_paren():
    assert normalize_lang_name("only English (official)") == "English"
    assert normalize_lang_name("English only (official)") == "English"


# --- parse_factbook_languages -----------------------------------------------

def test_parse_clean_percentages():
    text = "English (official) 78.2%, Spanish 13.4%, Chinese 1.1%, other 7.3% (2017 est.)"
    rows = parse_factbook_languages(text)
    names = [r[0] for r in rows]
    pcts = [r[1] for r in rows]
    assert "English" in " ".join(names)
    assert 78.2 in pcts
    assert 13.4 in pcts
    assert any("Spanish" in n for n in names)


def test_parse_returns_empty_for_no_percentages():
    """Nigeria's Factbook entry has only a language list, no percentages.
    Stage 3 needs to handle that gracefully — emit nothing here, let
    downstream fall back to Wikidata P37."""
    text = "English (official), Hausa, Yoruba, Igbo (Ibo), Fulani, over 500 additional indigenous languages"
    assert parse_factbook_languages(text) == []


def test_parse_captures_official_flag():
    text = "Hindi 43.6%, English (subsidiary official) 2.1%"
    rows = parse_factbook_languages(text)
    flags = {name.strip(): off for name, _, off in rows}
    assert flags.get("Hindi") is False
    # "English (subsidiary official)" → contains "(official" → True
    assert flags.get("English") is True


# --- lookup_language --------------------------------------------------------

def make_lookup() -> dict[str, str]:
    return {
        "english": "eng",
        "spanish": "spa",
        "german": "deu",
        "guarani": "grn",
    }


def test_lookup_handles_override():
    """isiZulu doesn't appear in Wikidata as a primary English label; the
    LANGUAGE_NAME_OVERRIDES table catches it. Same for Pedi / Northern Sotho."""
    assert lookup_language("isiZulu (official)", make_lookup()) == "zul"
    assert lookup_language("Pedi", make_lookup()) == "nso"


def test_lookup_falls_back_to_name_en():
    assert lookup_language("English (official)", make_lookup()) == "eng"
    assert lookup_language("German", make_lookup()) == "deu"


def test_lookup_blocklist_filters_other():
    """'other 7.3%' is a Factbook artifact, not a language."""
    assert lookup_language("other", make_lookup()) is None
    assert lookup_language("unspecified", make_lookup()) is None
    assert lookup_language("indigenous languages", make_lookup()) is None


def test_lookup_unknown_returns_none():
    """When a language name truly doesn't map, we return None so the caller
    can log/skip rather than fabricate an answer."""
    assert lookup_language("Klingon", make_lookup()) is None


# --- is_official -----------------------------------------------------------

def test_is_official_detects_paren_marker():
    assert is_official("English (official) 78.2%") is True
    assert is_official("English (subsidiary official) 2.1%") is True
    assert is_official("Spanish 13.4%") is False
