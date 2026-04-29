"""Wormsoft OpenAI-compatible provider implementation of :class:`LLMClient`.

Wormsoft exposes an OpenAI-compatible ``/v1/chat/completions`` endpoint.
"""

from __future__ import annotations

from typing import Any

import httpx

from .gemini_client import LLMClient, _parse_json_lenient  # noqa: F401

_DEFAULT_BASE_URL = "https://ai.wormsoft.ru/api/gpt"
_DEFAULT_MODEL = "openai/gpt-5.3-codex"


class WormsoftClient:
    """Wormsoft OpenAI-compatible implementation of :class:`LLMClient`."""

    def __init__(
        self,
        api_key: str,
        model: str = _DEFAULT_MODEL,
        base_url: str = _DEFAULT_BASE_URL,
        max_output_tokens: int = 8000,
        timeout: float = 180.0,
    ) -> None:
        if not api_key:
            raise ValueError("Wormsoft API key is required.")
        self._api_key = api_key
        self._model = model
        self._base_url = base_url.rstrip("/")
        self._max_output_tokens = max_output_tokens
        self._timeout = timeout

    def complete_json(self, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        text = self._chat(system_prompt, user_prompt)
        parsed = _parse_json_lenient(text)
        if not isinstance(parsed, dict):
            raise RuntimeError(
                f"Wormsoft response JSON must be an object, got {type(parsed).__name__}."
            )
        return parsed

    def complete_text(self, system_prompt: str, user_prompt: str) -> str:
        return self._chat(system_prompt, user_prompt).strip()

    def _chat(self, system_prompt: str, user_prompt: str) -> str:
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.2,
            "max_tokens": self._max_output_tokens,
        }
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        response = httpx.post(
            f"{self._base_url}/chat/completions",
            json=payload,
            headers=headers,
            timeout=self._timeout,
        )
        if response.status_code >= 400:
            raise RuntimeError(
                f"Wormsoft request failed: HTTP {response.status_code} {response.text[:500]}"
            )
        data = response.json()
        choices = data.get("choices") or []
        if not choices:
            raise RuntimeError(f"Wormsoft response has no choices: {data}")
        content = (choices[0].get("message") or {}).get("content")
        if not content:
            raise RuntimeError(f"Wormsoft response has no message content: {data}")
        return str(content)
