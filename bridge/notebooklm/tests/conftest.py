from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.fakes import FakeClient

TOKEN = "t" * 12 + "-test-token-" + "x" * 12
AUTH = {"Authorization": f"Bearer {TOKEN}"}


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def fake() -> FakeClient:
    return FakeClient()


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(token=TOKEN, tmp_dir=tmp_path / "work", max_upload_bytes=64 * 1024)


@pytest.fixture
def client(fake: FakeClient, settings: Settings, clock: Clock) -> Iterator[TestClient]:
    app = create_app(settings, fake, clock=clock)
    with TestClient(app, headers=AUTH, raise_server_exceptions=False) as c:
        yield c


@pytest.fixture
def anon(fake: FakeClient, settings: Settings, clock: Clock) -> Iterator[TestClient]:
    """Client that sends no credentials by default."""
    app = create_app(settings, fake, clock=clock)
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c
