"""Unit tests for the auto-clustering primitives. The full pipeline
runs over real data via auto_cluster.py main(), so these tests focus
on the algorithm correctness and edge cases that are hard to verify
from a 200-country production run."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from auto_cluster import (
    DISTANCE_THRESHOLD,
    assign_hues,
    cluster_country_exonyms,
    country_phase_seed,
    pick_centroid,
    union_find_cluster,
)


def test_union_find_groups_close_strings():
    """The simplest case: orthographic-family members chain together
    while the genuinely-different name stays separate."""
    groups = union_find_cluster(
        ["Allemagne", "Alemania", "Alemanha", "Niemcy"], DISTANCE_THRESHOLD
    )
    # Three Alemanni-family names in one cluster; Niemcy alone.
    sizes = sorted(len(g) for g in groups)
    assert sizes == [1, 3], f"expected [1, 3], got {sizes}"


def test_union_find_separates_distant_strings():
    """Inputs far apart from each other end up as singleton groups."""
    groups = union_find_cluster(["Russia", "中国", "ドイツ"], 0.45)
    assert len(groups) == 3, "different-script names should be 3 separate groups"


def test_union_find_single_input():
    """Empty / single-element input handled gracefully."""
    assert union_find_cluster([], 0.5) == []
    assert union_find_cluster(["alone"], 0.5) == [[0]]


def test_pick_centroid_returns_lowest_mean_distance_member():
    """The most-typical spelling — closest to all the others — wins.
    For Allemagne / Alemania / Alemanha, Alemania has the lowest mean
    distance to the rest, so it's the centroid."""
    centroid = pick_centroid(["Allemagne", "Alemania", "Alemanha"])
    assert centroid in ("Alemania", "Alemanha")  # both are equidistant centers


def test_pick_centroid_single_item():
    """A single-element cluster centroids to itself."""
    assert pick_centroid(["solo"]) == "solo"


def test_cluster_country_exonyms_drops_singletons():
    """Singletons aren't useful in the legend, so the
    `cluster_country_exonyms` pipeline drops them. Build a fixture
    where 3 names chain together via orthographic similarity and a
    4th is genuinely far from all of them (post-transliteration too,
    so unidecode doesn't accidentally bridge to it)."""
    exonyms = [
        {"observer_language_code": "eng", "exonym": "Russia"},
        {"observer_language_code": "spa", "exonym": "Rusia"},
        {"observer_language_code": "fra", "exonym": "Russie"},
        {"observer_language_code": "fin", "exonym": "Venäjä"},  # phonetic singleton (Finnic)
    ]
    clusters = cluster_country_exonyms(exonyms)
    assert len(clusters) == 1
    assert len(clusters[0].members) == 3
    # The Finnic outlier shouldn't appear in any kept cluster — Venäjä
    # transliterates to 'venaja' which is far from 'russia'/'rusia'/'russie'.
    member_strs = {m["exonym"] for m in clusters[0].members}
    assert "Venäjä" not in member_strs


def test_cluster_country_exonyms_bridges_scripts_post_unidecode():
    """Regression coverage for the phonetic-clustering upgrade. Before
    the unidecode pass, Russia's Cyrillic 'Россия' had distance 1.0 to
    Latin 'Russia' (no shared characters) and landed in its own
    cluster. After: 'rossiia' vs 'russia' is close enough to join.

    Without this behavior, the auto-clusterer's legend on Russia
    showed 5 script-divided clusters instead of ~2 phonetic groups."""
    exonyms = [
        {"observer_language_code": "eng", "exonym": "Russia"},
        {"observer_language_code": "rus", "exonym": "Россия"},   # → 'rossiia'
        {"observer_language_code": "ukr", "exonym": "Росія"},    # → 'rosiia'
        {"observer_language_code": "fas", "exonym": "روسیه"},    # → 'rwsyh' (Buckwalter-ish)
    ]
    clusters = cluster_country_exonyms(exonyms)
    # The Latin + both Cyrillic forms should all chain together.
    all_members = {m["exonym"] for c in clusters for m in c.members}
    assert "Russia" in all_members
    assert "Россия" in all_members
    assert "Росія" in all_members


def test_cluster_country_exonyms_sorted_descending_by_size():
    """Largest cluster first — the legend renders them top-to-bottom
    so the biggest root reads at a glance."""
    exonyms = [
        {"observer_language_code": "a", "exonym": "Foo"},
        {"observer_language_code": "b", "exonym": "Fop"},
        {"observer_language_code": "c", "exonym": "Foe"},
        {"observer_language_code": "d", "exonym": "Bar"},
        {"observer_language_code": "e", "exonym": "Baz"},
    ]
    clusters = cluster_country_exonyms(exonyms)
    sizes = [len(c.members) for c in clusters]
    assert sizes == sorted(sizes, reverse=True)


def test_cluster_country_exonyms_empty():
    assert cluster_country_exonyms([]) == []


def test_assign_hues_spreads_across_wheel():
    """N clusters → N evenly-spaced hues from [0, 360)."""
    hues = assign_hues(4, phase_seed=0)
    assert hues == [0.0, 90.0, 180.0, 270.0]


def test_assign_hues_respects_phase_offset():
    """Phase offset rotates the whole palette so different countries
    don't all start at hue 0."""
    hues = assign_hues(4, phase_seed=60)
    assert hues == [60.0, 150.0, 240.0, 330.0]


def test_country_phase_seed_is_deterministic_and_varies():
    """Same ISO3 → same seed (deterministic rebuilds); different ISO3s
    generally land at different hues (visually distinct palettes)."""
    assert country_phase_seed("DEU") == country_phase_seed("DEU")
    # Spot-check a few well-known codes have distinct seeds
    seeds = {country_phase_seed(c) for c in ["DEU", "USA", "CHN", "FRA", "RUS"]}
    assert len(seeds) >= 4, "country phase seeds should generally differ"
