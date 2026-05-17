"""Auto-generate first-pass cluster YAMLs for every country.

Hand-curated YAMLs (the ones in etl/roots/ that don't carry the
`auto_generated: true` flag) are the etymology-aware ground truth and
NEVER get overwritten by this script. For every other country with
enough exonyms to cluster meaningfully, we produce an auto-generated
YAML using string-similarity clustering (Union-Find on Unicode-
normalized Levenshtein distance, single-linkage chain).

What auto-clustering catches:
  - Orthographic families: Allemagne / Alemania / Almaniya share a
    cluster because they're close edit-distance neighbors after
    normalization.

What it misses:
  - Etymologically-related but orthographically-divergent names:
    Deutschland and Tyskland are the same Proto-Germanic *þeudō root
    but land in different clusters because the edit distance is high.
    These are the cases that need a hand-curated YAML for richer
    coverage.

A coverage report is emitted at etl/roots/COVERAGE.md listing every
country's status: hand-curated, auto-generated, or needs-manual-work
(too few exonyms to cluster meaningfully).
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import yaml  # type: ignore[import-untyped]

sys.path.insert(0, str(Path(__file__).parent))
from _lib import _levenshtein, _normalize_for_similarity, _strip_country_prefix  # noqa: E402

ETL = Path(__file__).parent
CACHE = ETL / "cache"
ROOTS = ETL / "roots"
COVERAGE = ROOTS / "COVERAGE.md"

EXONYMS_PATH = CACHE / "exonyms.jsonl"
ENDONYMS_PATH = CACHE / "endonyms.jsonl"
COUNTRIES_PATH = CACHE / "countries.jsonl"

# Single-linkage threshold on normalized Levenshtein. Two exonyms whose
# (edit-distance / max-len) is below this get unioned. 0.45 was picked
# by spot-checking: Allemagne ↔ Alemania (0.33) ↔ Almaniya (0.44) all
# chain into one cluster, while Allemagne ↔ Germany (0.75) stays
# separate. Tuning down makes clusters smaller and more confident.
DISTANCE_THRESHOLD = 0.45

# Minimum cluster size to keep. Singletons (1-member clusters) are
# dropped — they convey no group information and would just be noise
# in the legend. The exonym keeps cluster_id = NULL in the SQLite, so
# the map renders it in the unclustered neutral color.
MIN_CLUSTER_SIZE = 2

# Minimum exonyms-per-country threshold for auto-clustering to be
# worthwhile. Countries below this go on the "needs manual work" list
# in COVERAGE.md instead of getting a sparse auto-generated YAML.
MIN_EXONYMS_FOR_AUTO = 5


@dataclass
class ClusterCandidate:
    """One auto-discovered cluster within a country's exonyms."""
    members: list[dict]            # exonym rows (with observer_language_code, exonym)
    canonical_label: str           # most-common spelling among the members
    representative: str            # exonym closest to the cluster centroid (lowest mean dist)


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line]


def union_find_cluster(items: list[str], threshold: float) -> list[list[int]]:
    """Single-linkage clustering via Union-Find. Two items get unioned
    if their normalized edit distance is below `threshold`. Returns a
    list of clusters (each a list of indices into `items`).
    """
    n = len(items)
    parent = list(range(n))

    def find(x: int) -> int:
        # Path compression
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    norms = [_normalize_for_similarity(s) for s in items]
    for i in range(n):
        ni = norms[i]
        for j in range(i + 1, n):
            nj = norms[j]
            denom = max(len(ni), len(nj), 1)
            d = _levenshtein(ni, nj) / denom
            if d < threshold:
                union(i, j)

    groups: dict[int, list[int]] = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)
    return list(groups.values())


def pick_centroid(items: list[str]) -> str:
    """Return the item with the lowest mean edit-distance to the rest of
    the group — the "most typical" spelling. For groups of 1-2 this
    just returns the shortest item."""
    if len(items) == 1:
        return items[0]
    norms = [_normalize_for_similarity(s) for s in items]
    best_i = 0
    best_score = float("inf")
    for i in range(len(items)):
        ni = norms[i]
        total = 0
        for j in range(len(items)):
            if i == j:
                continue
            nj = norms[j]
            denom = max(len(ni), len(nj), 1)
            total += _levenshtein(ni, nj) / denom
        score = total / (len(items) - 1)
        if score < best_score:
            best_score = score
            best_i = i
    return items[best_i]


