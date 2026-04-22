"""Thin wrapper around the Google Gemini API.

Designed so that the concrete provider can be swapped later without touching
the rest of the application (see ``LLMClient`` protocol).
"""

from __future__ import annotations

import json
import re
from typing import Any, Protocol

from google import genai
from google.genai import types


class LLMClient(Protocol):
    """Minimal interface any LLM backend must implement."""

    def complete_json(self, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        """Run a completion and parse the response as JSON."""

    def complete_text(self, system_prompt: str, user_prompt: str) -> str:
        """Run a completion and return raw text."""


class GeminiClient:
    """Google Gemini implementation of :class:`LLMClient`."""

    def __init__(self, api_key: str, model: str, max_output_tokens: int = 65536) -> None:
        if not api_key:
            raise ValueError(
                "GEMINI_API_KEY is not configured. Set it in the environment or .env file."
            )
        self._client = genai.Client(api_key=api_key)
        self._model = model
        self._max_output_tokens = max_output_tokens

    def complete_json(self, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        config = types.GenerateContentConfig(
            system_instruction=system_prompt,
            response_mime_type="application/json",
            max_output_tokens=self._max_output_tokens,
            temperature=0.2,
        )
        response = self._client.models.generate_content(
            model=self._model,
            contents=user_prompt,
            config=config,
        )
        text = (response.text or "").strip()
        if not text:
            raise RuntimeError("Gemini returned an empty response.")
        parsed = _parse_json_lenient(text)
        if not isinstance(parsed, dict):
            raise RuntimeError(
                f"Gemini response JSON must be an object, got {type(parsed).__name__}."
            )
        return parsed

    def complete_text(self, system_prompt: str, user_prompt: str) -> str:
        config = types.GenerateContentConfig(
            system_instruction=system_prompt,
            max_output_tokens=self._max_output_tokens,
            temperature=0.2,
        )
        response = self._client.models.generate_content(
            model=self._model,
            contents=user_prompt,
            config=config,
        )
        return (response.text or "").strip()


def _parse_json_lenient(text: str) -> Any:
    """Parse a JSON response, recovering from truncation at the token limit.

    If the model's response was cut off mid-object (common for large documents
    hitting ``max_output_tokens``), try to salvage the last complete element of
    the ``edits`` array / the last complete key-value pair of a top-level
    object before raising. This lets most placeholders / paragraphs still be
    filled even when the response is truncated.
    """
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    edits_salvaged = _salvage_edits_array(text)
    if edits_salvaged is not None:
        return {"edits": edits_salvaged}

    object_salvaged = _salvage_object(text)
    if object_salvaged is not None:
        return object_salvaged

    raise RuntimeError(
        "Gemini response was not valid JSON and could not be recovered. "
        "The response was likely truncated at the output-token limit. "
        f"Increase GEMINI_MAX_OUTPUT_TOKENS or shorten the document. "
        f"First 500 chars of response: {text[:500]}"
    )


def _salvage_edits_array(text: str) -> list[dict[str, Any]] | None:
    """Extract a truncated ``{"edits": [...]}`` response.

    Finds the opening ``[`` after ``"edits"``, then walks through top-level
    braces inside the array and keeps only fully-closed objects.
    """
    match = re.search(r'"edits"\s*:\s*\[', text)
    if not match:
        return None
    start = match.end()
    objects: list[dict[str, Any]] = []
    i = start
    n = len(text)
    while i < n:
        while i < n and text[i] in " \n\r\t,":
            i += 1
        if i >= n or text[i] != "{":
            break
        end = _find_matching_brace(text, i)
        if end is None:
            break
        chunk = text[i : end + 1]
        try:
            parsed = json.loads(chunk)
        except json.JSONDecodeError:
            break
        if isinstance(parsed, dict):
            objects.append(parsed)
        i = end + 1
    if not objects:
        return None
    return objects


def _salvage_object(text: str) -> dict[str, Any] | None:
    """Rebuild a truncated top-level JSON object from complete ``"key": value``
    pairs.
    """
    if not text.startswith("{"):
        return None
    result: dict[str, Any] = {}
    i = 1
    n = len(text)
    while i < n:
        while i < n and text[i] in " \n\r\t,":
            i += 1
        if i >= n or text[i] == "}":
            break
        if text[i] != '"':
            break
        key_end = _find_string_end(text, i)
        if key_end is None:
            break
        try:
            key = json.loads(text[i : key_end + 1])
        except json.JSONDecodeError:
            break
        i = key_end + 1
        while i < n and text[i] in " \n\r\t":
            i += 1
        if i >= n or text[i] != ":":
            break
        i += 1
        while i < n and text[i] in " \n\r\t":
            i += 1
        value_end = _find_value_end(text, i)
        if value_end is None:
            break
        try:
            value = json.loads(text[i : value_end + 1])
        except json.JSONDecodeError:
            break
        if isinstance(key, str):
            result[key] = value
        i = value_end + 1
    return result or None


def _find_matching_brace(text: str, start: int) -> int | None:
    depth = 0
    i = start
    in_string = False
    escape = False
    n = len(text)
    while i < n:
        ch = text[i]
        if escape:
            escape = False
        elif ch == "\\" and in_string:
            escape = True
        elif ch == '"':
            in_string = not in_string
        elif not in_string:
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return i
        i += 1
    return None


def _find_string_end(text: str, start: int) -> int | None:
    assert text[start] == '"'
    i = start + 1
    n = len(text)
    escape = False
    while i < n:
        ch = text[i]
        if escape:
            escape = False
        elif ch == "\\":
            escape = True
        elif ch == '"':
            return i
        i += 1
    return None


def _find_value_end(text: str, start: int) -> int | None:
    """Return the index of the last character of a JSON value starting at
    ``start``. Supports strings, numbers, true/false/null, objects and arrays.
    """
    n = len(text)
    if start >= n:
        return None
    ch = text[start]
    if ch == '"':
        return _find_string_end(text, start)
    if ch == "{":
        return _find_matching_brace(text, start)
    if ch == "[":
        depth = 0
        i = start
        in_string = False
        escape = False
        while i < n:
            c = text[i]
            if escape:
                escape = False
            elif c == "\\" and in_string:
                escape = True
            elif c == '"':
                in_string = not in_string
            elif not in_string:
                if c == "[":
                    depth += 1
                elif c == "]":
                    depth -= 1
                    if depth == 0:
                        return i
            i += 1
        return None
    # literal: number / true / false / null
    i = start
    while i < n and text[i] not in ",}\n\r\t ":
        i += 1
    if i == start:
        return None
    return i - 1
