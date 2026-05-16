"""One-shot preprocessor: walks a local clone of factbook/factbook.json and
extracts just the Languages section per country into a single committed file.

Run this manually after refreshing the local Factbook clone. The output is
checked in so CI and other contributors don't need to clone factbook.json
themselves (it's ~5MB of mostly-noise we don't need).

Source: https://github.com/factbook/factbook.json (CC0). Pin the commit hash
in the output file's `_source_commit` field for reproducibility.

Usage:
    git clone --depth 1 https://github.com/factbook/factbook.json.git /tmp/factbook
    cd /tmp/factbook && git rev-parse HEAD
    cd <etl/>
    uv run python extract_factbook.py --source /tmp/factbook --commit <hash>
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

OUTPUT = Path(__file__).parent / "data" / "factbook_languages.json"


def extract_languages_text(country_doc: dict) -> str | None:
    """Pull the language-data prose from a Factbook country JSON.

    The Factbook schema isn't uniform. Most countries have:
        People and Society > Languages > Languages > text
    A subset (mainly the ones without "major-language sample(s)" or "note"
    siblings) collapse to:
        People and Society > Languages > text
    Try both shapes.
    """
    section = country_doc.get("People and Society", {}).get("Languages", {})
    if not isinstance(section, dict):
        return None
    # Shape 1: flat
    if "text" in section and isinstance(section["text"], str):
        return section["text"]
    # Shape 2: nested under another "Languages"
    nested = section.get("Languages", {})
    if isinstance(nested, dict) and isinstance(nested.get("text"), str):
        return nested["text"]
    return None


def extract_country_name(country_doc: dict) -> str | None:
    """Pull the conventional short-form country name."""
    gov = country_doc.get("Government", {}).get("Country name", {})
    if not isinstance(gov, dict):
        return None
    short = gov.get("conventional short form", {})
    if isinstance(short, dict) and isinstance(short.get("text"), str):
        return short["text"]
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source", required=True, help="path to local factbook.json clone")
    ap.add_argument("--commit", default=None, help="upstream commit hash for provenance")
    args = ap.parse_args()

    source = Path(args.source)
    if not source.exists():
        print(f"ERROR: source path {source} does not exist")
        return 1

    entries = []
    for json_path in sorted(source.rglob("*.json")):
        # Skip meta/, package.json, etc — only continent subdirs hold country files
        if json_path.parent == source or json_path.parent.name == "meta":
            continue
        try:
            doc = json.loads(json_path.read_text())
        except json.JSONDecodeError:
            print(f"  skip {json_path}: bad JSON")
            continue
        name = extract_country_name(doc)
        text = extract_languages_text(doc)
        if not name and not text:
            continue
        entries.append({
            "cia_code": json_path.stem,
            "continent": json_path.parent.name,
            "country_name": name,
            "languages_text": text,
        })

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "_source": "https://github.com/factbook/factbook.json",
        "_source_commit": args.commit,
        "_license": "CC0 (public domain — derived from CIA World Factbook)",
        "entries": entries,
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2))

    with_text = sum(1 for e in entries if e["languages_text"])
    with_name = sum(1 for e in entries if e["country_name"])
    print(f"extracted {len(entries)} entries → {OUTPUT}")
    print(f"  with country_name: {with_name}")
    print(f"  with languages_text: {with_text}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
