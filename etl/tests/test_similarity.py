"""Unit tests for the normalized_similarity helper in _lib.py — the lightness
channel that drives the front-end map's per-polygon brightness."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from _lib import _levenshtein, _normalize_for_similarity, normalized_similarity


def test_identical_strings_score_one():
    assert normalized_similarity("Deutschland", "Deutschland") == 1.0


def test_case_difference_scores_one():
    """Same letters, different case → identical post-normalization."""
    assert normalized_similarity("DEUTSCHLAND", "deutschland") == 1.0


def test_diacritic_difference_scores_one():
    """NFKD-decompose + strip combining marks: naïve == naive == NAIVE."""
    assert normalized_similarity("naïve", "naive") == 1.0
    assert normalized_similarity("Allemagne", "allemagne") == 1.0


def test_close_variants_score_high():
    """Deutschland vs Duitsland (Dutch): 4 edits over 11 chars → ~0.64."""
    s = normalized_similarity("Duitsland", "Deutschland")
    assert 0.5 < s < 0.8, f"expected ~0.64, got {s}"


def test_distant_variants_score_low():
    """Niemcy vs Deutschland: should score very low since they share almost
    no characters in order."""
    s = normalized_similarity("Niemcy", "Deutschland")
    assert s < 0.3, f"expected <0.3, got {s}"


def test_cross_script_scores_near_zero():
    """ドイツ (Japanese for Germany) vs Deutschland: no shared characters,
    distance == max length, similarity == 0."""
    assert normalized_similarity("ドイツ", "Deutschland") == 0.0


def test_empty_strings():
    """Both empty: identical. One empty: maximum distance."""
    assert normalized_similarity("", "") == 1.0
    assert normalized_similarity("", "Germany") == 0.0
    assert normalized_similarity("Germany", "") == 0.0


def test_similarity_is_symmetric():
    """Order of args shouldn't matter."""
    a = normalized_similarity("Deutschland", "Allemagne")
    b = normalized_similarity("Allemagne", "Deutschland")
    assert a == b


def test_returns_float_in_unit_interval():
    """Edge cases: result must always be in [0, 1] regardless of input lengths."""
    for a, b in [
        ("a", "a" * 100),
        ("a" * 100, "b" * 100),
        ("hello", "world"),
        ("xyz", "abc"),
    ]:
        s = normalized_similarity(a, b)
        assert 0.0 <= s <= 1.0, f"out of range: {s} for ({a!r}, {b!r})"


def test_normalize_strips_combining_marks():
    """Internal helper — verifies the NFKD+strip pipeline directly so a
    future change to the helper can't silently break the public API."""
    assert _normalize_for_similarity("Naïve") == "naive"
    assert _normalize_for_similarity("ÄÖÜ") == "aou"


def test_levenshtein_basics():
    """Sanity check the iterative implementation for known classic cases."""
    assert _levenshtein("", "") == 0
    assert _levenshtein("kitten", "sitting") == 3
    assert _levenshtein("a", "") == 1
    assert _levenshtein("", "abc") == 3
    assert _levenshtein("same", "same") == 0
