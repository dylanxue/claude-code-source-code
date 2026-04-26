# PDF Create And Edit

Use this reference when the task is to generate a new PDF, patch an existing one, merge/split pages, or deliver a polished final artifact.

## Common Tooling

- `reportlab` for creating PDFs with controlled layout
- `pypdf` for merge, split, rotate, reorder, or simple page-level edits
- `pdfplumber` for extraction and sanity checks, not final layout authority

## Generation Workflow

1. Create or edit the PDF with Python tools.
2. Re-open the output to catch corruption early.
3. Render pages if presentation quality matters.
4. Verify page count, order, spacing, and legibility before final delivery.

## Simple Merge Example

```bash
python3 - <<'PY'
from pypdf import PdfMerger
merger = PdfMerger()
for path in ["a.pdf", "b.pdf"]:
    merger.append(path)
with open("merged.pdf", "wb") as f:
    merger.write(f)
PY
```

## Simple Split Example

```bash
python3 - <<'PY'
from pypdf import PdfReader, PdfWriter
reader = PdfReader("input.pdf")
for i, page in enumerate(reader.pages, start=1):
    writer = PdfWriter()
    writer.add_page(page)
    with open(f"page-{i}.pdf", "wb") as f:
        writer.write(f)
PY
```

## Final QA Checklist

- The file opens successfully.
- Page count matches expectation.
- Tables and charts remain readable.
- Headers, footers, and page numbers are correct.
- Text is not clipped or overlapping.
- Any merge, split, or reorder operation produced the intended sequence.
