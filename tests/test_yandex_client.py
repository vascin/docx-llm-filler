"""Tests for :class:`app.yandex_client.YandexGPTClient` (no real network)."""

from __future__ import annotations

import httpx
import pytest

from app.yandex_client import YandexGPTClient


def _install_mock_transport(monkeypatch: pytest.MonkeyPatch, handler: object) -> list[httpx.Request]:
    requests: list[httpx.Request] = []
    transport = httpx.MockTransport(handler)  # type: ignore[arg-type]

    def fake_post(url: str, **kwargs: object) -> httpx.Response:  # type: ignore[override]
        with httpx.Client(transport=transport) as client:
            response = client.post(url, **kwargs)  # type: ignore[arg-type]
        requests.append(response.request)
        return response

    monkeypatch.setattr("app.yandex_client.httpx.post", fake_post)
    return requests


def test_complete_json_happy_path(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Api-Key yc-key"
        assert request.headers["x-folder-id"] == "b1gfolder"
        body = request.read().decode()
        assert "gpt://b1gfolder/yandexgpt-lite/latest" in body
        return httpx.Response(
            200,
            json={
                "result": {
                    "alternatives": [
                        {"message": {"role": "assistant", "text": '{"edits": []}'}}
                    ]
                }
            },
        )

    _install_mock_transport(monkeypatch, handler)
    client = YandexGPTClient(api_key="yc-key", folder_id="b1gfolder")
    result = client.complete_json("sys", "usr")
    assert result == {"edits": []}


def test_complete_text_returns_stripped(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "result": {
                    "alternatives": [
                        {"message": {"role": "assistant", "text": "  hello  "}}
                    ]
                }
            },
        )

    _install_mock_transport(monkeypatch, handler)
    client = YandexGPTClient(api_key="yc-key", folder_id="b1gfolder")
    assert client.complete_text("sys", "usr") == "hello"


def test_http_error_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, text="forbidden")

    _install_mock_transport(monkeypatch, handler)
    client = YandexGPTClient(api_key="yc-key", folder_id="b1gfolder")
    with pytest.raises(RuntimeError, match="YandexGPT completion failed"):
        client.complete_text("sys", "usr")


def test_missing_credentials_raise() -> None:
    with pytest.raises(ValueError, match="Api-Key"):
        YandexGPTClient(api_key="", folder_id="b1g")
    with pytest.raises(ValueError, match="folder_id"):
        YandexGPTClient(api_key="yc", folder_id="")
