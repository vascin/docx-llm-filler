"""GigaChat (Sber) implementation of :class:`LLMClient`.

GigaChat uses a two-step authentication:

1. ``POST https://ngw.devices.sberbank.ru:9443/api/v2/oauth`` with an
   ``Authorization: Basic <authKey>`` header and ``scope`` in the form body
   to obtain an ``access_token`` valid for ~30 minutes.
2. ``POST https://gigachat.devices.sberbank.ru/api/v1/chat/completions`` with
   ``Authorization: Bearer <access_token>`` for the actual completion.

The OpenAI-compatible chat endpoint is used, so the request/response shape
matches the rest of the ecosystem.

GigaChat endpoints use certificates signed by the Russian Trusted Root CA
which is absent from standard CA bundles. The bundled
``app/certs/russian_trusted_ca.pem`` is appended to the system trust store
at runtime so that SSL verification works out of the box.
"""

from __future__ import annotations

import ssl
import time
import uuid
from pathlib import Path
from typing import Any

import certifi
import httpx

from .gemini_client import LLMClient, _parse_json_lenient  # noqa: F401 (LLMClient re-export)

_OAUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
_CHAT_URL = "https://gigachat.devices.sberbank.ru/api/v1/chat/completions"
_TOKEN_LEEWAY_SECONDS = 60.0

_CERTS_DIR = Path(__file__).resolve().parent / "certs"
_RUSSIAN_CA = _CERTS_DIR / "russian_trusted_ca.pem"


def _build_ssl_context() -> ssl.SSLContext:
    """Create an SSL context that trusts both system CAs and the Russian CA."""
    ctx = ssl.create_default_context(cafile=certifi.where())
    if _RUSSIAN_CA.exists():
        ctx.load_verify_locations(cafile=str(_RUSSIAN_CA))
    return ctx


class GigaChatClient:
    """Sber GigaChat implementation of :class:`LLMClient`."""

    def __init__(
        self,
        auth_key: str,
        scope: str = "GIGACHAT_API_PERS",
        model: str = "GigaChat",
        max_output_tokens: int = 8000,
        verify_ssl: bool = True,
        timeout: float = 180.0,
    ) -> None:
        if not auth_key:
            raise ValueError(
                "GigaChat authorization key is not configured. "
                "Set GIGACHAT_AUTH_KEY or pass a key in the request."
            )
        # Sanitise user input: strip whitespace / accidental "Basic " prefix.
        clean = auth_key.strip()
        if clean.lower().startswith("basic "):
            clean = clean[len("basic "):].strip()
        self._auth_key = clean
        self._scope = scope or "GIGACHAT_API_PERS"
        self._model = model
        self._max_output_tokens = max_output_tokens
        self._verify_ssl = verify_ssl
        self._timeout = timeout
        self._access_token: str | None = None
        self._expires_at: float = 0.0
        self._ssl_ctx: ssl.SSLContext | None = (
            _build_ssl_context() if verify_ssl else None
        )

    def complete_json(self, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        text = self._chat(system_prompt, user_prompt, as_json=True)
        parsed = _parse_json_lenient(text)
        if not isinstance(parsed, dict):
            raise RuntimeError(
                f"GigaChat response JSON must be an object, got {type(parsed).__name__}."
            )
        return parsed

    def complete_text(self, system_prompt: str, user_prompt: str) -> str:
        return self._chat(system_prompt, user_prompt, as_json=False).strip()

    # --- internals -----------------------------------------------------

    def _chat(self, system_prompt: str, user_prompt: str, *, as_json: bool) -> str:
        token = self._get_access_token()
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.2,
            "max_tokens": self._max_output_tokens,
        }
        # Not all GigaChat models support ``response_format``.  We rely on
        # the system prompt to request JSON and parse it with
        # ``_parse_json_lenient`` which tolerates markdown fences and preamble.
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        verify = self._ssl_ctx if self._ssl_ctx is not None else False
        response = httpx.post(
            _CHAT_URL,
            json=payload,
            headers=headers,
            verify=verify,
            timeout=self._timeout,
        )
        if response.status_code >= 400:
            raise RuntimeError(
                f"GigaChat chat/completions failed: HTTP {response.status_code} {response.text[:500]}"
            )
        data = response.json()
        choices = data.get("choices") or []
        if not choices:
            raise RuntimeError(f"GigaChat response has no choices: {data}")
        content = (choices[0].get("message") or {}).get("content")
        if not content:
            raise RuntimeError(f"GigaChat response has no message content: {data}")
        return str(content)

    def _get_access_token(self) -> str:
        if self._access_token and time.time() < self._expires_at - _TOKEN_LEEWAY_SECONDS:
            return self._access_token
        headers = {
            "Authorization": f"Basic {self._auth_key}",
            "RqUID": str(uuid.uuid4()),
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        }
        verify = self._ssl_ctx if self._ssl_ctx is not None else False
        response = httpx.post(
            _OAUTH_URL,
            data={"scope": self._scope},
            headers=headers,
            verify=verify,
            timeout=self._timeout,
        )
        if response.status_code >= 400:
            hint = (
                "Проверьте Authorization Key и выбранный scope "
                "(GIGACHAT_API_PERS / GIGACHAT_API_CORP / GIGACHAT_API_B2B). "
                "Ключ можно сгенерировать заново в личном кабинете "
                "https://developers.sber.ru/studio → Настройки API → Получить ключ."
            )
            raise RuntimeError(
                "GigaChat OAuth failed: HTTP "
                f"{response.status_code} {response.text[:500]}\n{hint}"
            )
        data = response.json()
        token = data.get("access_token")
        if not token:
            raise RuntimeError(f"GigaChat OAuth response has no access_token: {data}")
        self._access_token = str(token)
        # expires_at is a unix timestamp in milliseconds per GigaChat docs.
        expires_at_ms = data.get("expires_at")
        if isinstance(expires_at_ms, (int, float)) and expires_at_ms > 0:
            self._expires_at = float(expires_at_ms) / 1000.0
        else:
            self._expires_at = time.time() + 1500.0  # ~25 min fallback
        return self._access_token
