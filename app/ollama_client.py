"""Ollama (local LLM) implementation of :class:`LLMClient`.

Ollama exposes an OpenAI-compatible ``/api/chat`` endpoint on localhost.
This client talks to that endpoint via plain HTTP — no authentication needed.
"""

from __future__ import annotations

from typing import Any

import httpx

from .gemini_client import LLMClient, _parse_json_lenient  # noqa: F401

_DEFAULT_BASE_URL = "http://localhost:11434"


class OllamaClient:
    """Local Ollama implementation of :class:`LLMClient`."""

    def __init__(
        self,
        model: str = "gemma3:1b",
        base_url: str = _DEFAULT_BASE_URL,
        max_output_tokens: int = 8000,
        timeout: float = 300.0,
    ) -> None:
        if not model:
            raise ValueError("Ollama model name is required.")
        self._model = model
        self._base_url = base_url.rstrip("/")
        self._max_output_tokens = max_output_tokens
        self._timeout = timeout

    def complete_json(self, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        text = self._chat(system_prompt, user_prompt)
        parsed = _parse_json_lenient(text)
        if not isinstance(parsed, dict):
            raise RuntimeError(
                f"Ollama response JSON must be an object, got {type(parsed).__name__}."
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
            "stream": False,
            "options": {
                "temperature": 0.2,
                "num_predict": self._max_output_tokens,
            },
        }
        response = httpx.post(
            f"{self._base_url}/api/chat",
            json=payload,
            timeout=self._timeout,
        )
        if response.status_code >= 400:
            raise RuntimeError(
                f"Ollama request failed: HTTP {response.status_code} {response.text[:500]}"
            )
        data = response.json()
        content = (data.get("message") or {}).get("content", "")
        if not content:
            raise RuntimeError(f"Ollama response has no message content: {data}")
        return str(content)
