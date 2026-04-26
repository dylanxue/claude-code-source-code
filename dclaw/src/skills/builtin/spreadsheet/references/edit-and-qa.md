# Spreadsheet Edit And QA

Use this reference for workbook edits, generated spreadsheets, exports, and final checks.

## Edit Workflow

1. Inspect workbook structure first.
2. Make the smallest possible change.
3. Save the workbook.
4. Re-open it immediately.
5. Re-check target sheets, headers, formulas, and representative rows.

## Export Workflow

- Export selected sheets to CSV for easier diffs when appropriate.
- Keep exported artifacts in `tmp/spreadsheets/`.
- If presentation layout matters, convert to PDF or images with local tools and review the result.

## Common QA Checklist

- Workbook opens without error
- Expected sheet names still exist
- Sheet dimensions still look plausible
- Headers are preserved
- Formulas remain present where expected
- Representative rows still match the intended structure
- Hidden sheets were not unintentionally dropped

## Example Save And Reopen Check

```bash
python3 - <<'PY'
from openpyxl import load_workbook
path = "output.xlsx"
wb = load_workbook(path, data_only=False)
print("sheets:", wb.sheetnames)
for ws in wb.worksheets:
    print(ws.title, ws.max_row, ws.max_column)
PY
```

## When To Warn

- If you edited a workbook but did not reopen it
- If formulas were replaced by literal values unintentionally
- If merged cells or hidden sheets may have been disturbed
- If CSV export was used and workbook-only features were lost
