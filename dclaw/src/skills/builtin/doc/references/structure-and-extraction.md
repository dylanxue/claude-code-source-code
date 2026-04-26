# DOC Structure And Extraction

Use this reference when the task is mainly about semantic content, headings, paragraphs, tables, or lists.

## Preferred Path

For `.docx`, prefer `python-docx`:

```bash
python3 - <<'PY'
from docx import Document
doc = Document("input.docx")
print("paragraphs:", len(doc.paragraphs))
print("tables:", len(doc.tables))
for paragraph in doc.paragraphs[:10]:
    print(paragraph.text)
PY
```

## What To Record

- Number of paragraphs and tables
- Whether heading-like structure is visible
- Whether tables contain meaningful content
- Whether comments, footnotes, or special structure appear to matter

## OOXML Fallback

If `python-docx` is unavailable or the file is suspicious:

```bash
unzip -p input.docx word/document.xml | head -200
```

You can also inspect:

- `word/styles.xml`
- `word/comments.xml`
- `word/numbering.xml`

Use this path carefully and say that formatting confidence is lower.
