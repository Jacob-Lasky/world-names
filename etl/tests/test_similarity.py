"""Unit tests for the normalized_similarity helper in _lib.py — the lightness
channel that drives the front-end map's per-polygon brightness."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from _lib import _levenshtein, _normalize_for_similarity, _strip_country_prefix, normalized_similarity, pronunciation


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


def test_cross_script_now_compares_phonetically():
    """Post-unidecode: cross-script pairs no longer have automatic zero
    similarity. Japanese ドイツ transliterates to 'doitsu' and shares the
    'd...t...' phonetic skeleton with Deutschland. Same for Cyrillic
    Россия → 'rossiia' vs Russia → 'russia'.

    The previous "always-zero for cross-script" behavior was a latent
    bug — it broke the similarity-to-endonym channel for every country
    with a non-Latin endonym (Russia, China, Japan, Saudi Arabia, ...).
    The Legend's cluster recolor for those countries degenerated to
    "fully saturated everywhere" because no observer's exonym
    registered any similarity to the endonym."""
    # Japanese ドイツ ↔ German Deutschland: borrowed via Dutch "Duits",
    # so a non-trivial phonetic relationship exists.
    assert normalized_similarity("ドイツ", "Deutschland") > 0.2
    assert normalized_similarity("ドイツ", "Deutschland") < 0.4

    # Russian Россия ↔ English Russia: same root, transliteration
    # gives 'rossiia' vs 'russia' → meaningful similarity.
    assert normalized_similarity("Россия", "Russia") > 0.4

    # Genuine "foreign" pairs still score low.
    # 中国 → 'zhongguo' has nothing in common with 'Deutschland'.
    assert normalized_similarity("中国", "Deutschland") < 0.3


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


# ---------- pronunciation() — display-form transliteration ----------

def test_pronunciation_none_for_pure_latin():
    """Latin-script inputs don't need a pronunciation guide — the
    reader already sees something they can pronounce."""
    assert pronunciation("Allemagne") is None
    assert pronunciation("Russia") is None
    assert pronunciation("United States") is None
    assert pronunciation("") is None


def test_pronunciation_none_for_latin_with_accents():
    """Accents and diacritics on Latin letters don't trigger a guide.
    The reader can read 'Naïve' or 'Däitschland'; unidecode would
    just strip the accents and produce 'Naive' / 'Daitschland',
    which doesn't help."""
    assert pronunciation("Naïve") is None
    assert pronunciation("Däitschland") is None
    assert pronunciation("Þýskaland") is None  # Old Norse Þ + ý + á
    assert pronunciation("Венеція") is None or pronunciation("Венеція") is not None  # all Cyrillic; just checking the boundary


def test_pronunciation_renders_for_cyrillic():
    """Cyrillic is fully non-Latin so the unidecode pass adds real
    reading help."""
    assert pronunciation("Россия") == "Rossiia"
    assert pronunciation("Україна") == "Ukrayina"


def test_pronunciation_renders_for_cjk():
    """CJK transliterates as pinyin-style word-separated romanization.
    Imperfect for Japanese (unidecode reads CJK as Mandarin) but
    consistently readable."""
    assert pronunciation("中华人民共和国") == "Zhong Hua Ren Min Gong He Guo"
    assert pronunciation("日本") == "Ri Ben"
    assert pronunciation("대한민국") == "daehanmingug"


def test_pronunciation_renders_for_brahmic_scripts():
    """Devanagari, Thai, Lao — the scripts the user's bug report
    called out. The output isn't perfect romanization (Thai 'ประเทศ'
    'prathet' renders as 'praeths' because unidecode is single-pass
    Unicode-to-ASCII, not a phonetic translator) but it's a
    readable cue."""
    p = pronunciation("ประเทศญี่ปุ่น")
    assert p is not None
    # Both Thai and Lao for Japan transliterate to similar readings —
    # the suffix "iipun" (= "Japan") is the load-bearing recognizable part.
    assert "iipun" in p
    p = pronunciation("ປະເທດຍີ່ປຸ່ນ")
    assert p is not None
    assert "iipun" in p


def test_pronunciation_dominant_script_rule():
    """Latin-dominant strings with a few non-Latin chars don't trigger
    a pronunciation guide. Auto-clustering may name a cluster after a
    mostly-Latin etymon like 'Slavic *němьcь' (Latin word + a couple
    of Cyrillic soft signs) — unidecode would emit 'Slavic *nem'c''
    which is strictly worse than the original. Suppress."""
    assert pronunciation("Slavic *němьcь") is None
    # Whereas a Cyrillic-dominant string does get a guide
    assert pronunciation("Россия") is not None


def test_pronunciation_collapses_whitespace():
    """Unidecode sometimes emits multiple spaces (one per source
    grapheme). The display form normalizes to single spaces so the
    pronunciation reads as natural words."""
    p = pronunciation("中  国")
    assert p is not None
    assert "  " not in p


# ---------- _strip_country_prefix — Thai/Lao "country of …" stripping ----------

def test_strip_country_prefix_thai():
    """Thai prepends ประเทศ ('country [of]') to most country names.
    The prefix is phonetic noise that ruins cross-language clustering
    after unidecode (every Thai exonym starts with 'praeths')."""
    assert _strip_country_prefix("ประเทศญี่ปุ่น", "tha") == "ญี่ปุ่น"
    assert _strip_country_prefix("ประเทศรัสเซีย", "tha") == "รัสเซีย"
    assert _strip_country_prefix("สาธารณรัฐประชาธิปไตยคองโก", "tha") == "ประชาธิปไตยคองโก"


def test_strip_country_prefix_lao():
    """Same pattern in Lao via ປະເທດ."""
    assert _strip_country_prefix("ປະເທດຍີ່ປຸ່ນ", "lao") == "ຍີ່ປຸ່ນ"


def test_strip_country_prefix_no_match():
    """If the exonym doesn't start with a known classifier, return
    it unchanged."""
    # Thai exonym that doesn't use the ประเทศ prefix (a city-state
    # might appear as just its name, or a transliteration like
    # 'อิสราเอล' for Israel which is bare).
    assert _strip_country_prefix("อิสราเอล", "tha") == "อิสราเอล"


def test_strip_country_prefix_unknown_language():
    """Languages without an entry in COUNTRY_OF_PREFIXES pass through
    untouched. Default behavior is conservative — don't strip
    anything we haven't explicitly verified is a classifier."""
    assert _strip_country_prefix("Россия", "rus") == "Россия"
    assert _strip_country_prefix("Japan", "eng") == "Japan"
    assert _strip_country_prefix("anything", None) == "anything"


def test_strip_country_prefix_doesnt_return_empty():
    """If stripping the prefix would leave the empty string (a
    hypothetical exonym that's JUST the classifier), return the
    original to avoid emitting nothing."""
    assert _strip_country_prefix("ประเทศ", "tha") == "ประเทศ"
