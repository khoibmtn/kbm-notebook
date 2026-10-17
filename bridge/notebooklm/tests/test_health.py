from __future__ import annotations

import notebooklm
from fastapi.testclient import TestClient

from app import __version__
from tests.fakes import FakeClient


def test_health_authenticated(client: TestClient, fake: FakeClient) -> None:
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["authenticated"] is True
    assert body["account"] == "tester@example.com"
    assert body["version"] == __version__
    assert body["notebooklm_py_version"] == notebooklm.__version__
    assert "detail" not in body


def test_health_cached_for_60s(client: TestClient, fake: FakeClient, clock) -> None:
    client.get("/health")
    clock.now += 59
    client.get("/health")
    assert fake.probe_calls == 1
    clock.now += 2  # 61s since the probe
    client.get("/health")
    assert fake.probe_calls == 2


def test_health_refresh_bypasses_cache_and_sees_login(client: TestClient, fake: FakeClient) -> None:
    fake.authenticated = False
    first = client.get("/health").json()
    assert first["ok"] is True and first["authenticated"] is False
    assert "login" in first["detail"]
    assert "account" not in first
    fake.authenticated = True  # user ran `notebooklm login`
    assert client.get("/health").json()["authenticated"] is False  # still cached
    assert client.get("/health", params={"refresh": "true"}).json()["authenticated"] is True


def test_health_survives_probe_crash(client: TestClient, fake: FakeClient) -> None:
    async def boom():
        raise RuntimeError("kaboom")

    fake.probe = boom  # type: ignore[method-assign]
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["authenticated"] is False
