#!/usr/bin/env python3
"""Quick PDF inspection helper for the builtin pdf skill.

Prints page count, basic metadata, and optionally sampled page text.
Requires `pypdf`.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def parse_pages(raw: str | None) -> list[int] | None:
    if raw is None:
        return None

    pages: list[int] = []
    for part in raw.split(","):
        item = part.strip()
        if not item:
            continue
        value = int(item)
        if value < 1:
            raise ValueError("page numbers must be >= 1")
        pages.append(value)
    return pages or None


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect a PDF with pypdf.")
    parser.add_argument("pdf_path", help="Path to the PDF file")
    parser.add_argument(
        "--pages",
        help="Comma-separated 1-based page numbers to sample, e.g. 1,2,5",
    )
    parser.add_argument(
        "--max-chars",
        type=int,
        default=1500,
        help="Maximum characters to print per sampled page",
    )
    args = parser.parse_args()

    pdf_path = Path(args.pdf_path)
    if not pdf_path.is_file():
        print(f"error: file not found: {pdf_path}", file=sys.stderr)
        return 1

    try:
        from pypdf import PdfReader
    except ImportError:
        print(
            "error: pypdf is not installed. Install with `uv pip install pypdf` "
            "or `python3 -m pip install pypdf`.",
            file=sys.stderr,
        )
        return 2

    try:
        reader = PdfReader(str(pdf_path))
    except Exception as exc:  # pragma: no cover - defensive runtime wrapper
        print(f"error: failed to open PDF: {exc}", file=sys.stderr)
        return 3

    print(f"path: {pdf_path}")
    print(f"pages: {len(reader.pages)}")

    metadata = reader.metadata or {}
    if metadata:
        print("metadata:")
        for key in sorted(metadata):
            value = metadata.get(key)
            if value is None:
                continue
            print(f"  {key}: {value}")

    selected_pages = parse_pages(args.pages)
    if not selected_pages:
        return 0

    print("sampled_text:")
    for page_number in selected_pages:
        if page_number > len(reader.pages):
            print(f"  - page {page_number}: out of range")
            continue

        page = reader.pages[page_number - 1]
        text = (page.extract_text() or "").strip()
        if len(text) > args.max_chars:
            text = text[: args.max_chars].rstrip() + "..."

        print(f"--- page {page_number} ---")
        print(text or "<no extracted text>")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
