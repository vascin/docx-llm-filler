"""Parse user-supplied data files into a JSON-serialisable payload for the LLM.

Supported formats, picked by file extension:

* ``.json`` – parsed as-is.
* ``.txt`` / ``.md`` – returned as ``{"text": "<file contents>"}``.
* ``.csv``  – returned as ``{"rows": [{...}, {...}]}`` if a header row is
  detected, otherwise ``{"rows": [["a", "b", ...], ...]}``.
* ``.xlsx`` – returned as ``{"sheets": {"Sheet1": [[...], ...], ...}}``.
* ``.docx`` – returned as ``{"paragraphs": [...], "tables": [[[...]]]}``.
"""

from __future__ import annotations

import csv
import io
import json
from typing import Any

from docx import Document
from openpyxl import load_workbook

SUPPORTED_EXTENSIONS: tuple[str, ...] = (
    ".json",
    ".txt",
    ".md",
    ".csv",
    ".xlsx",
    ".docx",
)


class UnsupportedDataFormat(ValueError):
    """Raised when the data file has an extension we cannot parse."""


def parse_data_file(filename: str, content: bytes) -> Any:
    """Return a JSON-serialisable representation of ``content``.

    ``filename`` is used only to pick a parser by extension.
    """
    if not filename:
        raise UnsupportedDataFormat("File has no name; cannot determine format.")
    name = filename.lower()
    if name.endswith(".json"):
        return _parse_json(content)
    if name.endswith(".txt") or name.endswith(".md"):
        return _parse_text(content)
    if name.endswith(".csv"):
        return _parse_csv(content)
    if name.endswith(".xlsx"):
        return _parse_xlsx(content)
    if name.endswith(".docx"):
        return _parse_docx(content)
    raise UnsupportedDataFormat(
        f"Unsupported data file extension: {filename!r}. "
        f"Supported: {', '.join(SUPPORTED_EXTENSIONS)}."
    )


def _decode_text(content: bytes) -> str:
    """Decode bytes as text, falling back to common Russian encodings."""
    # utf-8-sig handles both BOM-prefixed and plain UTF-8, so it comes first.
    for encoding in ("utf-8-sig", "utf-8", "cp1251", "koi8-r", "latin-1"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="replace")


def _parse_json(content: bytes) -> Any:
    try:
        return json.loads(_decode_text(content))
    except json.JSONDecodeError as exc:
        raise UnsupportedDataFormat(f"Data file is not valid JSON: {exc}") from exc


def _parse_text(content: bytes) -> dict[str, str]:
    return {"text": _decode_text(content)}


def _parse_csv(content: bytes) -> dict[str, Any]:
    text = _decode_text(content)
    # Autodetect delimiter; fall back to comma.
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text), dialect=dialect)
    rows = [row for row in reader if any(cell.strip() for cell in row)]
    if not rows:
        return {"rows": []}

    header = rows[0]
    # Use header-as-keys mode when the header row has unique non-empty values
    # and the rest of the rows have similar length.
    looks_like_header = (
        all(h.strip() for h in header)
        and len(set(h.strip() for h in header)) == len(header)
    )
    if looks_like_header and len(rows) > 1:
        dict_rows: list[dict[str, str]] = []
        for row in rows[1:]:
            padded = row + [""] * max(0, len(header) - len(row))
            dict_rows.append(dict(zip(header, padded[: len(header)], strict=False)))
        return {"rows": dict_rows}
    return {"rows": rows}


def _parse_xlsx(content: bytes) -> dict[str, Any]:
    workbook = load_workbook(io.BytesIO(content), data_only=True, read_only=True)
    sheets: dict[str, list[list[Any]]] = {}
    for sheet in workbook.worksheets:
        rows: list[list[Any]] = []
        for row in sheet.iter_rows(values_only=True):
            cleaned = [_coerce_cell(c) for c in row]
            if any(v != "" for v in cleaned):
                rows.append(cleaned)
        sheets[sheet.title] = rows
    workbook.close()
    return {"sheets": sheets}


def _coerce_cell(value: Any) -> Any:
    if value is None:
        return ""
    if isinstance(value, (str, int, float, bool)):
        return value
    # datetime, timedelta, etc.
    return str(value)


def _parse_docx(content: bytes) -> dict[str, Any]:
    doc = Document(io.BytesIO(content))
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    tables: list[list[list[str]]] = []
    for table in doc.tables:
        rows: list[list[str]] = []
        for row in table.rows:
            rows.append([cell.text.strip() for cell in row.cells])
        tables.append(rows)
    return {"paragraphs": paragraphs, "tables": tables}
