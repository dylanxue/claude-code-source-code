# DOC Edit And QA

Use this reference when editing, generating, or transforming Word documents.

## Edit Workflow

1. Inspect document structure first.
2. Make the smallest meaningful change.
3. Save the result.
4. Re-open it with `python-docx`.
5. If layout matters, convert to PDF and inspect the result.

## Generation Workflow

- Prefer generating `.docx` with `python-docx`.
- Keep headings, tables, and list structure explicit.
- Avoid flattening everything into plain paragraphs when the document structure matters.

## Reopen Check

```bash
python3 - <<'PY'
from docx import Document
doc = Document("output.docx")
print("paragraphs:", len(doc.paragraphs))
print("tables:", len(doc.tables))
PY
```

## QA Checklist

- File opens successfully
- Expected headings still exist
- Tables remain readable
- Lists still render correctly
- Conversion to PDF succeeds if layout-sensitive output is required

## When To Warn

- You edited the document but did not reopen it
- You relied on OOXML/XML inspection instead of a normal DOCX load
- The file is legacy `.doc` and tooling support is limited
