---
name: spreadsheet
description: Use when the task involves reading, analyzing, editing, or creating spreadsheet files such as `.xlsx`, `.xls`, `.csv`, or `.tsv`, especially when workbook structure, formulas, or tabular integrity matter.
context: inline
---

# Spreadsheet Skill

Use this skill for spreadsheet-style data when you need workbook-aware inspection, formula-aware analysis, tabular edits, or a safer validation workflow than plain text scraping.

## When To Use

- Read `.xlsx` or `.xls` files where sheet structure matters.
- Review spreadsheets with formulas, hidden sheets, merged cells, or multiple tabs.
- Analyze CSV or TSV files while preserving delimiter and header semantics.
- Edit or generate workbook outputs and then verify that the workbook still reopens cleanly.

## Routing

1. Classify the input format before doing anything else.
   - `csv` / `tsv`: flat table path
   - `xlsx`: workbook path
   - `xls`: legacy workbook path, often better after conversion
2. Start with structure before content.
   - List sheets, dimensions, headers, hidden sheets, and obvious merged ranges.
   - Only then move into sampling, formulas, or editing.
3. Keep formula handling explicit.
   - Say whether you are reading formulas (`data_only=False`) or computed values (`data_only=True`).
   - Do not mix those two views without saying so.
4. Use conversion only when it improves review.
   - Export selected sheets to CSV for quick diffing.
   - Convert to PDF or images only if layout or presentation quality matters.
5. Reopen the workbook after edits or generation.

## Default Workflow

### 1. Acquire The File

- Use `Read` for local files.
- Use `WebFetch` only for remote tabular sources that are already accessible as files or text.
- Keep the original path or URL visible in the analysis.

### 2. Classify The Task

- `workbook_overview`: sheet list, dimensions, hidden sheets, headers
- `tabular_analysis`: summaries, filtering, aggregates, comparisons
- `formula_review`: inspect formulas, dependencies, and formula/value differences
- `edit_or_generate`: create, normalize, patch, export, or rewrite workbook content
- `diagnostics`: debug load failures, broken formulas, missing headers, bad encoding, or structural anomalies

### 3. Choose The Execution Path

- `workbook_overview`
  - Prefer `openpyxl` for `.xlsx`
  - Use the helper script for a quick workbook summary
- `tabular_analysis`
  - Use `pandas` for summaries, grouping, filtering, and CSV exports
  - Sample rows after confirming headers and sheet structure
- `formula_review`
  - Inspect both formulas and values when needed
  - Call out hidden sheets, merged cells, and suspicious blank regions
- `edit_or_generate`
  - Preserve workbook structure unless the user explicitly requests normalization
  - Reopen and resample after saving
- `diagnostics`
  - Check file format, sheet names, dimensions, and load errors first
  - Convert or export only if that makes the problem easier to isolate

### 4. Keep Scratch Outputs Tidy

- Use `tmp/spreadsheets/` for temporary exports, CSV conversions, and diagnostic artifacts.
- Remove scratch outputs when done unless the user wants to keep them.

## Preferred Tools

- `Read` for local CSVs or nearby derived text outputs.
- `WebFetch` for remote tabular sources when they are already text-based or downloadable.
- `Bash` for Python-based inspection, conversion, editing, and validation.

## References In This Skill Folder

Use these from the skill directory when you need deeper guidance:

- `../references/document-quality-bar.md`
  For the shared delivery bar, scratch-artifact rules, and final verification checklist used across document skills.
- `references/workbook-overview.md`
  For sheet listing, dimension checks, hidden sheet discovery, and quick structure review.
- `references/formulas-and-sampling.md`
  For header checks, representative row samples, formula/value inspection, and CSV/TSV handling.
- `references/edit-and-qa.md`
  For workbook edits, exports, generation paths, and final QA.

## Bundled Helper

If Python spreadsheet tooling is available, you can use:

- `scripts/inspect_workbook.py`

It prints workbook structure, sheet dimensions, hidden status, optional formulas, and sample rows.

Example:

```bash
python3 src/skills/builtin/spreadsheet/scripts/inspect_workbook.py /path/to/file.xlsx --sheet Sheet1 --samples 5
```

## Dependencies

Prefer `uv` when available.

Python packages:

```bash
uv pip install openpyxl pandas
```

Fallback:

```bash
python3 -m pip install openpyxl pandas
```

Optional helpers:

```bash
# macOS
brew install xlsx2csv

# Ubuntu / Debian
sudo apt-get install -y xlsx2csv
```

If a dependency is missing, say exactly which one is missing and how it affects confidence.

## Quality Bar

- Start with workbook structure before making claims about data.
- Include sheet names and clearly label which sheets were actually inspected.
- Distinguish formulas from displayed or computed values when that matters.
- Call out hidden sheets, merged cells, suspicious blanks, encoding issues, or type surprises.
- Follow the shared document quality reference at `../references/document-quality-bar.md`.
- Before delivering workbook edits or generated files, verify:
  - the workbook reopens cleanly
  - expected sheets still exist
  - headers are preserved
  - formulas remain present where expected
  - representative rows still look correct

## Final Reminder

Flat text extraction is not enough for workbook tasks.
For `.xlsx` or `.xls`, structure first, samples second, edits last, and always reopen after saving.
