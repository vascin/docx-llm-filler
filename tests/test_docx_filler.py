"""Unit tests for the docx_filler module using a stub LLM."""

from __future__ import annotations

import io
import json
from typing import Any

from docx import Document

from app.docx_filler import FillResult, fill_document, find_placeholders


class StubLLM:
    """Stub LLM that returns whatever is registered for a given system prompt."""

    def __init__(self, json_response: dict[str, Any] | None = None, text_response: str = "") -> None:
        self.json_response = json_response or {}
        self.text_response = text_response
        self.last_system: str = ""
        self.last_user: str = ""

    def complete_json(self, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        self.last_system = system_prompt
        self.last_user = user_prompt
        return self.json_response

    def complete_text(self, system_prompt: str, user_prompt: str) -> str:
        self.last_system = system_prompt
        self.last_user = user_prompt
        return self.text_response


def _make_docx(paragraphs: list[str]) -> bytes:
    doc = Document()
    for text in paragraphs:
        doc.add_paragraph(text)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _read_paragraphs(docx_bytes: bytes) -> list[str]:
    return [p.text for p in Document(io.BytesIO(docx_bytes)).paragraphs]


def test_find_placeholders_various_syntaxes() -> None:
    bytes_ = _make_docx(
        [
            "Dear {{ client_name }},",
            "Amount: { amount } USD",
            "Date: [ today ]",
            "No placeholders here.",
            "Repeated {{ client_name }} should be deduplicated.",
        ]
    )
    doc = Document(io.BytesIO(bytes_))
    assert find_placeholders(doc) == ["client_name", "amount", "today"]


def test_fill_document_placeholder_mode() -> None:
    docx_bytes = _make_docx(
        [
            "Hello {{ name }}!",
            "Your total is [ total ] rubles.",
        ]
    )
    llm = StubLLM(json_response={"name": "Alice", "total": "1200"})
    result: FillResult = fill_document(docx_bytes, {"name": "Alice", "total": 1200}, llm)

    assert result.mode == "placeholder"
    assert result.filled_placeholders == {"name": "Alice", "total": "1200"}
    assert result.changed_paragraphs == 2

    paragraphs = _read_paragraphs(result.content)
    assert paragraphs == ["Hello Alice!", "Your total is 1200 rubles."]


def test_fill_document_placeholder_mode_missing_value_becomes_empty() -> None:
    docx_bytes = _make_docx(["Name: {{ name }}, Email: {{ email }}"])
    llm = StubLLM(json_response={"name": "Bob"})
    result = fill_document(docx_bytes, {"name": "Bob"}, llm)

    assert result.filled_placeholders == {"name": "Bob", "email": ""}
    paragraphs = _read_paragraphs(result.content)
    assert paragraphs == ["Name: Bob, Email: "]


def test_fill_document_freeform_mode_applies_edits() -> None:
    docx_bytes = _make_docx(
        [
            "Report",
            "Customer: ____",
            "Signed by ________",
        ]
    )
    llm = StubLLM(
        json_response={
            "edits": [
                {"id": 1, "new_text": "Customer: Acme Inc."},
                {"id": 2, "new_text": "Signed by John Doe"},
            ]
        }
    )
    result = fill_document(docx_bytes, {"customer": "Acme Inc.", "signer": "John Doe"}, llm)

    assert result.mode == "freeform"
    assert result.changed_paragraphs == 2
    paragraphs = _read_paragraphs(result.content)
    assert paragraphs == ["Report", "Customer: Acme Inc.", "Signed by John Doe"]


def test_fill_document_freeform_mode_ignores_invalid_edits() -> None:
    docx_bytes = _make_docx(["A", "B"])
    llm = StubLLM(
        json_response={
            "edits": [
                {"id": 99, "new_text": "out of range"},
                {"id": "bogus", "new_text": "bad id"},
                {"id": 0, "new_text": "replaced"},
                "not a dict",
            ]
        }
    )
    result = fill_document(docx_bytes, {}, llm)
    assert result.changed_paragraphs == 1
    paragraphs = _read_paragraphs(result.content)
    assert paragraphs == ["replaced", "B"]


def test_fill_document_passes_data_to_llm() -> None:
    docx_bytes = _make_docx(["Hi {{ name }}"])
    llm = StubLLM(json_response={"name": "Eve"})
    data = {"name": "Eve", "extra": {"nested": True}}
    fill_document(docx_bytes, data, llm)

    payload = json.loads(llm.last_user)
    assert payload["placeholders"] == ["name"]
    assert payload["data"] == data


def _make_form_docx_with_table(rows: list[list[str]]) -> bytes:
    doc = Document()
    doc.add_paragraph("АНКЕТА")
    table = doc.add_table(rows=len(rows), cols=len(rows[0]))
    for r, row in enumerate(rows):
        for c, text in enumerate(row):
            table.cell(r, c).text = text
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def test_freeform_mode_fills_empty_table_cells() -> None:
    """LLM should be able to fill the empty right-hand cells of a form table."""
    docx_bytes = _make_form_docx_with_table(
        [
            ["1.", "Полное наименование", ""],
            ["2.", "ИНН", ""],
        ]
    )

    # Top-level paragraph "АНКЕТА" = slot 0.
    # Table cells are enumerated row-major starting from slot 1:
    #   row 0: 1→"1.", 2→"Полное наименование", 3→"" (empty)
    #   row 1: 4→"2.", 5→"ИНН", 6→"" (empty)
    llm = StubLLM(
        json_response={
            "edits": [
                {"id": 3, "new_text": "ООО «Ромашка»"},
                {"id": 6, "new_text": "7701810648"},
            ]
        }
    )
    result = fill_document(docx_bytes, {"name": "ООО «Ромашка»", "inn": "7701810648"}, llm)

    assert result.mode == "freeform"
    assert result.changed_paragraphs == 2

    doc = Document(io.BytesIO(result.content))
    assert doc.tables[0].cell(0, 2).text == "ООО «Ромашка»"
    assert doc.tables[0].cell(1, 2).text == "7701810648"
    # Labels should not be touched.
    assert doc.tables[0].cell(0, 1).text == "Полное наименование"
    assert doc.tables[0].cell(1, 1).text == "ИНН"


def test_freeform_mode_exposes_table_structure_to_llm() -> None:
    """The prompt to the LLM must carry the grid layout + cell ids."""
    docx_bytes = _make_form_docx_with_table(
        [["Имя", ""], ["Возраст", ""]]
    )
    llm = StubLLM(json_response={"edits": []})
    fill_document(docx_bytes, {}, llm)

    payload = json.loads(llm.last_user)
    doc_struct = payload["document"]
    assert "tables" in doc_struct
    tables = doc_struct["tables"]
    assert len(tables) == 1
    rows = tables[0]["rows"]
    # 2 rows × 2 cols, every cell has an id and text.
    assert len(rows) == 2
    assert rows[0][0]["text"] == "Имя"
    assert rows[0][1]["text"] == ""
    assert rows[1][0]["text"] == "Возраст"
    assert rows[1][1]["text"] == ""
    # The ids across all cells must be unique integers.
    ids = [cell["id"] for row in rows for cell in row]
    assert len(set(ids)) == len(ids)
