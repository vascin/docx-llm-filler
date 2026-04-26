"""Tests for HTTP header construction helpers in app.main."""

from __future__ import annotations

from app.main import _content_disposition


def test_content_disposition_ascii() -> None:
    header = _content_disposition("report.filled.docx")
    assert 'filename="report.filled.docx"' in header
    assert "filename*=UTF-8''report.filled.docx" in header
    header.encode("latin-1")  # Must be latin-1 safe


def test_content_disposition_cyrillic() -> None:
    header = _content_disposition("Анкета (1).filled.docx")
    # Must be safely encodable as latin-1 (Starlette requirement)
    header.encode("latin-1")
    # ASCII fallback stays ASCII, originals get underscored
    assert 'filename="' in header
    # UTF-8 parameter carries the original cyrillic name percent-encoded
    assert "filename*=UTF-8''%D0%90%D0%BD%D0%BA%D0%B5%D1%82%D0%B0" in header


def test_content_disposition_spaces_quoted() -> None:
    header = _content_disposition("My File.docx")
    header.encode("latin-1")
    # Space in the ASCII fallback is fine inside double quotes
    assert 'filename="My File.docx"' in header
