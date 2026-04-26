# DOC Layout And Rendering

Use this reference when spacing, pagination, tables, or visual polish matter.

## Preferred Path

Convert DOCX to PDF:

```bash
mkdir -p tmp/docs
soffice -env:UserInstallation=file:///tmp/lo_profile_$$ --headless --convert-to pdf --outdir tmp/docs input.docx
```

Then review the PDF directly or render its pages for page-level inspection.

## What To Look For

- Page breaks in the right places
- Table width and clipping
- Heading spacing
- Image placement
- Footer and header consistency
- Signature or form alignment

## When To Prefer Layout Review

- The task asks whether a document "looks right"
- The user cares about printable output
- Tables or forms are important
- Pagination or section breaks matter

## If Conversion Is Unavailable

- Explain that layout conclusions are weaker without conversion.
- Continue with structure-level analysis only if still useful.
