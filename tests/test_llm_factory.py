"""Tests for the LLM provider factory in :mod:`app.llm_factory`."""

from __future__ import annotations

import pytest

from app.config import Settings
from app.gemini_client import GeminiClient
from app.gigachat_client import GigaChatClient
from app.llm_factory import build_llm
from app.yandex_client import YandexGPTClient


def _settings() -> Settings:
    return Settings()  # all fields use defaults; no keys here


def test_unknown_provider_raises() -> None:
    with pytest.raises(ValueError, match="Unknown LLM provider"):
        build_llm("o3-pro", _settings(), api_key="k")


def test_missing_api_key_raises() -> None:
    with pytest.raises(ValueError, match="API-ключ"):
        build_llm("gemini", _settings(), api_key="")


def test_gemini_builds_with_user_key() -> None:
    client = build_llm("gemini", _settings(), api_key="user-gemini")
    assert isinstance(client, GeminiClient)


def test_gigachat_builds_with_user_key_and_scope() -> None:
    client = build_llm(
        "gigachat", _settings(), api_key="dGVzdDp0ZXN0", extra="GIGACHAT_API_CORP"
    )
    assert isinstance(client, GigaChatClient)
    assert client._scope == "GIGACHAT_API_CORP"  # type: ignore[attr-defined]


def test_gigachat_defaults_scope_when_extra_empty() -> None:
    client = build_llm("gigachat", _settings(), api_key="dGVzdDp0ZXN0")
    assert isinstance(client, GigaChatClient)
    assert client._scope == "GIGACHAT_API_PERS"  # type: ignore[attr-defined]


def test_yandex_builds_with_user_key_and_folder() -> None:
    client = build_llm("yandex", _settings(), api_key="yc-key", extra="b1gtest")
    assert isinstance(client, YandexGPTClient)
    assert client._folder_id == "b1gtest"  # type: ignore[attr-defined]


def test_yandex_requires_folder_id() -> None:
    with pytest.raises(ValueError, match="Folder ID"):
        build_llm("yandex", _settings(), api_key="yc-key")
