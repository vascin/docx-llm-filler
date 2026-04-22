"""Fill a .docx template using an LLM and a JSON data source.

Two modes are supported:

* **Placeholder mode** (default when at least one ``{{name}}``, ``{name}`` or
  ``[name]`` marker is found in the document): the LLM is asked for a
  ``{placeholder: value}`` mapping, then placeholders are substituted in place.
* **Free-form mode** (when no placeholders are detected): the document is
  serialised as a numbered list of paragraphs and the LLM is asked to return
  edited versions of the paragraphs that should be filled in, using the JSON
  data as ground truth. Paragraphs the LLM does not touch are kept intact.

The module only deals with text content (paragraphs + table cell paragraphs);
images, headers, footers, and other structures are left untouched.
"""

from __future__ import annotations

import io
import json
import re
from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from docx import Document
from docx.document import Document as DocxDocument
from docx.oxml.ns import qn
from docx.table import _Cell
from docx.text.paragraph import Paragraph
from lxml import etree

from .gemini_client import LLMClient


@dataclass
class _Slot:
    """A fillable location in the document with a stable integer id."""

    id: int
    kind: str  # "paragraph" or "cell"
    text: str
    paragraph: Paragraph | None = None
    cell: _Cell | None = None

# Matches {{name}}, {name} (single braces), or [name]. ``name`` is captured
# without the surrounding delimiters.
_PLACEHOLDER_RE = re.compile(
    r"""
    (?P<full>
        \{\{\s*(?P<double>[^{}]+?)\s*\}\}      # {{ name }}
        |
        (?<!\{)\{\s*(?P<single>[^{}\n]+?)\s*\}(?!\})   # { name } (not {{ }})
        |
        \[\s*(?P<bracket>[^\[\]\n]+?)\s*\]     # [ name ]
    )
    """,
    re.VERBOSE,
)


@dataclass
class FillResult:
    """Outcome of a document fill operation."""

    content: bytes
    mode: str  # "placeholder" or "freeform"
    filled_placeholders: dict[str, str]
    changed_paragraphs: int


def _iter_paragraphs(doc: DocxDocument):
    """Yield every ``Paragraph`` in the document, including inside tables."""
    yield from doc.paragraphs
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                yield from _iter_cell_paragraphs(cell)


def _iter_cell_paragraphs(cell: _Cell):
    yield from cell.paragraphs
    for table in cell.tables:
        for row in table.rows:
            for sub_cell in row.cells:
                yield from _iter_cell_paragraphs(sub_cell)


def _paragraph_text(paragraph: Paragraph) -> str:
    return "".join(run.text for run in paragraph.runs) or paragraph.text


def _cell_text(cell: _Cell) -> str:
    """Return the cell's text content joined across its paragraphs."""
    return "\n".join(_paragraph_text(p) for p in cell.paragraphs).strip()


_W_R = qn("w:r")
_W_T = qn("w:t")
_W_P = qn("w:p")
_W_PPR = qn("w:pPr")
_W_RPR = qn("w:rPr")
_XML_SPACE = qn("xml:space")


def _write_text_into_run(run_el: etree._Element, new_text: str) -> None:
    """Replace the text content of a run element with ``new_text``.

    The run's ``rPr`` (formatting) is left untouched. Any existing ``w:t``
    children are removed; a single new ``w:t`` is appended (with
    ``xml:space="preserve"`` so leading/trailing spaces survive).
    """
    for child in list(run_el):
        if child.tag == _W_T:
            run_el.remove(child)
    t_el = etree.SubElement(run_el, _W_T)
    t_el.set(_XML_SPACE, "preserve")
    t_el.text = new_text


def _clear_run_text(run_el: etree._Element) -> None:
    """Remove text nodes (``<w:t>``, ``<w:br>``, ``<w:tab>``) from a run."""
    for child in list(run_el):
        if child.tag in (_W_T, qn("w:br"), qn("w:tab")):
            run_el.remove(child)


