from __future__ import annotations

import io

from fastapi.testclient import TestClient

from tests.fakes import FakeClient


def test_list_notebooks(client: TestClient) -> None:
    r = client.get("/notebooks")
    assert r.status_code == 200
    assert r.json() == [
        {
            "id": "nb1",
            "title": "Giải phẫu học",
            "source_count": 2,
            "updated_at": None,
            "created_at": None,
        }
    ]


def test_list_notebooks_not_authenticated_is_503(client: TestClient, fake: FakeClient) -> None:
    fake.authenticated = False
    r = client.get("/notebooks")
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "not_authenticated"


def test_create_notebook_and_validation(client: TestClient) -> None:
    r = client.post("/notebooks", json={"title": "  Sinh lý  "})
    assert r.status_code == 201
    assert r.json()["title"] == "Sinh lý"
    for bad in ({}, {"title": ""}, {"title": "   "}, {"title": "x", "extra": 1}):
        r = client.post("/notebooks", json=bad)
        assert r.status_code == 422, bad
        assert r.json()["error"]["code"] == "invalid_request"


def test_get_notebook_with_sources_and_404(client: TestClient) -> None:
    r = client.get("/notebooks/nb1")
    assert r.status_code == 200
    body = r.json()
    assert body["source_count"] == 2
    assert [s["id"] for s in body["sources"]] == ["s1", "s2"]
    assert set(body["sources"][0]) == {"id", "title", "kind", "status", "url"}
    missing = client.get("/notebooks/zzz")
    assert missing.status_code == 404
    assert missing.json() == {
        "error": {"code": "notebook_not_found", "message": "Notebook zzz not found"}
    }


def test_add_text_source(client: TestClient, fake: FakeClient) -> None:
    r = client.post(
        "/notebooks/nb1/sources", json={"type": "text", "title": "Ghi chú", "text": "Nội dung dài"}
    )
    assert r.status_code == 201
    body = r.json()
    assert body["title"] == "Ghi chú"
    assert body["kind"] == "pasted_text"
    assert body["status"] == "processing"
    assert ("add_text", ("nb1", "Ghi chú", "Nội dung dài")) in fake.calls
    listed = client.get("/notebooks/nb1/sources").json()
    assert body["id"] in [s["id"] for s in listed]


def test_add_url_source(client: TestClient) -> None:
    r = client.post("/notebooks/nb1/sources", json={"type": "url", "url": "https://example.com/a"})
    assert r.status_code == 201
    assert r.json()["url"] == "https://example.com/a"


def test_add_source_validation(client: TestClient) -> None:
    cases = [
        {"type": "url", "url": "ftp://example.com"},
        {"type": "url", "url": "javascript:alert(1)"},
        {"type": "text", "title": "x"},
        {"type": "text", "title": "x", "text": "   "},
        {"type": "nope"},
        {"title": "x", "text": "y"},
        [],
    ]
    for body in cases:
        r = client.post("/notebooks/nb1/sources", json=body)
        assert r.status_code == 422, body
        assert r.json()["error"]["code"] == "invalid_request"
    r = client.post("/notebooks/nb1/sources", content=b"{not json", headers={"Content-Type": "application/json"})
    assert r.status_code == 422
    r = client.post("/notebooks/nb1/sources", content=b"hi", headers={"Content-Type": "text/plain"})
    assert r.status_code == 415
    assert r.json()["error"]["code"] == "unsupported_media_type"


def test_upload_file_source(client: TestClient, fake: FakeClient) -> None:
    r = client.post(
        "/notebooks/nb1/sources",
        files={"file": ("../../etc/bài giảng.pdf", io.BytesIO(b"%PDF-1.4 hello"), "application/pdf")},
        data={"title": "Bài giảng"},
    )
    assert r.status_code == 201, r.text
    name, content, title = fake.uploaded[0]
    assert content == b"%PDF-1.4 hello"
    assert title == "Bài giảng"
    assert "/" not in name and ".." not in name and name.endswith(".pdf")


def test_upload_requires_file_field_and_nonempty(client: TestClient) -> None:
    r = client.post("/notebooks/nb1/sources", files={"other": ("a.txt", b"x")})
    assert r.status_code == 422
    r = client.post("/notebooks/nb1/sources", files={"file": ("a.txt", b"")})
    assert r.status_code == 422


def test_upload_cleans_temp_dir(client: TestClient, settings) -> None:
    client.post("/notebooks/nb1/sources", files={"file": ("a.txt", b"hello")})
    assert list(settings.tmp_dir.iterdir()) == []


def test_upload_size_limit_declared_length(client: TestClient, settings) -> None:
    big = b"x" * (settings.max_upload_bytes + 1)
    r = client.post("/notebooks/nb1/sources", files={"file": ("big.txt", big)})
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "payload_too_large"


def test_upload_size_limit_chunked_without_content_length(client: TestClient, settings) -> None:
    def gen():
        for _ in range(8):
            yield b"y" * (settings.max_upload_bytes // 4)

    r = client.post(
        "/notebooks/nb1/sources",
        content=gen(),  # no Content-Length -> chunked transfer encoding
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "payload_too_large"


def test_delete_source(client: TestClient) -> None:
    assert client.delete("/notebooks/nb1/sources/s1").status_code == 204
    assert [s["id"] for s in client.get("/notebooks/nb1/sources").json()] == ["s2"]
    r = client.delete("/notebooks/nb1/sources/nope")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "source_not_found"


def test_notes(client: TestClient) -> None:
    r = client.post("/notebooks/nb1/notes", json={"title": "Tóm tắt", "content": "Nội dung"})
    assert r.status_code == 201
    assert r.json()["title"] == "Tóm tắt"
    notes = client.get("/notebooks/nb1/notes").json()
    assert [n["content"] for n in notes] == ["Nội dung"]


def test_share_status(client: TestClient) -> None:
    r = client.get("/notebooks/nb1/share")
    assert r.status_code == 200
    body = r.json()
    assert body["is_public"] is False
    assert body["access"] == "restricted"
    assert body["shared_users"][0]["permission"] == "owner"


def test_unknown_route_and_method_use_error_envelope(client: TestClient) -> None:
    r = client.get("/nope")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    r = client.put("/notebooks")
    assert r.status_code == 405 and r.json()["error"]["code"] == "method_not_allowed"


def test_source_fulltext(client: TestClient, fake: FakeClient) -> None:
    fake.fulltexts["s1"] = "Tim có bốn buồng.\n\nHai tâm nhĩ và hai tâm thất."
    r = client.get("/notebooks/nb1/sources/s1/fulltext")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"source_id", "title", "kind", "url", "text", "char_count"}
    assert body["source_id"] == "s1"
    assert body["text"] == fake.fulltexts["s1"]
    assert body["char_count"] == len(fake.fulltexts["s1"])


def test_source_fulltext_errors(client: TestClient, fake: FakeClient) -> None:
    missing_source = client.get("/notebooks/nb1/sources/nope/fulltext")
    assert missing_source.status_code == 404
    assert missing_source.json()["error"]["code"] == "source_not_found"
    missing_nb = client.get("/notebooks/zzz/sources/s1/fulltext")
    assert missing_nb.status_code == 404
    assert missing_nb.json()["error"]["code"] == "notebook_not_found"


def test_source_fulltext_requires_token(anon: TestClient) -> None:
    assert anon.get("/notebooks/nb1/sources/s1/fulltext").status_code == 401