def cluster_country_exonyms(exonyms: list[dict]) -> list[ClusterCandidate]:
    """Cluster the exonyms a country has, return the size-≥2 clusters
    in size-descending order. Singletons are dropped.

    Per-language "country of …" prefix stripping happens HERE, not in
    the wider similarity helper, because the stripped form is only
    correct for clustering: the LABEL still uses the original full
    exonym for display, so the InspectionCard shows the actual Thai
    'ประเทศญี่ปุ่น' rather than a stripped 'ญี่ปุ่น'. Without the
    strip, Thai and Lao exonyms (which prepend 'country of' to
    everything) cluster only with each other; with it, they
    correctly join the main phonetic group for the target country.
    """
    if not exonyms:
        return []
    items = [e["exonym"] for e in exonyms]
    # cluster_keys are what the metric operates on — prefix-stripped per
    # observer language so 'ประเทศ' / 'ປະເທດ' classifier noise doesn't
    # dominate edit-distance. Parallel to `items`, same indexing.
    cluster_keys = [
        _strip_country_prefix(e["exonym"], e["observer_language_code"])
        for e in exonyms
    ]
    raw_groups = union_find_cluster(cluster_keys, DISTANCE_THRESHOLD)
    out: list[ClusterCandidate] = []
    for idx_list in raw_groups:
        if len(idx_list) < MIN_CLUSTER_SIZE:
            continue
        member_rows = [exonyms[i] for i in idx_list]
        # Label + representative come from the ORIGINAL exonyms (full
        # form). The clustering metric used the stripped form; the
        # display layer uses the unmodified text.
        member_strs = [items[i] for i in idx_list]
        counts = Counter(member_strs).most_common()
        max_count = counts[0][1]
        top = [s for s, c in counts if c == max_count]
        canonical = min(top, key=len)
        representative = pick_centroid(member_strs)
        out.append(ClusterCandidate(
            members=member_rows,
            canonical_label=canonical,
            representative=representative,
        ))
    out.sort(key=lambda c: len(c.members), reverse=True)
    return out


def assign_hues(n_clusters: int, phase_seed: int) -> list[float]:
    """Spread `n_clusters` hues evenly across the [0, 360) wheel.
    `phase_seed` rotates the starting hue so different countries get
    visually distinct palettes (stable across rebuilds: derived from
    the country's ISO3 code hash)."""
    if n_clusters == 0:
        return []
    step = 360.0 / n_clusters
    phase = (phase_seed % 360)
    return [(phase + i * step) % 360.0 for i in range(n_clusters)]


def country_phase_seed(iso3: str) -> int:
    """Deterministic 0-359 phase offset for a country's hue palette,
    so e.g. France's palette starts at hue 47 and Germany's at hue 211
    even if they have the same number of clusters."""
    h = 0
    for ch in iso3:
        h = (h * 31 + ord(ch)) & 0xffffffff
    return h % 360


def build_yaml(iso3: str, name_en: str, clusters: list[ClusterCandidate]) -> str:
    """Serialize a cluster set as a YAML document compatible with
    cluster_etymology.py. Marks the document `auto_generated: true`
    so a future run of auto_cluster.py will safely overwrite it; a
    human editor who wants to claim a YAML as hand-curated just
    removes that flag."""
    hues = assign_hues(len(clusters), country_phase_seed(iso3))
    doc: dict = {
        "country": iso3,
        "name": name_en,
        "auto_generated": True,
        "method": "string-similarity union-find on normalized Levenshtein",
        "threshold": DISTANCE_THRESHOLD,
        "clusters": {},
    }
    for i, (c, hue) in enumerate(zip(clusters, hues)):
        local_id = f"auto_{i}"
        languages = sorted({m["observer_language_code"] for m in c.members})
        doc["clusters"][local_id] = {
            "label": c.canonical_label,
            "hue": round(hue, 1),
            "etymology_origin": (
                f"Auto-detected orthographic cluster around '{c.representative}' "
                f"({len(c.members)} languages). Hand-curated etymology pending."
            ),
            "languages": languages,
        }
    # PyYAML's default dump produces readable enough output; force
    # block-style and don't sort keys to keep the cluster IDs in
    # size-descending order.
    return yaml.dump(doc, sort_keys=False, allow_unicode=True, default_flow_style=False)


def existing_yaml_status(path: Path) -> str:
    """Returns 'hand-curated', 'auto-generated', or 'missing'."""
    if not path.exists():
        return "missing"
    try:
        doc = yaml.safe_load(path.read_text())
    except Exception:
        return "missing"
    if isinstance(doc, dict) and doc.get("auto_generated") is True:
        return "auto-generated"
    return "hand-curated"


