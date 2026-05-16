"""Issue #2 — etymological clustering.

Reads `etl/roots/<iso3>.yaml` hand-curated cluster definitions, joins to
the exonyms cache, emits:

  * `cache/clusters.jsonl` — one row per cluster (id, target_country, label, hue)
  * `cache/exonyms.jsonl`  — rewritten in place with `cluster_id` populated
    on rows whose observer_language appears in a cluster's `languages:` list.

The cluster id is namespaced as `<country_iso3>.<cluster_local_id>` so it's
globally unique across all target countries.

YAML schema (see etl/roots/DEU.yaml for the canonical example):

  country: <iso3>
  name: <english name>
  clusters:
    <local_id>:
      label: <human-readable>
      hue: <0-360, HSL>
      etymology_origin: <multi-line story>
      languages: [<iso639_3>, ...]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import yaml  # type: ignore[import-untyped]

ETL = Path(__file__).parent
ROOTS_DIR = ETL / "roots"
EXONYMS_CACHE = ETL / "cache" / "exonyms.jsonl"
CLUSTERS_CACHE = ETL / "cache" / "clusters.jsonl"


def load_root_yaml(path: Path) -> dict:
    with path.open() as f:
        data = yaml.safe_load(f)
    if not isinstance(data, dict):
        raise ValueError(f"{path}: top-level must be a mapping")
    if "country" not in data or "clusters" not in data:
        raise ValueError(f"{path}: missing 'country' or 'clusters' key")
    return data


def main() -> int:
    if not EXONYMS_CACHE.exists():
        print(f"ERROR: {EXONYMS_CACHE} missing. Run stage 5 first.")
        return 1

    # Load all root YAMLs
    yaml_files = sorted(ROOTS_DIR.glob("*.yaml"))
    if not yaml_files:
        print(f"no YAMLs in {ROOTS_DIR}. Add at least one country to cluster.")
        return 0

    clusters: list[dict] = []
    # (target_iso3, observer_iso639_3) → cluster_id
    assignments: dict[tuple[str, str], str] = {}

    for path in yaml_files:
        data = load_root_yaml(path)
        target_iso3 = data["country"]
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
                key = (target_iso3, lang)
                if key in assignments:
                    print(f"WARN: duplicate assignment for {key}: "
                          f"{assignments[key]} → {cluster_id}")
                assignments[key] = cluster_id

    # Rewrite exonyms with cluster_id populated where applicable
    exonyms = [json.loads(line) for line in EXONYMS_CACHE.read_text().splitlines() if line]
    matched = 0
    for row in exonyms:
        key = (row["target_country_iso3"], row["observer_language_code"])
        cluster_id = assignments.get(key)
        row["cluster_id"] = cluster_id
        if cluster_id is not None:
            matched += 1

    # Write outputs
    clusters.sort(key=lambda c: c["id"])
    CLUSTERS_CACHE.write_text(
        "\n".join(json.dumps(c, ensure_ascii=False) for c in clusters) + "\n"
    )
    exonyms.sort(key=lambda r: (r["observer_language_code"], r["target_country_iso3"]))
    EXONYMS_CACHE.write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in exonyms) + "\n"
    )

    print(f"wrote {len(clusters)} clusters to {CLUSTERS_CACHE}")
    print(f"populated cluster_id on {matched} / {len(exonyms)} exonym rows")

    # Per-country breakdown
    by_country: dict[str, dict[str, int]] = {}
    for row in exonyms:
        tc = row["target_country_iso3"]
        cid = row.get("cluster_id") or "<unassigned>"
        by_country.setdefault(tc, {}).setdefault(cid, 0)
        by_country[tc][cid] += 1
    targets_with_clusters = sorted({c["target_country_iso3"] for c in clusters})
    for tc in targets_with_clusters:
        counts = by_country.get(tc, {})
        total = sum(counts.values())
        assigned = total - counts.get("<unassigned>", 0)
        print(f"\n=== {tc}: {assigned}/{total} exonyms clustered ===")
        for cid, n in sorted(counts.items(), key=lambda x: -x[1]):
            print(f"  {cid}: {n}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
