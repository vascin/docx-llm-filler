"""YandexGPT implementation of :class:`LLMClient`.

Uses the Foundation Models API with an ``Api-Key`` static credential.
Endpoint: ``https://llm.api.cloud.yandex.net/foundationModels/v1/completion``.

The model is referenced by its ``modelUri``:
``gpt://<folder_id>/<model_name>``. ``model_name`` defaults to
``yandexgpt-lite/latest``; ``yandexgpt/latest`` is the higher-quality
(and more expensive) tier.
"""

from __future__ import annotations

from typing import Any

import httpx

from .gemini_client import LLMClient, _parse_json_lenient  # noqa: F401 (LLMClient re-export)

_COMPLETION_URL = "https://llm.api.cloud.yandex.net/foundationModels/v1/completion"


class YandexGPTClient:
    """Yandex Cloud YandexGPT implementation of :class:`LLMClient`."""

    def __init__(
        self,
        api_key: str,
        folder_id: str,
        model: str = "yandexgpt-lite/latest",
        max_output_tokens: int = 8000,
        timeout: float = 180.0,
    ) -> None:
        if not api_key:
            raise ValueError(
                "YandexGPT Api-Key is not configured. "
                "Set YANDEX_API_KEY or pass a key in the request."
            )
        if not folder_id:
            raise ValueError(
                "YandexGPT folder_id is not configured. "
                "Set YANDEX_FOLDER_ID or pass it alongside the key."
            )
        self._api_key = api_key
        self._folder_id = folder_id
        self._model = model
        self._max_output_tokens = max_output_tokens
        self._timeout = timeout

    def complete_json(self, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        text = self._complete(system_prompt, user_prompt, as_json=True)
        parsed = _parse_json_lenient(text)
        if not isinstance(parsed, dict):
            raise RuntimeError(
                f"YandexGPT response JSON must be an object, got {type(parsed).__name__}."
            )
        return parsed

    def complete_text(self, system_prompt: str, user_prompt: str) -> str:
        return self._complete(system_prompt, user_prompt, as_json=False).strip()

    # --- internals -----------------------------------------------------

    def _complete(self, system_prompt: str, user_prompt: str, *, as_json: bool) -> str:
        payload: dict[str, Any] = {
            "modelUri": f"gpt://{self._folder_id}/{self._model}",
            "completionOptions": {
                "stream": False,
                "temperature": 0.2,
                "maxTokens": str(self._max_output_tokens),
            },
            "messages": [
                {"role": "system", "text": system_prompt},
                {"role": "user", "text": user_prompt},
            ],
        }
        if as_json:
            payload["completionOptions"]["reasoningOptions"] = {"mode": "DISABLED"}
            payload["jsonObject"] = True
        headers = {
            "Authorization": f"Api-Key {self._api_key}",
            "x-folder-id": self._folder_id,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        response = httpx.post(
            _COMPLETION_URL,
            json=payload,
            headers=headers,
            timeout=self._timeout,
        )
        if response.status_code >= 400:
            raise RuntimeError(
                f"YandexGPT completion failed: HTTP {response.status_code} {response.text[:500]}"
            )
        data = response.json()
        result = data.get("result") or {}
        alternatives = result.get("alternatives") or []
        if not alternatives:
            raise RuntimeError(f"YandexGPT response has no alternatives: {data}")
        message = alternatives[0].get("message") or {}
        text = message.get("text")
        if not text:
            raise RuntimeError(f"YandexGPT response has no message text: {data}")
        return str(text)