def main() -> int:
    countries = load_jsonl(COUNTRIES_PATH)
    exonyms_all = load_jsonl(EXONYMS_PATH)
    endonyms_all = load_jsonl(ENDONYMS_PATH)
    has_endonym = {e["country_iso3"] for e in endonyms_all}

    by_target: dict[str, list[dict]] = {}
    for e in exonyms_all:
        by_target.setdefault(e["target_country_iso3"], []).append(e)

    coverage: dict[str, list[str]] = {
        "hand": [],
        "auto": [],
        "needs_work": [],
    }
    written = 0
    skipped_handcurated = 0

    for c in sorted(countries, key=lambda x: x["iso3"]):
        iso3 = c["iso3"]
        name = c["name_en"]
        path = ROOTS / f"{iso3}.yaml"
        status = existing_yaml_status(path)
        exonyms = by_target.get(iso3, [])
        endonym_present = iso3 in has_endonym

        if status == "hand-curated":
            skipped_handcurated += 1
            coverage["hand"].append(f"- **{iso3}** {name} — hand-curated ({path.name})")
            continue

        if len(exonyms) < MIN_EXONYMS_FOR_AUTO:
            note_endonym = "" if endonym_present else ", **no endonym in data**"
            coverage["needs_work"].append(
                f"- **{iso3}** {name} — only {len(exonyms)} exonyms{note_endonym}; below the "
                f"{MIN_EXONYMS_FOR_AUTO}-exonym threshold for auto-clustering"
            )
            continue

        clusters = cluster_country_exonyms(exonyms)
        if not clusters:
            coverage["needs_work"].append(
                f"- **{iso3}** {name} — {len(exonyms)} exonyms but no cluster of size ≥{MIN_CLUSTER_SIZE} "
                f"(all exonyms too dissimilar to each other)"
            )
            continue

        path.write_text(build_yaml(iso3, name, clusters))
        written += 1
        endonym_note = "" if endonym_present else " ⚠ no endonym (lightness channel will be flat)"
        coverage["auto"].append(
            f"- **{iso3}** {name} — {len(clusters)} clusters from {len(exonyms)} exonyms{endonym_note}"
        )

    write_coverage(coverage, skipped_handcurated, written, len(countries))
    print(f"wrote {written} auto-generated YAMLs, skipped {skipped_handcurated} hand-curated")
    print(f"needs manual work: {len(coverage['needs_work'])}")
    print(f"coverage report: {COVERAGE}")
    return 0


def write_coverage(
    coverage: dict[str, list[str]],
    skipped_handcurated: int,
    auto_written: int,
    total: int,
) -> None:
    auto_count = len(coverage["auto"])
    needs_count = len(coverage["needs_work"])
    hand_count = len(coverage["hand"])
    covered_pct = round(100 * (hand_count + auto_count) / max(total, 1), 1)

    parts: list[str] = []
    parts.append("# Etymological Cluster Coverage")
    parts.append("")
    parts.append(
        "Generated by `etl/auto_cluster.py`. Hand-curated YAMLs are the "
        "etymology-aware ground truth and are never overwritten. "
        "Auto-generated YAMLs use string-similarity clustering and are "
        "approximations — they catch orthographic families (Allemagne ↔ "
        "Alemania) but not etymologically-coherent groups with divergent "
        "spellings (Deutschland ↔ Tyskland)."
    )
    parts.append("")
    parts.append(
        "To hand-curate an auto-generated YAML: edit the file in `etl/roots/`, "
        "remove the `auto_generated: true` line, and re-run "
        "`build_sqlite.py`. The next `auto_cluster.py` run will leave it alone."
    )
    parts.append("")
    parts.append(f"**Summary**: {covered_pct}% covered "
                 f"({hand_count} hand + {auto_count} auto / {total} countries). "
                 f"{needs_count} need manual work.")
    parts.append("")

    parts.append(f"## Hand-curated ({hand_count})")
    parts.append("")
    parts.extend(coverage["hand"] or ["_None yet._"])
    parts.append("")

    parts.append(f"## Auto-generated ({auto_count})")
    parts.append("")
    parts.extend(coverage["auto"] or ["_None._"])
    parts.append("")

    parts.append(f"## Needs manual work ({needs_count})")
    parts.append("")
    parts.append(
        "These countries don't have enough exonyms for string-similarity "
        "clustering to produce a meaningful result. Open the file in "
        "`etl/roots/` to add a hand-curated cluster YAML."
    )
    parts.append("")
    parts.extend(coverage["needs_work"] or ["_None._"])
    parts.append("")

    COVERAGE.write_text("\n".join(parts))


if __name__ == "__main__":
    raise SystemExit(main())
