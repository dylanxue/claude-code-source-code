# PDF Extract And Compare

Use this reference for text-oriented work: summarization, section lookup, quote validation, or comparing revisions.

## Extraction Priorities

1. `pypdf`
   Good for broad extraction and metadata.
2. `pdfplumber`
   Often better for page-by-page extraction and some table-heavy documents.
3. `pdftotext`
   Useful when a system utility is already available.

## Quick Metadata And Text Checks

With the bundled helper:

```bash
python3 src/skills/builtin/pdf/scripts/inspect_pdf.py input.pdf --pages 1,2
```

With `pypdf` directly:

```bash
python3 - <<'PY'
from pypdf import PdfReader
reader = PdfReader("input.pdf")
print("pages:", len(reader.pages))
for i, page in enumerate(reader.pages[:2], start=1):
    print(f"--- page {i} ---")
    print(page.extract_text() or "")
PY
```

## Comparison Workflow

- Extract relevant page ranges or sections from each PDF.
- Normalize obvious whitespace noise before diffing.
- Keep page numbers visible in the comparison output.
- If visual changes matter, pair the text diff with rendered-page review.

## Scanned PDFs

- If extracted text is empty or clearly degraded, assume the PDF is scanned or image-heavy.
- Render pages first.
- If OCR is required, note that OCR output may contain transcription errors and layout loss.

## Confidence Notes

State which path you used:

- native `pdfInput`
- `pypdf`
- `pdfplumber`
- rendered pages
- OCR

That helps separate strong conclusions from weaker ones.