def _set_paragraph_text(paragraph: Paragraph, new_text: str) -> None:
    """Put ``new_text`` in the first run of the paragraph, untouched elsewhere.

    We deliberately keep the paragraph's existing runs in place so that any
    surrounding formatting, tab stops, hyperlinks, bookmarks or whitespace
    stays intact. Only the first run gets its text rewritten; any other runs
    in the same paragraph are cleared of their own text content but kept as
    XML nodes (they often carry trailing spaces or vertical-space holders
    used by the template to preserve layout).
    """
    p_el = paragraph._element
    runs = p_el.findall(_W_R)
    if runs:
        _write_text_into_run(runs[0], new_text)
        for extra in runs[1:]:
            _clear_run_text(extra)
        return

    ppr = p_el.find(_W_PPR)
    rpr_template = ppr.find(_W_RPR) if ppr is not None else None
    new_r = etree.SubElement(p_el, _W_R)
    if rpr_template is not None:
        new_r.insert(0, deepcopy(rpr_template))
    _write_text_into_run(new_r, new_text)


def _find_style_donor_rpr(cell: _Cell) -> etree._Element | None:
    """Return an ``<w:rPr>`` to use as a formatting donor for an empty cell.

    We look in order at:
    1. Any run inside the same cell (empty runs often carry the correct rPr).
    2. ``<w:rPr>`` nested in any paragraph's ``<w:pPr>`` inside the cell.
    3. Any run inside a sibling cell of the same row.
    4. ``<w:pPr>/<w:rPr>`` of any paragraph in a sibling cell.
    """
    tc = cell._tc
    for r in tc.iter(_W_R):
        rpr = r.find(_W_RPR)
        if rpr is not None:
            return rpr
    for p in tc.iter(_W_P):
        ppr = p.find(_W_PPR)
        if ppr is not None:
            rpr = ppr.find(_W_RPR)
            if rpr is not None:
                return rpr

    tr = tc.getparent()
    if tr is None:
        return None
    for sibling_tc in tr:
        if sibling_tc is tc:
            continue
        for r in sibling_tc.iter(_W_R):
            rpr = r.find(_W_RPR)
            if rpr is not None:
                return rpr
        for p in sibling_tc.iter(_W_P):
            ppr = p.find(_W_PPR)
            if ppr is not None:
                rpr = ppr.find(_W_RPR)
                if rpr is not None:
                    return rpr
    return None


def _set_cell_text(cell: _Cell, new_text: str) -> None:
    """Put ``new_text`` in the first run of the cell's first paragraph.

    The cell's XML is preserved byte-for-byte except for one ``<w:t>`` node.
    We never remove paragraphs or runs (that would collapse vertical space
    and change column/row proportions of the template). Other paragraphs
    and other runs in the first paragraph keep their ``rPr`` but lose any
    stale ``<w:t>`` content so the cell effectively shows only ``new_text``.

    If no runs exist at all in the first paragraph, we synthesise one,
    copying formatting (``rPr``) from:
    1. an existing run anywhere inside the same cell, or
    2. any sibling cell's run in the same row, or
    3. the paragraph's own ``pPr/rPr``.
    That keeps font/size consistent with the rest of the row.
    """
    tc = cell._tc
    paragraphs = tc.findall(_W_P)
    if not paragraphs:
        cell.add_paragraph(new_text)
        return

    first_p = paragraphs[0]
    runs = first_p.findall(_W_R)

    if runs:
        _write_text_into_run(runs[0], new_text)
        for extra in runs[1:]:
            _clear_run_text(extra)
    else:
        rpr_donor = _find_style_donor_rpr(cell)
        if rpr_donor is None:
            ppr = first_p.find(_W_PPR)
            if ppr is not None:
                rpr_donor = ppr.find(_W_RPR)
        new_r = etree.SubElement(first_p, _W_R)
        if rpr_donor is not None:
            new_r.insert(0, deepcopy(rpr_donor))
        _write_text_into_run(new_r, new_text)

    # Clear any text from sibling paragraphs in the cell (they remain as
    # empty-line spacers, keeping the original row height).
    for extra_p in paragraphs[1:]:
        for r in extra_p.findall(_W_R):
            _clear_run_text(r)


