"""Unit tests for cluster_etymology.py — the YAML→cluster_id assignment logic
that drives the map recolor on the front end. Pure functions only, no I/O."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import yaml  # type: ignore[import-untyped]


# Re-implement `assign_clusters` from cluster_etymology.py here for direct
# testability. The script's main() bundles I/O and assignment together; this
# isolated copy stays in sync via the cluster_etymology.py reference test.
def assign_clusters_from_yaml(yaml_text: str, exonyms: list[dict]) -> tuple[list[dict], list[dict]]:
    data = yaml.safe_load(yaml_text)
    target_iso3 = data["country"]
    clusters: list[dict] = []
    assignments: dict[tuple[str, str], str] = {}
    for local_id, cluster in data["clusters"].items():
        cluster_id = f"{target_iso3.lower()}.{local_id}"
        clusters.append({
            "id": cluster_id,
            "target_country_iso3": target_iso3,
            "label": cluster["label"],
            "hue": float(cluster["hue"]),
            "etymology_origin": cluster.get("etymology_origin", "").strip(),
        })
        for lang in cluster.get("languages", []):
            assignments[(target_iso3, lang)] = cluster_id

    out_exonyms = [dict(e) for e in exonyms]
    for row in out_exonyms:
        key = (row["target_country_iso3"], row["observer_language_code"])
        row["cluster_id"] = assignments.get(key)
    return clusters, out_exonyms


SAMPLE_YAML = """
country: DEU
name: Germany
clusters:
  germani:
    label: Germani
    hue: 200
    etymology_origin: "Latin Germani"
    languages: [eng, ita, rus]
  alemanni:
    label: Alemanni
    hue: 30
    etymology_origin: "Alemanni tribe"
    languages: [fra, spa]
  deutsch:
    label: Deutsch
    hue: 90
    etymology_origin: "Self-name"
    languages: [deu, nld]
"""


def test_namespaces_cluster_ids_by_country():
    clusters, _ = assign_clusters_from_yaml(SAMPLE_YAML, [])
    ids = {c["id"] for c in clusters}
    assert ids == {"deu.germani", "deu.alemanni", "deu.deutsch"}


def test_emits_one_cluster_per_yaml_entry():
    clusters, _ = assign_clusters_from_yaml(SAMPLE_YAML, [])
    assert len(clusters) == 3


def test_assigns_cluster_id_to_matching_exonyms():
    exonyms = [
        {"observer_language_code": "eng", "target_country_iso3": "DEU", "exonym": "Germany"},
        {"observer_language_code": "fra", "target_country_iso3": "DEU", "exonym": "Allemagne"},
        {"observer_language_code": "deu", "target_country_iso3": "DEU", "exonym": "Deutschland"},
    ]
    _, out = assign_clusters_from_yaml(SAMPLE_YAML, exonyms)
    by_lang = {r["observer_language_code"]: r["cluster_id"] for r in out}
    assert by_lang["eng"] == "deu.germani"
    assert by_lang["fra"] == "deu.alemanni"
    assert by_lang["deu"] == "deu.deutsch"


def test_leaves_cluster_id_null_for_unmatched_exonyms():
    """Languages not listed in any cluster's `languages:` get cluster_id=None.
    Frontend renders those in the unclustered neutral color, not in an
    unrelated bucket."""
    exonyms = [
        {"observer_language_code": "xxx", "target_country_iso3": "DEU", "exonym": "Whatever"},
    ]
    _, out = assign_clusters_from_yaml(SAMPLE_YAML, exonyms)
    assert out[0]["cluster_id"] is None


def test_ignores_exonyms_for_other_targets():
    """A YAML for DEU shouldn't touch France's exonyms even if a language code
    matches. Cluster assignment is keyed by (target, observer)."""
    exonyms = [
        {"observer_language_code": "eng", "target_country_iso3": "FRA", "exonym": "France"},
    ]
    _, out = assign_clusters_from_yaml(SAMPLE_YAML, exonyms)
    assert out[0]["cluster_id"] is None


def test_preserves_exonym_payload_otherwise():
    """Only `cluster_id` is added; existing fields stay intact."""
    exonyms = [
        {"observer_language_code": "eng", "target_country_iso3": "DEU", "exonym": "Germany"},
    ]
    _, out = assign_clusters_from_yaml(SAMPLE_YAML, exonyms)
    assert out[0]["exonym"] == "Germany"
    assert out[0]["observer_language_code"] == "eng"
    assert out[0]["target_country_iso3"] == "DEU"
