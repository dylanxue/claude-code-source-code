# Document Quality Bar

Use this shared reference for all document-oriented skills: PDF, DOC/DOCX, and spreadsheets.

## Goals

Keep document analysis and document delivery reliable by applying the same reporting and verification rules across file types.

## Shared Output Contract

When reporting results, separate conclusions into two buckets whenever both apply:

- `content extraction conclusions`
  - What the text, tables, formulas, or extracted structure say.
- `layout or visual conclusions`
  - What rendered pages, converted PDFs, workbook structure, or visual inspection show.

Do not blur those two categories together.

## Verification Rules

Before delivering a generated or edited document:

1. Re-open or reload the file with the primary toolchain.
2. Re-sample the most important content.
3. Re-render when layout or page fidelity matters.
4. Clearly note any missing dependency or skipped verification step.

## Scratch Artifact Rules

- Keep temporary outputs in `tmp/...` subdirectories that match the document type.
- Use scratch outputs only as intermediate inspection aids.
- Remove temporary artifacts when done unless the user asks to keep them.

Suggested directories:

- `tmp/pdfs/`
- `tmp/docs/`
- `tmp/spreadsheets/`

## Minimum Final Checklist

- The file opens successfully after edits or generation.
- The reported structure still exists:
  - pages, sections, sheets, tables, headings, formulas, or other key entities
- Important sampled content still looks correct.
- Layout-sensitive output was re-rendered when needed.
- Any uncertainty is explicitly called out.

## When To Warn

Warn the user when:

- the file could not be reopened after editing
- rendering or conversion tools were unavailable
- conclusions rely on OCR or lossy extraction
- workbook formulas were inferred only from cached values
- document layout was not rechecked after a layout-sensitive change
