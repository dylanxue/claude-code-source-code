# Formulas And Sampling

Use this reference for row-level inspection, formula review, and representative sampling.

## Header And Sample Workflow

1. Confirm the target sheet.
2. Inspect the first few non-empty rows.
3. Identify likely headers before summarizing data.
4. Sample a small number of representative rows instead of dumping the whole sheet.

## Formula Awareness

Use `openpyxl` with:

- `data_only=False` to inspect formulas
- `data_only=True` to inspect cached values

Compare both views when the task depends on formulas.

Example:

```bash
python3 - <<'PY'
from openpyxl import load_workbook
wb_formula = load_workbook("input.xlsx", data_only=False)
wb_values = load_workbook("input.xlsx", data_only=True)
ws_formula = wb_formula[wb_formula.sheetnames[0]]
ws_values = wb_values[wb_values.sheetnames[0]]
for row_formula, row_values in zip(
    ws_formula.iter_rows(min_row=1, max_row=5, values_only=True),
    ws_values.iter_rows(min_row=1, max_row=5, values_only=True),
):
    print("formula:", row_formula)
    print("values :", row_values)
PY
```

## CSV / TSV Handling

- Confirm delimiter and encoding first.
- Preserve headers.
- Treat CSVs as flat tables, not workbooks.
- Use `pandas` or `csv` depending on whether you need lightweight inspection or richer analysis.

## Confidence Notes

State whether your conclusions came from:

- formulas
- cached values
- row samples
- CSV export
- converted workbook data
