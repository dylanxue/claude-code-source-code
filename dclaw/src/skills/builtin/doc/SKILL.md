---
name: doc
description: Use when the task involves reading, editing, converting, or creating `.doc` or `.docx` files, especially when structure, formatting, tables, or pagination matter.
context: inline
---

# DOC Skill

Use this skill for Word documents when you need more than a plain text dump, especially for `.docx` files with headings, tables, lists, comments, or page-sensitive layout.

## When To Use

- Read or summarize `.docx` content while preserving document structure.
- Inspect tables, lists, headings, and other structured content.
- Review layout-sensitive documents where page breaks, spacing, or rendering quality matter.
- Edit or generate `.docx` files and then verify they still open and render correctly.
- Diagnose broken or suspicious `.docx` / `.doc` files, conversion failures, or OOXML issues.

## Routing

1. Classify the file first.
   - `.docx`: preferred structured path
   - `.doc`: legacy conversion-first path
2. Decide whether the task is structure-first or layout-first.
   - For semantic or structural review, use `python-docx` first.
   - For layout-sensitive review, convert to PDF and inspect rendered pages.
3. Keep legacy `.doc` handling explicit.
   - Prefer converting `.doc` to `.docx` or PDF before deeper analysis when practical.
4. Use OOXML fallback only when higher-level tools are unavailable.
   - Inspect `word/document.xml` and related package files with `unzip`.
5. Reopen and re-render after meaningful edits.

## Default Workflow

### 1. Acquire The File

- Use `Read` for local files.
- Use `WebFetch` only if the document is downloaded from a remote source and then handled locally.
- Keep the original path or URL visible in the analysis.

### 2. Classify The Task

- `structure_review`: headings, paragraphs, tables, lists, document sections
- `layout_review`: pagination, spacing, table rendering, visual polish
- `edit_or_generate`: patch content, generate a new DOCX, or transform structure
- `diagnostics`: broken opens, failed conversions, malformed OOXML, missing styles

### 3. Choose The Execution Path

- `structure_review`
  - Prefer `python-docx`
  - Use the helper script for a quick summary of paragraphs and tables
- `layout_review`
  - Convert DOCX to PDF with `soffice`
  - Render PDF pages if page-level visual review is needed
- `edit_or_generate`
  - Preserve structure unless the user explicitly asks for flattening or normalization
  - Reopen the `.docx` after saving and re-render if layout matters
- `diagnostics`
  - Check whether the file opens with `python-docx`
  - Fall back to OOXML inspection with `unzip`
  - For `.doc`, try conversion first and explain any tooling limitations

### 4. Keep Scratch Outputs Tidy

- Use `tmp/docs/` for temporary conversions, PDFs, rendered pages, or extracted summaries.
- Remove scratch outputs when done unless the user asks to keep them.

## Preferred Tools

- `Read` for local files and nearby derived artifacts.
- `Bash` for conversion, inspection, Python-based edits, and validation.
- `Skill` stays in the current conversation and should guide the workflow rather than replace the underlying tools.

## References In This Skill Folder

Use these from the skill directory when you need deeper guidance:

- `../references/document-quality-bar.md`
  For the shared delivery bar, scratch-artifact rules, and final verification checklist used across document skills.
- `references/structure-and-extraction.md`
  For paragraph, heading, table, and list extraction workflows.
- `references/layout-and-rendering.md`
  For DOCX -> PDF conversion, rendered review, and layout QA.
- `references/edit-and-qa.md`
  For document edits, generation paths, reopen checks, and delivery QA.

## Bundled Helper

If Python DOCX tooling is available, you can use:

- `scripts/inspect_docx.py`

It prints paragraph counts, sample paragraphs, and table summaries for a `.docx` file.

Example:

```bash
python3 src/skills/builtin/doc/scripts/inspect_docx.py /path/to/file.docx --paragraphs 8
```

## Helpful Commands

Convert DOCX to PDF for layout review:

```bash
mkdir -p tmp/docs
soffice -env:UserInstallation=file:///tmp/lo_profile_$$ --headless --convert-to pdf --outdir tmp/docs input.docx
```

Fallback OOXML inspection:

```bash
unzip -p input.docx word/document.xml | head -200
```

## Dependencies

Prefer `uv` when available.

Python packages:

```bash
uv pip install python-docx
```

Fallback:

```bash
python3 -m pip install python-docx
```

System tools for conversion and rendering:

```bash
# macOS
brew install libreoffice poppler

# Ubuntu / Debian
sudo apt-get install -y libreoffice poppler-utils
```

If a dependency is missing, say exactly which one is missing and how it affects confidence.

## Quality Bar

- Distinguish extracted text conclusions from verified layout conclusions.
- Mention tables, lists, headings, and other structure when relevant.
- For `.doc` files, explicitly state whether you analyzed the original file directly or via conversion.
- If you had to rely on XML inspection or plain-text extraction, note the formatting risk.
- Follow the shared document quality reference at `../references/document-quality-bar.md`.
- Before delivering edits or generated files, verify:
  - the document still opens
  - headings and tables remain present
  - spacing and page breaks still look plausible
  - layout-sensitive sections render correctly after conversion when needed

## Final Reminder

For DOCX, structure first and layout second.
For legacy DOC, conversion is often the safest path before making strong claims.