def find_placeholders(doc: DocxDocument) -> list[str]:
    """Return the list of unique placeholder names found in the document.

    Order is preserved (first occurrence wins).
    """
    seen: dict[str, None] = {}
    for paragraph in _iter_paragraphs(doc):
        text = _paragraph_text(paragraph)
        for match in _PLACEHOLDER_RE.finditer(text):
            name = match.group("double") or match.group("single") or match.group("bracket")
            if name is None:
                continue
            name = name.strip()
            if name and name not in seen:
                seen[name] = None
    return list(seen.keys())


def _replace_placeholders_in_paragraph(
    paragraph: Paragraph, values: dict[str, str]
) -> bool:
    """Replace every placeholder in ``paragraph`` with the matching value.

    Returns True if the paragraph was changed.
    """
    original = _paragraph_text(paragraph)
    if not original:
        return False

    def _substitute(match: re.Match[str]) -> str:
        name = (
            match.group("double")
            or match.group("single")
            or match.group("bracket")
            or ""
        ).strip()
        if name in values:
            return str(values[name])
        return match.group("full")

    replaced = _PLACEHOLDER_RE.sub(_substitute, original)
    if replaced == original:
        return False
    _set_paragraph_text(paragraph, replaced)
    return True


def _apply_placeholder_values(doc: DocxDocument, values: dict[str, str]) -> int:
    changed = 0
    for paragraph in _iter_paragraphs(doc):
        if _replace_placeholders_in_paragraph(paragraph, values):
            changed += 1
    return changed


_PLACEHOLDER_SYSTEM_PROMPT = """You are an assistant that fills Microsoft Word document templates.

You will be given:
1. A list of placeholder names extracted from a .docx template.
2. A JSON payload that may be either a direct mapping of values, a knowledge base the assistant must mine for values, or a mix of both.

Your job: return a JSON object mapping every placeholder name to the best value
for that placeholder, inferred from the JSON payload. If a placeholder cannot
be resolved from the payload, return an empty string for it. Values must be
plain strings (dates, numbers, etc. formatted as the user would expect to read
them in a finished document). Do not invent facts that are not present in the
payload. Preserve the original language of the document.

Respond with a single JSON object whose keys are the placeholder names and
whose values are the resolved strings. No prose."""


_FREEFORM_SYSTEM_PROMPT = """You are an assistant that fills Microsoft Word document templates, including forms built out of tables.

You will be given:
1. A "document" containing:
   - "paragraphs": top-level paragraphs outside any table. Each has an integer "id" and current "text".
   - "tables": a list of tables. Each table has "rows", and each row is a list of cells. Each cell has an integer "id" and current "text". Merged-cell placeholders may appear as {"merged": true}.
2. A "data" JSON payload — a mapping of values OR a knowledge base the assistant must mine.

Cells (or paragraphs) whose "text" is an empty string, contains only underscores / dots / spaces, or is clearly a fill-in placeholder ("_____", "....", "ФИО:") are BLANK FIELDS that need filling.

The OTHER cells in the same row (and the row above, for header-style tables) identify WHAT should go in each blank. Typical patterns:
- Row: [row-number, field-label, BLANK]  — fill the BLANK with the value that matches the field-label.
- Row: [field-label, BLANK]             — same idea, 2 columns.
- Row: [BLANK, BLANK, BLANK] under a header row [col1-label, col2-label, col3-label] — each blank takes the value for its column's label.

Your job: return edits ONLY for blank fields you can confidently fill from the data payload. Use the adjacent non-blank cells as the label. Write ONLY the value itself (not the label). If a blank cannot be filled from the data, leave it out — do not invent.

Never modify non-blank cells or paragraphs unless they literally contain a fill-in placeholder (underscores/dots prompting input). Never duplicate a label into its own cell.

Respond with exactly one JSON object:
{"edits": [{"id": <int>, "new_text": "..."}, ...]}

Rules:
- Output ONLY the ids of blank fields you're filling.
- Preserve the original language of the document.
- Numbers, dates and currencies: format them as a human would expect to read them in a finished document.
- No prose outside the JSON."""


