from __future__ import annotations

import shutil

from fastapi.testclient import TestClient

from tests.fakes import FakeClient

PPTX = b"PK\x03\x04pptx-bytes"


def _generate(client: TestClient, **body) -> dict:
    body.setdefault("type", "slide_deck")
    r = client.post("/notebooks/nb1/artifacts/generate", json=body)
    assert r.status_code == 202, r.text
    return r.json()


def test_generate_then_status_then_download_pptx(client: TestClient, fake: FakeClient, settings) -> None:
    out = _generate(
        client,
        type="slide_deck",
        instructions="  Tập trung vào lâm sàng  ",
        options={"slide_format": "Presenter-Slides", "language": "vi"},
    )
    assert out["task_id"] == out["artifact_id"]
    assert out["status"] == "in_progress"
    aid = out["artifact_id"]
    # options normalised, instructions trimmed
    assert fake.calls[-1] == (
        "generate",
        ("nb1", "slide_deck", "Tập trung vào lâm sàng", {"slide_format": "presenter_slides", "language": "vi"}),
    )

    # listing + status
    assert aid in [a["id"] for a in client.get("/notebooks/nb1/artifacts").json()]
    assert client.get(f"/notebooks/nb1/artifacts/{aid}").json()["status"] == "in_progress"

    # not ready -> 409
    r = client.get(f"/notebooks/nb1/artifacts/{aid}/download", params={"format": "pptx"})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "artifact_not_ready"

    fake.complete("nb1", aid, PPTX)
    assert client.get(f"/notebooks/nb1/artifacts/{aid}").json()["status"] == "completed"

    r = client.get(f"/notebooks/nb1/artifacts/{aid}/download", params={"format": "pptx"})
    assert r.status_code == 200, r.text
    assert r.content == PPTX
    assert r.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    )
    assert ".pptx" in r.headers["content-disposition"]
    assert r.headers["x-content-type-options"] == "nosniff"
    assert ("download", (aid, "pptx", "pptx")) in fake.calls
    # temp dir removed after streaming
    assert not fake.last_download_dir.exists()
    assert list(settings.tmp_dir.iterdir()) == []


def test_download_default_format_and_alias(client: TestClient, fake: FakeClient) -> None:
    aid = _generate(client, type="slide_deck")["artifact_id"]
    fake.complete("nb1", aid, b"%PDF-1.7")
    r = client.get(f"/notebooks/nb1/artifacts/{aid}/download")
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"

    qid = _generate(client, type="quiz", options={"quantity": "more", "difficulty": "hard"})["artifact_id"]
    fake.complete("nb1", qid, b"# quiz")
    r = client.get(f"/notebooks/nb1/artifacts/{qid}/download", params={"format": "markdown"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/markdown")
    assert ("download", (qid, "md", "markdown")) in fake.calls  # API 'md' -> library 'markdown'


def test_download_errors(client: TestClient, fake: FakeClient) -> None:
    quiz = _generate(client, type="quiz")["artifact_id"]
    audio = _generate(client, type="audio")["artifact_id"]
    fake.complete("nb1", quiz)
    fake.complete("nb1", audio)

    r = client.get(f"/notebooks/nb1/artifacts/{quiz}/download", params={"format": "pdf"})
    assert (r.status_code, r.json()["error"]["code"]) == (400, "unsupported_format")

    r = client.get(f"/notebooks/nb1/artifacts/{quiz}/download", params={"format": "exe"})
    assert (r.status_code, r.json()["error"]["code"]) == (400, "invalid_format")

    # mp3 is requested by the spec but notebooklm-py only produces .m4a -> 501
    r = client.get(f"/notebooks/nb1/artifacts/{audio}/download", params={"format": "mp3"})
    assert (r.status_code, r.json()["error"]["code"]) == (501, "not_supported")
    r = client.get(f"/notebooks/nb1/artifacts/{audio}/download")
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mp4"

    r = client.get("/notebooks/nb1/artifacts/missing/download")
    assert (r.status_code, r.json()["error"]["code"]) == (404, "artifact_not_found")
    assert client.get("/notebooks/nb1/artifacts/missing").status_code == 404


def test_generate_validates_type_and_options(client: TestClient) -> None:
    bad_bodies = [
        {"type": "podcast"},
        {"type": "quiz", "options": {"difficulty": "impossible"}},
        {"type": "quiz", "options": {"slide_format": "detailed_deck"}},  # wrong type's option
        {"type": "audio", "options": {"source_ids": []}},
        {"type": "mind_map", "options": {"style": "x"}},
        {"type": "report", "options": "nope"},
        {"type": "report", "unknown_top_level": 1},
    ]
    for body in bad_bodies:
        r = client.post("/notebooks/nb1/artifacts/generate", json=body)
        assert r.status_code == 422, body
        assert r.json()["error"]["code"] == "invalid_request"


def test_generate_every_type(client: TestClient, fake: FakeClient) -> None:
    for t in ("slide_deck", "report", "quiz", "flashcards", "mind_map", "infographic", "data_table", "audio", "video"):
        out = _generate(client, type=t)
        assert out["type"] == t
    assert len(client.get("/notebooks/nb1/artifacts").json()) == 9
