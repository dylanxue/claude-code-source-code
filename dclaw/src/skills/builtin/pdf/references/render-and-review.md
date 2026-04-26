# PDF Render And Review

Use this reference when layout, tables, forms, diagrams, signatures, or visual fidelity matter more than plain text extraction.

## Goals

- Confirm page count and order.
- Inspect margins, alignment, clipping, headers, footers, and spacing.
- Check whether tables, charts, or diagrams remain legible after edits or conversion.

## Primary Path

Render pages with Poppler:

```bash
mkdir -p tmp/pdfs
pdftoppm -png input.pdf tmp/pdfs/page
```

This yields files such as:

- `tmp/pdfs/page-1.png`
- `tmp/pdfs/page-2.png`

Then use `Read` on selected rendered pages when you need model-visible page inspection.

## What To Look For

- Clipped text or overlapping elements
- Cropped charts or tables
- Broken page order
- Unreadable small text
- Misaligned headers, footers, or page numbers
- Signatures or form fields placed on the wrong page

## When To Prefer Rendering Over Text Extraction

- The user asks whether a PDF "looks right"
- The task mentions page layout, formatting, visual QA, forms, or presentation quality
- The document is scanned, image-heavy, or contains diagrams and tables

## If Rendering Is Unavailable

- Explain that layout conclusions are weaker without rendered pages.
- Fall back to text extraction only for semantic claims.
- If needed, ask the user to install Poppler or review pages locally.
