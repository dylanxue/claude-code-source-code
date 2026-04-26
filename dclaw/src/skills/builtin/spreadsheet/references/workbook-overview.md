# Workbook Overview

Use this reference when you first open a spreadsheet and need to understand workbook structure before deeper analysis.

## Goals

- List sheet names.
- Identify hidden sheets.
- Check row and column counts.
- Inspect likely headers before running any analysis.

## Preferred Path

For `.xlsx`, prefer `openpyxl`:

```bash
python3 - <<'PY'
from openpyxl import load_workbook
wb = load_workbook("input.xlsx", data_only=False)
for ws in wb.worksheets:
    print(ws.title, ws.sheet_state, ws.max_row, ws.max_column)
PY
```

## What To Record

- Workbook file type
- Sheet names
- Hidden / visible sheet status
- Dimensions for each relevant sheet
- Whether the first rows look like headers, titles, or blank padding

## For Legacy `.xls`

- Prefer conversion to `.xlsx` or CSV when native parsing is limited in the environment.
- If conversion is used, say so explicitly.

## If Load Fails

- Confirm the file extension matches the real file format.
- Note whether the failure is likely corruption, encryption, or unsupported format.
- If needed, fall back to CSV export or alternative conversion tools before proceeding.
