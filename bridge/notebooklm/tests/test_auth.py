from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.auth import extract_bearer, tokens_match
from app.config import ConfigError, Settings
from app.main import create_app
from tests.conftest import TOKEN
from tests.fakes import FakeClient


@pytest.mark.parametrize("path", ["/health", "/notebooks", "/notebooks/nb1", "/nope", "/openapi.json"])
def test_requires_token_everywhere(anon: TestClient, path: str) -> None:
    r = anon.get(path)
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"
    assert r.headers["www-authenticate"].startswith("Bearer")


def test_wrong_and_malformed_tokens_rejected(anon: TestClient) -> None:
    for header in ("Bearer nope", f"Basic {TOKEN}", "Bearer", TOKEN, f"Bearer  {TOKEN}x", "Bearer é".encode("latin-1")):
        r = anon.get("/health", headers={"Authorization": header})
        assert r.status_code == 401, header


def test_write_endpoints_rejected_without_token(anon: TestClient) -> None:
    assert anon.post("/notebooks", json={"title": "x"}).status_code == 401
    assert anon.delete("/notebooks/nb1/sources/s1").status_code == 401
    # multipart is rejected before the body is parsed
    r = anon.post("/notebooks/nb1/sources", files={"file": ("a.txt", b"hello")})
    assert r.status_code == 401


def test_valid_token_accepted_case_insensitive_scheme(anon: TestClient) -> None:
    assert anon.get("/health", headers={"Authorization": f"bearer {TOKEN}"}).status_code == 200
    assert anon.get("/health", headers={"Authorization": f"Bearer {TOKEN}"}).status_code == 200


def test_missing_server_token_fails_closed() -> None:
    app = create_app(Settings(token=None), FakeClient())
    # the lifespan refuses to start without BRIDGE_TOKEN
    with pytest.raises(ConfigError):
        with TestClient(app):
            pass


def test_requests_fail_closed_when_token_unset() -> None:
    # Even if someone bypasses the lifespan check, no token configured => 503, never open.
    app = create_app(Settings(token=None), FakeClient())
    c = TestClient(app, raise_server_exceptions=False)  # no lifespan
    r = c.get("/notebooks", headers={"Authorization": "Bearer anything"})
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "bridge_not_configured"


def test_short_token_rejected_at_startup() -> None:
    with pytest.raises(ConfigError):
        Settings(token="short").validate_for_serving()


def test_unit_helpers() -> None:
    assert extract_bearer("Bearer abc") == "abc"
    assert extract_bearer("bearer   abc ") == "abc"
    assert extract_bearer("Token abc") is None
    assert extract_bearer(None) is None
    assert tokens_match("abc", "abc")
    assert not tokens_match("abc", "abd")
    assert not tokens_match(None, "abc")
    assert not tokens_match("", "")
    assert not tokens_match("\ud800", "x")  # lone surrogate must not raise


def test_cors_preflight_without_token_and_headers_on_401(fake: FakeClient, settings: Settings) -> None:
    s = Settings(token=TOKEN, allowed_origins=("https://app.example.com",))
    c = TestClient(create_app(s, fake), raise_server_exceptions=False)
    pre = c.options(
        "/notebooks",
        headers={
            "Origin": "https://app.example.com",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert pre.status_code == 200
    assert pre.headers["access-control-allow-origin"] == "https://app.example.com"
    r = c.get("/notebooks", headers={"Origin": "https://app.example.com"})
    assert r.status_code == 401
    assert r.headers["access-control-allow-origin"] == "https://app.example.com"
    evil = c.get("/notebooks", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in evil.headers


def test_no_cors_headers_by_default(anon: TestClient) -> None:
    r = anon.get("/health", headers={"Origin": "https://x.example"})
    assert "access-control-allow-origin" not in r.headers
