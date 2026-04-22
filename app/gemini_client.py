"""Thin wrapper around the Google Gemini API.

Designed so that the concrete provider can be swapped later without touching
the rest of the application (see ``LLMClient`` protocol).
"""

from __future__ import annotations

import json
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

    def __init__(self, api_key: str, model: str, max_output_tokens: int = 8192) -> None:
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
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            raise RuntimeError(
                f"Gemini response was not valid JSON: {exc}\nRaw response: {text[:500]}"
            ) from exc
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
