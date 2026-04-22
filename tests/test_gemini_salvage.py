"""Tests for the lenient JSON recovery in :mod:`app.gemini_client`."""

from __future__ import annotations

import pytest

from app.gemini_client import _parse_json_lenient


def test_plain_valid_json() -> None:
    assert _parse_json_lenient('{"a": 1, "b": "x"}') == {"a": 1, "b": "x"}


def test_salvage_truncated_edits_array() -> None:
    truncated = (
        '{"edits": [\n'
        '  {"id": 1, "new_text": "first"},\n'
        '  {"id": 2, "new_text": "second"},\n'
        '  {"id": 3, "new_text": "thi'  # truncated mid-string
    )
    result = _parse_json_lenient(truncated)
    assert result == {
        "edits": [
            {"id": 1, "new_text": "first"},
            {"id": 2, "new_text": "second"},
        ]
    }


def test_salvage_truncated_edits_array_with_complete_closing_kept_items() -> None:
    truncated = '{"edits": [{"id": 0, "new_text": "a"}, {"id": 1,'
    result = _parse_json_lenient(truncated)
    assert result == {"edits": [{"id": 0, "new_text": "a"}]}


def test_salvage_object_with_truncated_tail() -> None:
    truncated = '{"name": "Ivan", "age": 42, "city": "Moscow", "street":'
    result = _parse_json_lenient(truncated)
    assert result == {"name": "Ivan", "age": 42, "city": "Moscow"}


def test_salvage_object_with_nested_values() -> None:
    truncated = '{"a": [1, 2, 3], "b": {"x": true, "y": false}, "c": nul'
    result = _parse_json_lenient(truncated)
    assert result == {"a": [1, 2, 3], "b": {"x": True, "y": False}}


def test_unrecoverable_raises() -> None:
    with pytest.raises(RuntimeError, match="could not be recovered"):
        _parse_json_lenient("this is not json at all")
