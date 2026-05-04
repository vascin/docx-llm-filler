"""Tests for :class:`app.gigachat_client.GigaChatClient` (no real network)."""

from __future__ import annotations

import httpx
import pytest

from app.gigachat_client import GigaChatClient


def _install_mock_transport(monkeypatch: pytest.MonkeyPatch, handler: object) -> list[httpx.Request]:
    """Replace ``httpx.post`` so every call is served by ``handler``.

    Returns the list of intercepted requests so tests can assert on them.
    """
    requests: list[httpx.Request] = []
    transport = httpx.MockTransport(handler)  # type: ignore[arg-type]

    def fake_post(url: str, **kwargs: object) -> httpx.Response:  # type: ignore[override]
        kwargs.pop("verify", None)  # verify is a Client-level, not per-request, setting
        with httpx.Client(transport=transport, verify=False) as client:
            response = client.post(url, **kwargs)  # type: ignore[arg-type]
        requests.append(response.request)
        return response

    monkeypatch.setattr("app.gigachat_client.httpx.post", fake_post)
    return requests


def test_complete_json_happy_path(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if "oauth" in request.url.path:
            return httpx.Response(
                200,
                json={"access_token": "tok-abc", "expires_at": 9_999_999_999_000},
            )
        if "chat/completions" in request.url.path:
            assert request.headers["authorization"] == "Bearer tok-abc"
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {"message": {"role": "assistant", "content": '{"a": 1, "b": "x"}'}}
                    ]
                },
            )
        raise AssertionError(f"Unexpected URL: {request.url}")

    requests = _install_mock_transport(monkeypatch, handler)
    client = GigaChatClient(auth_key="dGVzdDp0ZXN0", verify_ssl=False)
    result = client.complete_json("system", "user")
    assert result == {"a": 1, "b": "x"}
    # Second call re-uses the cached token (one oauth, two chat calls).
    client.complete_json("system", "user")
    paths = [r.url.path for r in requests]
    assert paths.count("/api/v2/oauth") == 1
    assert paths.count("/api/v1/chat/completions") == 2


def test_oauth_failure_raises_with_context(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "bad key"})

    _install_mock_transport(monkeypatch, handler)
    client = GigaChatClient(auth_key="bad", verify_ssl=False)
    with pytest.raises(RuntimeError, match="GigaChat OAuth failed"):
        client.complete_json("sys", "usr")


def test_chat_failure_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if "oauth" in request.url.path:
            return httpx.Response(200, json={"access_token": "t", "expires_at": 9_999_999_999_000})
        return httpx.Response(500, text="server down")

    _install_mock_transport(monkeypatch, handler)
    client = GigaChatClient(auth_key="dGVzdDp0ZXN0", verify_ssl=False)
    with pytest.raises(RuntimeError, match="GigaChat chat/completions failed"):
        client.complete_text("sys", "usr")


def test_missing_auth_key_raises_before_any_request() -> None:
    with pytest.raises(ValueError, match="GigaChat"):
        GigaChatClient(auth_key="")
