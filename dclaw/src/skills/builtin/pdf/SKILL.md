---
name: pdf
description: Use when the task involves reading, reviewing, creating, or debugging PDF files and page layout or rendering fidelity matters; prefer rendered page review when layout is important and use Python tools for extraction or generation.
context: inline
---

# PDF Skill

Use this skill for `.pdf` work when direct PDF input is unavailable, when page layout matters, or when the task needs a repeatable extraction, rendering, editing, or QA workflow.

## When To Use

- Read or review PDFs where layout, pagination, tables, charts, or diagrams matter.
- Extract text from PDFs while clearly separating text-level findings from visual/layout findings.
- Create or edit PDFs with programmatic tools and then verify the rendered result.
- Diagnose PDF issues such as clipping, unreadable glyphs, broken tables, or unexpected page structure.

## Routing

1. Start with the native PDF path when it is good enough.
   - If `Read` or `WebFetch` already attached the PDF and the active runtime supports `pdfInput`, use the native PDF path first for semantic understanding.
   - If the task is mainly "summarize / answer questions / locate sections", native PDF input is often the fastest path.
2. Switch to rendered-page review when layout matters.
   - If the task involves formatting, diagrams, page order, headers/footers, signatures, charts, tables, or visual defects, render pages and inspect them.
3. Use text extraction only for text-level claims.
   - Prefer extraction for quotations, section finding, keyword search, and rough content summaries.
   - Do not treat extracted text alone as proof of layout fidelity.
4. Treat scanned PDFs as image-heavy documents.
   - Render pages first.
   - Use OCR only when needed, and explicitly call out confidence limits.
5. For generated or edited PDFs, always re-open or re-render before final delivery.

## Default Workflow

### 1. Acquire The PDF

- Use `Read` for local PDFs.
- Use `WebFetch` for remote PDFs.
- Keep the original file path or URL visible in the analysis.

### 2. Classify The Task

- `semantic_read`: summarize, answer questions, find sections, compare wording
- `visual_review`: inspect layout, diagrams, tables, forms, signatures, pagination
- `generation_or_edit`: create, merge, split, stamp, fill, or rewrite a PDF
- `diagnostics`: debug broken rendering, extraction issues, or page anomalies

### 3. Choose The Execution Path

- `semantic_read`
  - Prefer native `pdfInput` if available.
  - Otherwise extract text with `pypdf`, `pdfplumber`, or `pdftotext`.
- `visual_review`
  - Render pages with `pdftoppm`.
  - Inspect page images before drawing layout conclusions.
- `generation_or_edit`
  - Prefer Python tools such as `reportlab`, `pypdf`, and `pdfplumber`.
  - Re-render or reopen after every meaningful change.
- `diagnostics`
  - Inspect metadata, page count, extraction quality, and rendered pages.
  - Use the helper script or the references below to guide the check.

### 4. Keep Scratch Outputs Tidy

- Use `tmp/pdfs/` for temporary page renders, extracted text, or intermediate outputs.
- Remove scratch artifacts when done unless the user asks to keep them.

## Preferred Tools

- `Read` for local PDF files and nearby derived outputs.
- `WebFetch` for remote PDFs.
- `Bash` for rendering, extraction, OCR, conversion, generation, and validation.

## References In This Skill Folder

Use these from the skill directory when you need deeper guidance:

- `../references/document-quality-bar.md`
  For the shared delivery bar, scratch-artifact rules, and final verification checklist used across document skills.
- `references/render-and-review.md`
  For page rendering, visual review, and layout-sensitive checks.
- `references/extract-and-compare.md`
  For text extraction, page sampling, scanned-PDF handling, and diff workflows.
- `references/create-and-edit.md`
  For generation, edits, merge/split operations, and final QA.

## Bundled Helper

If Python PDF tooling is available, you can use:

- `scripts/inspect_pdf.py`

It prints page count, metadata, and optionally sampled page text to help with quick diagnosis.

Example:

```bash
python3 src/skills/builtin/pdf/scripts/inspect_pdf.py /path/to/file.pdf --pages 1,2
```

## Dependencies

Prefer `uv` when available.

Python packages:

```bash
uv pip install pypdf pdfplumber reportlab
```

Fallback:

```bash
python3 -m pip install pypdf pdfplumber reportlab
```

System tools for rendering:

```bash
# macOS
brew install poppler

# Ubuntu / Debian
sudo apt-get install -y poppler-utils
```

Optional OCR path when needed:

```bash
# macOS
brew install tesseract

# Ubuntu / Debian
sudo apt-get install -y tesseract-ocr
```

If a dependency is missing, say exactly which one is missing and how it affects confidence.

## Quality Bar

- Separate "content extraction" conclusions from "visual/layout" conclusions.
- Mention which pages were actually inspected.
- For generated or edited PDFs, do not stop at file creation; reopen or re-render and verify the result.
- Call out uncertainty when OCR, extraction, or rendering tools are unavailable.
- Follow the shared document quality reference at `../references/document-quality-bar.md`.
- Before final delivery, verify:
  - page count
  - section order
  - table/chart legibility
  - header/footer correctness
  - alignment and clipping
  - readable text and glyphs

## Final Reminder

If the task only needs semantic understanding and native `pdfInput` is available, keep the path simple.
If the task depends on layout fidelity, rendering wins over plain text extraction.
