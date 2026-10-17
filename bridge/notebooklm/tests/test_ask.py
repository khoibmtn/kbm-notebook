from __future__ import annotations

from fastapi.testclient import TestClient

from app.models import ReferenceOut
from tests.fakes import FakeClient


def test_ask_maps_references_and_resolves_titles(client: TestClient, fake: FakeClient) -> None:
    fake.ask_references = [
        ReferenceOut(
            source_id="s1", citation_number=1, cited_text="Tim có bốn buồng", start_char=10, end_char=26
        ),
        ReferenceOut(
            source_id="s2", citation_number=2, cited_text="Van hai lá", start_char=0, end_char=10, score=0.65
        ),
        ReferenceOut(source_id="gone", citation_number=3, cited_text=None),
    ]
    r = client.post("/notebooks/nb1/ask", json={"question": "Tim có mấy buồng?"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["answer"].startswith("Tim có 4 buồng")
    assert body["conversation_id"] == "conv-1"
    refs = body["references"]
    assert refs[0] == {
        "source_id": "s1",
        "source_title": "Source s1",
        "citation_number": 1,
        "cited_text": "Tim có bốn buồng",
        "start_char": 10,
        "end_char": 26,
        "score": None,
    }
    assert refs[1]["source_title"] == "Source s2" and refs[1]["score"] == 0.65
    assert refs[2]["source_id"] == "gone" and refs[2]["source_title"] is None


def test_ask_passes_source_ids_and_conversation(client: TestClient, fake: FakeClient) -> None:
    r = client.post(
        "/notebooks/nb1/ask",
        json={"question": "tiếp?", "source_ids": ["s1"], "conversation_id": "conv-9"},
    )
    assert r.status_code == 200
    assert r.json()["conversation_id"] == "conv-9"
    assert ("ask", ("nb1", "tiếp?", ["s1"], "conv-9")) in fake.calls


def test_ask_without_references_does_not_list_sources(client: TestClient, fake: FakeClient) -> None:
    calls = []
    original = fake.list_sources

    async def spy(nb):
        calls.append(nb)
        return await original(nb)

    fake.list_sources = spy  # type: ignore[method-assign]
    r = client.post("/notebooks/nb1/ask", json={"question": "hi"})
    assert r.status_code == 200 and r.json()["references"] == []
    assert calls == []


def test_ask_title_lookup_failure_degrades_gracefully(client: TestClient, fake: FakeClient) -> None:
    from app.errors import BridgeError

    fake.ask_references = [ReferenceOut(source_id="s1", citation_number=1)]

    async def broken(nb):
        raise BridgeError("down", code="upstream_error", status_code=502)

    fake.list_sources = broken  # type: ignore[method-assign]
    r = client.post("/notebooks/nb1/ask", json={"question": "hi"})
    assert r.status_code == 200
    assert r.json()["references"][0]["source_title"] is None


def test_ask_validation(client: TestClient) -> None:
    for body in (
        {},
        {"question": ""},
        {"question": "x", "source_ids": []},
        {"question": "x", "source_ids": [""]},
        {"question": "x", "source_id": "s1"},  # typo must not silently widen the scope
    ):
        r = client.post("/notebooks/nb1/ask", json=body)
        assert r.status_code == 422, body


def test_ask_unknown_notebook(client: TestClient) -> None:
    r = client.post("/notebooks/zzz/ask", json={"question": "x"})
    assert r.status_code == 404
