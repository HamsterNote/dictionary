"""Reparse a real TOC cache without dispatch or mutation of collection evidence."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from unittest import mock
from urllib.parse import parse_qs, urlparse

from wiktionary_per_word import EXTRACTOR_VERSION
from wiktionary_per_word.action_api import build_parse_text_url, select_english_section
from wiktionary_per_word.evidence import ResponseCache
from wiktionary_per_word.http_adapter import HttpAdapter


def snapshot(root):
    return {str(p.relative_to(root)): (hashlib.sha256(p.read_bytes()).hexdigest(),
                                     p.stat().st_mtime_ns)
            for p in root.rglob("*") if p.is_file()}


def audit(cache_dir: Path, heads_file: Path) -> dict:
    batch = cache_dir.parent
    before = snapshot(batch)
    heads = heads_file.read_text(encoding="utf-8").splitlines()
    if not heads or len(heads) != len(set(heads)):
        raise ValueError("ordered distinct head list required")
    cache = ResponseCache(cache_dir, read_only=True)
    entries = {}
    for entry in cache.entries():
        query = parse_qs(urlparse(entry.source_url).query)
        if query.get("prop") != ["tocdata"]:
            raise ValueError("audit requires a TOC-only source cache")
        head = query["page"][0]
        if head in entries:
            raise ValueError("ambiguous cached response for head")
        entries[head] = entry
    if set(entries) != set(heads):
        raise ValueError("cache membership differs from ordered head list")
    rows = []
    for head in heads:
        entry = entries[head]
        payload = json.loads(entry.body)
        index, sections = select_english_section(payload)
        if index is None:
            raise ValueError(f"real source has no English hLevel=2: {head}")
        section = next(s for s in sections if s.get("line") == "English" and s.get("hLevel") == 2)
        main_url = build_parse_text_url(head, index)
        rows.append({"head": head, "pageTitle": payload["parse"]["title"],
                     "sectionTitle": section["line"], "hLevel": section["hLevel"],
                     "tocLevel": section.get("tocLevel"), "displayNumber": section.get("number"),
                     "sectionIndex": index, "fromTitle": section.get("fromTitle"),
                     "revision": payload["parse"].get("revid"),
                     "mainUrlFromCachedView": main_url,
                     "mainParametersFromCachedView": {k: v[0] for k, v in parse_qs(urlparse(main_url).query).items()},
                     "sourceUrl": entry.source_url, "fetchedAt": entry.fetched_at,
                     "httpSha256": entry.http_sha256, "provenanceId": entry.provenance_id,
                     "license": entry.license_id, "licenseUrl": entry.license_url,
                     "attribution": entry.attribution})
    if snapshot(batch) != before:
        raise AssertionError("offline audit modified collection evidence")
    return {"mode": "offline-toc-audit", "extractorVersion": EXTRACTOR_VERSION,
            "headsSha256": hashlib.sha256(heads_file.read_bytes()).hexdigest(),
            "headCount": len(heads), "resolvedEnglishSections": len(rows),
            "newRequests": 0, "sourceBatchUnchanged": True,
            "revisionAvailableCount": sum(r["revision"] is not None for r in rows),
            "reuseDecision": "offline evidence only; live MAIN requires fresh TOC under a new grant",
            "mainParameterCaveat": "Cached-view parameters are an audit projection. Fresh authorized TOC must select the current index before MAIN.",
            "words": rows}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", required=True, type=Path)
    parser.add_argument("--heads-file", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    batch = args.cache_dir.resolve().parent
    if args.output.resolve().is_relative_to(batch):
        parser.error("output must be outside the original evidence batch")
    with mock.patch("socket.socket.connect", side_effect=AssertionError("socket forbidden")), \
         mock.patch("socket.socket.connect_ex", side_effect=AssertionError("socket forbidden")), \
         mock.patch("socket.create_connection", side_effect=AssertionError("socket forbidden")), \
         mock.patch.object(HttpAdapter, "fetch", side_effect=AssertionError("dispatch forbidden")) as dispatch:
        result = audit(args.cache_dir, args.heads_file)
        dispatch.assert_not_called()
        result["dispatches"] = dispatch.call_count
        args.output.write_text(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k != "words"}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
