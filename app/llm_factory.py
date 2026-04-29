"""Build an :class:`LLMClient` for a named provider from user-supplied
credentials.

Providers:
* ``gemini``   — Google Gemini.
* ``gigachat`` — Sber GigaChat.
* ``yandex``   — Yandex Cloud YandexGPT.
* ``ollama``   — Local Ollama instance.
* ``wormsoft`` — Wormsoft OpenAI-compatible API.

API keys are always supplied by the user via the web form and are never
read from server-side settings.
"""

from __future__ import annotations

from dataclasses import dataclass

from .config import Settings
from .gemini_client import GeminiClient, LLMClient
from .gigachat_client import GigaChatClient
from .ollama_client import OllamaClient
from .wormsoft_client import WormsoftClient
from .yandex_client import YandexGPTClient

PROVIDERS: tuple[str, ...] = ("gemini", "gigachat", "yandex", "ollama", "wormsoft")
DEFAULT_PROVIDER = "gemini"


@dataclass(frozen=True)
class ProviderInfo:
    """Metadata about a provider rendered in the UI."""

    id: str
    label: str
    key_label: str
    key_placeholder: str
    extra_label: str | None
    extra_placeholder: str | None
    help: str
    key_required: bool = True


PROVIDER_INFO: dict[str, ProviderInfo] = {
    "gemini": ProviderInfo(
        id="gemini",
        label="Google Gemini",
        key_label="Ключ Gemini API",
        key_placeholder="AIza...",
        extra_label=None,
        extra_placeholder=None,
        help=(
            "Получить ключ: https://aistudio.google.com/app/apikey. "
            "Бесплатная модель — gemini-2.5-flash-lite."
        ),
    ),
    "gigachat": ProviderInfo(
        id="gigachat",
        label="GigaChat (Сбер)",
        key_label="Authorization Key GigaChat",
        key_placeholder="base64(client_id:client_secret)",
        extra_label="Scope",
        extra_placeholder="GIGACHAT_API_PERS",
        help=(
            "Получить ключ: https://developers.sber.ru/studio → Настройки API → Получить ключ. "
            "Scope — обычно GIGACHAT_API_PERS (физлицо) или "
            "GIGACHAT_API_CORP / GIGACHAT_API_B2B (юрлицо)."
        ),
    ),
    "yandex": ProviderInfo(
        id="yandex",
        label="YandexGPT",
        key_label="Api-Key Яндекс.Облака",
        key_placeholder="AQVN...",
        extra_label="Folder ID",
        extra_placeholder="b1g...",
        help=(
            "Получить ключ: https://console.cloud.yandex.ru/iam → Сервисные аккаунты. "
            "Нужны и Api-Key, и идентификатор каталога (folder_id)."
        ),
    ),
    "ollama": ProviderInfo(
        id="ollama",
        label="Ollama (локальный)",
        key_label="Имя модели",
        key_placeholder="gemma3:1b",
        extra_label="URL сервера",
        extra_placeholder="http://localhost:11434",
        help=(
            "Запустите Ollama: OLLAMA_ORIGINS=* ollama serve. "
            "Рекомендуемые модели: gemma3:1b, qwen2.5:1.5b, llama3.2:3b."
        ),
        key_required=False,
    ),
    "wormsoft": ProviderInfo(
        id="wormsoft",
        label="Wormsoft (GPT)",
        key_label="API Key Wormsoft",
        key_placeholder="b95d25f5...",
        extra_label=None,
        extra_placeholder=None,
        help="OpenAI-совместимый API. Модель: openai/gpt-5.3-codex.",
    ),
}


def build_llm(
    provider: str,
    settings: Settings,
    *,
    api_key: str,
    extra: str = "",
) -> LLMClient:
    """Build the concrete LLM client for ``provider`` from the user's key."""
    provider = (provider or DEFAULT_PROVIDER).strip().lower()
    if provider not in PROVIDERS:
        raise ValueError(
            f"Unknown LLM provider: {provider!r}. Valid values: {', '.join(PROVIDERS)}."
        )
    api_key = (api_key or "").strip()
    extra = (extra or "").strip()

    info = PROVIDER_INFO.get(provider)
    if info and info.key_required and not api_key:
        raise ValueError(
            "Не заполнен API-ключ провайдера. Введите свой ключ в форме на странице — "
            "на сервере ключи не хранятся."
        )

    if provider == "gemini":
        return GeminiClient(
            api_key=api_key,
            model=settings.gemini_model,
            max_output_tokens=settings.gemini_max_output_tokens,
        )
    if provider == "gigachat":
        return GigaChatClient(
            auth_key=api_key,
            scope=extra or "GIGACHAT_API_PERS",
            model=settings.gigachat_model,
            max_output_tokens=settings.gigachat_max_output_tokens,
            verify_ssl=settings.gigachat_verify_ssl,
        )
    if provider == "yandex":
        if not extra:
            raise ValueError(
                "Для YandexGPT укажите Folder ID (идентификатор каталога в Яндекс.Облаке) "
                "в поле «Доп. параметр»."
            )
        return YandexGPTClient(
            api_key=api_key,
            folder_id=extra,
            model=settings.yandex_model,
            max_output_tokens=settings.yandex_max_output_tokens,
        )
    if provider == "ollama":
        return OllamaClient(
            model=api_key or "gemma3:1b",
            base_url=extra or "http://localhost:11434",
        )
    if provider == "wormsoft":
        return WormsoftClient(
            api_key=api_key,
            model="openai/gpt-5.3-codex",
        )
    raise AssertionError(f"unreachable: unhandled provider {provider!r}")
