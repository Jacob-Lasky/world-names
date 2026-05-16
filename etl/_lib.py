"""Shared SPARQL + cache helpers for the world-names ETL pipeline.

Every stage in `etl/` follows the same shape: run a SPARQL query against
Wikidata, parse each binding into a flat dict, dedupe + sort by primary key,
write JSONL to `etl/cache/<stage>.jsonl`. This module owns that flow so the
per-stage scripts only need to specify the query, the parser, and the PK.

Reads are idempotent: if the cache exists, we return parsed rows without
hitting Wikidata. Pass `--force` (handled by callers) to bypass.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Callable

import httpx

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