def _run_placeholder_mode(
    doc: DocxDocument,
    placeholders: list[str],
    data: Any,
    llm: LLMClient,
) -> tuple[dict[str, str], int]:
    user_prompt = json.dumps(
        {
            "placeholders": placeholders,
            "data": data,
        },
        ensure_ascii=False,
        indent=2,
    )
    raw = llm.complete_json(_PLACEHOLDER_SYSTEM_PROMPT, user_prompt)
    values: dict[str, str] = {}
    for name in placeholders:
        v = raw.get(name, "")
        values[name] = "" if v is None else str(v)
    changed = _apply_placeholder_values(doc, values)
    return values, changed


def _collect_slots(doc: DocxDocument) -> tuple[list[_Slot], dict[str, Any]]:
    """Enumerate every fillable slot and produce the LLM-facing structure.

    Each slot is either a top-level paragraph or a table cell (one slot per
    unique cell, to handle merged cells correctly).
    """
    slots: list[_Slot] = []
    paragraphs_out: list[dict[str, Any]] = []
    tables_out: list[dict[str, Any]] = []

    for paragraph in doc.paragraphs:
        text = _paragraph_text(paragraph)
        slot = _Slot(id=len(slots), kind="paragraph", text=text, paragraph=paragraph)
        slots.append(slot)
        paragraphs_out.append({"id": slot.id, "text": text})

    for table_index, table in enumerate(doc.tables):
        rows_out: list[list[dict[str, Any]]] = []
        seen: set[int] = set()
        for row in table.rows:
            row_out: list[dict[str, Any]] = []
            for cell in row.cells:
                cell_key = id(cell._tc)
                if cell_key in seen:
                    row_out.append({"merged": True})
                    continue
                seen.add(cell_key)
                text = _cell_text(cell)
                slot = _Slot(id=len(slots), kind="cell", text=text, cell=cell)
                slots.append(slot)
                row_out.append({"id": slot.id, "text": text})
            rows_out.append(row_out)
        tables_out.append({"table": table_index, "rows": rows_out})

    structure = {"paragraphs": paragraphs_out, "tables": tables_out}
    return slots, structure


def _run_freeform_mode(
    doc: DocxDocument,
    data: Any,
    llm: LLMClient,
) -> int:
    slots, structure = _collect_slots(doc)
    if not slots:
        return 0
    user_prompt = json.dumps(
        {"document": structure, "data": data},
        ensure_ascii=False,
    )
    raw = llm.complete_json(_FREEFORM_SYSTEM_PROMPT, user_prompt)
    edits = raw.get("edits", [])
    if not isinstance(edits, list):
        raise RuntimeError("LLM free-form response must have 'edits' as a list.")
    by_id = {slot.id: slot for slot in slots}
    changed = 0
    for edit in edits:
        if not isinstance(edit, dict):
            continue
        slot_id = edit.get("id")
        new_text = edit.get("new_text")
        if not isinstance(slot_id, int) or not isinstance(new_text, str):
            continue
        slot = by_id.get(slot_id)
        if slot is None:
            continue
        if slot.kind == "paragraph" and slot.paragraph is not None:
            _set_paragraph_text(slot.paragraph, new_text)
            changed += 1
        elif slot.kind == "cell" and slot.cell is not None:
            _set_cell_text(slot.cell, new_text)
            changed += 1
    return changed


def fill_document(docx_bytes: bytes, data: Any, llm: LLMClient) -> FillResult:
    """Fill a .docx document using the provided JSON ``data`` and ``llm``.

    ``data`` is typically the parsed JSON file sent by the caller and may be
    any JSON-serialisable value.
    """
    doc = Document(io.BytesIO(docx_bytes))
    placeholders = find_placeholders(doc)

    filled: dict[str, str] = {}
    if placeholders:
        filled, changed = _run_placeholder_mode(doc, placeholders, data, llm)
        mode = "placeholder"
    else:
        changed = _run_freeform_mode(doc, data, llm)
        mode = "freeform"

    buffer = io.BytesIO()
    doc.save(buffer)
    return FillResult(
        content=buffer.getvalue(),
        mode=mode,
        filled_placeholders=filled,
        changed_paragraphs=changed,
    )
