"""Exercises ``NotebookLMBridgeClient`` against *signature-checked* stand-ins.

We cannot log in to Google here, so every namespace of the real library client is replaced
by ``create_autospec`` of the real ``notebooklm-py`` API class: a call with a wrong method
name or keyword argument raises ``TypeError``/``AttributeError`` - this pins our code to the
installed library's real signatures.
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, create_autospec

import pytest
from notebooklm import _artifacts, _chat, _notebooks, _notes, _sharing, _sources, types as t

from app import generation
from app.client import BridgeClient, NotebookLMBridgeClient
from app.errors import BridgeError, InvalidRequest, NotAuthenticated, NotFound, NotSupported
from tests.fakes import FakeClient

NOW = dt.datetime(2026, 10, 1, tzinfo=dt.timezone.utc)


def make_lib() -> SimpleNamespace:
    lib = SimpleNamespace(
        notebooks=create_autospec(_notebooks.NotebooksAPI, instance=True),
        sources=create_autospec(_sources.SourcesAPI, instance=True),
        chat=create_autospec(_chat.ChatAPI, instance=True),
        notes=create_autospec(_notes.NotesAPI, instance=True),
        artifacts=create_autospec(_artifacts.ArtifactsAPI, instance=True),
        sharing=create_autospec(_sharing.SharingAPI, instance=True),
        is_connected=lambda: True,
        get_account_email=AsyncMock(return_value="me@example.com"),
    )
    return lib


@pytest.fixture
def lib() -> SimpleNamespace:
    return make_lib()


@pytest.fixture
def bridge(lib: SimpleNamespace) -> NotebookLMBridgeClient:
    b = NotebookLMBridgeClient()
    b._client = lib  # already "open"
    return b


def test_protocol_conformance() -> None:
    assert isinstance(FakeClient(), BridgeClient)
    assert isinstance(NotebookLMBridgeClient(), BridgeClient)


async def test_notebooks_and_sources(bridge, lib) -> None:
    lib.notebooks.list.return_value = [
        t.Notebook(id="n1", title="A", sources_count=3, created_at=NOW, last_viewed_at=NOW),
        t.Notebook(id="n2", title="B", created_at=NOW),
    ]
    out = await bridge.list_notebooks()
    assert [(n.id, n.source_count, n.updated_at) for n in out] == [("n1", 3, NOW), ("n2", 0, NOW)]

    lib.notebooks.create.return_value = t.Notebook(id="n3", title="C")
    assert (await bridge.create_notebook("C")).id == "n3"
    lib.notebooks.create.assert_awaited_once_with("C")

    src = t.Source(id="s1", title="Doc", url="https://x", _type_code=5, status=t.SourceStatus.READY)
    lib.sources.list.return_value = [src]
    [s] = await bridge.list_sources("n1")
    assert (s.id, s.kind, s.status, s.url) == ("s1", "web_page", "ready", "https://x")

    lib.sources.add_text.return_value = src
    await bridge.add_text_source("n1", "T", "body")
    lib.sources.add_text.assert_awaited_once_with("n1", "T", "body")
    lib.sources.add_url.return_value = src
    await bridge.add_url_source("n1", "https://x", "Title")
    lib.sources.add_url.assert_awaited_once_with("n1", "https://x", title="Title")
    lib.sources.add_file.return_value = src
    await bridge.add_file_source("n1", Path("/tmp/a.pdf"), "Title")
    lib.sources.add_file.assert_awaited_once_with("n1", Path("/tmp/a.pdf"), title="Title")


async def test_delete_source_checks_existence(bridge, lib) -> None:
    lib.sources.list.return_value = [t.Source(id="s1")]
    with pytest.raises(NotFound) as ei:
        await bridge.delete_source("n1", "zzz")
    assert ei.value.code == "source_not_found"
    lib.sources.delete.assert_not_awaited()
    await bridge.delete_source("n1", "s1")
    lib.sources.delete.assert_awaited_once_with("n1", "s1")


async def test_ask_maps_answer_and_references(bridge, lib) -> None:
    lib.chat.ask.return_value = t.AskResult(
        answer="Tim [1]",
        conversation_id="c1",
        turn_number=1,
        is_follow_up=False,
        references=[
            t.ChatReference(
                source_id="s1", citation_number=1, cited_text="abc", start_char=3, end_char=6, score=0.7
            )
        ],
    )
    out = await bridge.ask("n1", "q?", ["s1"], "c0")
    lib.chat.ask.assert_awaited_once_with("n1", "q?", source_ids=["s1"], conversation_id="c0")
    assert out.conversation_id == "c1"
    ref = out.references[0]
    assert (ref.source_id, ref.citation_number, ref.cited_text, ref.start_char, ref.end_char, ref.score) == (
        "s1", 1, "abc", 3, 6, 0.7,
    )


async def test_notes_and_share(bridge, lib) -> None:
    note = t.Note(id="nt1", notebook_id="n1", title="T", content="C")
    lib.notes.list.return_value = [note]
    lib.notes.create.return_value = note
    assert (await bridge.list_notes("n1"))[0].content == "C"
    await bridge.create_note("n1", "T", "C")
    lib.notes.create.assert_awaited_once_with("n1", "T", "C")

    lib.sharing.get_status.return_value = t.ShareStatus(
        notebook_id="n1",
        is_public=True,
        access=t.ShareAccess.ANYONE_WITH_LINK,
        view_level=t.ShareViewLevel.CHAT_ONLY,
        shared_users=[t.SharedUser(email="a@b.c", permission=t.SharePermission.OWNER)],
        share_url="https://notebooklm.google.com/notebook/n1",
    )
    share = await bridge.get_share_status("n1")
    assert (share.access, share.view_level, share.shared_users[0].permission) == (
        "anyone_with_link", "chat_only", "owner",
    )


def _status(task="task-1", state="pending"):
    return t.GenerationStatus(task_id=task, status=state)


@pytest.mark.parametrize(
    ("kind", "method", "options", "expected"),
    [
        ("slide_deck", "generate_slide_deck", {"slide_format": "presenter_slides", "slide_length": "short", "language": "vi"},
         {"slide_format": t.SlideDeckFormat.PRESENTER_SLIDES, "slide_length": t.SlideDeckLength.SHORT, "language": "vi"}),
        ("quiz", "generate_quiz", {"quantity": "more", "difficulty": "hard"},
         {"quantity": t.QuizQuantity.MORE, "difficulty": t.QuizDifficulty.HARD}),
        ("flashcards", "generate_flashcards", {"quantity": "fewer"}, {"quantity": t.QuizQuantity.FEWER}),
        ("infographic", "generate_infographic", {"orientation": "square", "detail_level": "concise", "style": "clay"},
         {"orientation": t.InfographicOrientation.SQUARE, "detail_level": t.InfographicDetail.CONCISE, "style": t.InfographicStyle.CLAY}),
        ("data_table", "generate_data_table", {}, {}),
        ("audio", "generate_audio", {"audio_format": "debate", "audio_length": "long"},
         {"audio_format": t.AudioFormat.DEBATE, "audio_length": t.AudioLength.LONG}),
        ("video", "generate_video", {"video_format": "explainer", "video_style": "whiteboard", "style_prompt": "x"},
         {"video_format": t.VideoFormat.EXPLAINER, "video_style": t.VideoStyle.WHITEBOARD, "style_prompt": "x"}),
    ],
)
async def test_generate_dispatch(bridge, lib, kind, method, options, expected) -> None:
    getattr(lib.artifacts, method).return_value = _status()
    out = await bridge.generate_artifact("n1", kind, "be brief", generation.validate_options(kind, options))
    assert (out.task_id, out.artifact_id, out.type, out.status) == ("task-1", "task-1", kind, "pending")
    call = getattr(lib.artifacts, method).await_args
    assert call.args == ("n1",)
    assert call.kwargs["instructions"] == "be brief"
    for key, value in expected.items():
        assert call.kwargs[key] == value, key


async def test_generate_report_and_cinematic_and_mind_map(bridge, lib) -> None:
    lib.artifacts.generate_report.return_value = _status()
    await bridge.generate_artifact("n1", "report", "focus", {"report_format": "study_guide"})
    kw = lib.artifacts.generate_report.await_args.kwargs
    assert kw["report_format"] is t.ReportFormat.STUDY_GUIDE
    assert (kw["extra_instructions"], kw["custom_prompt"]) == ("focus", None)

    await bridge.generate_artifact("n1", "report", "write this", {"report_format": "custom"})
    kw = lib.artifacts.generate_report.await_args.kwargs
    assert (kw["extra_instructions"], kw["custom_prompt"]) == (None, "write this")

    lib.artifacts.generate_cinematic_video.return_value = _status("v1")
    out = await bridge.generate_artifact("n1", "video", None, {"video_format": "cinematic"})
    assert out.task_id == "v1"

    lib.artifacts.generate_mind_map.return_value = t.MindMapResult(mind_map={"name": "x"}, note_id="mm1")
    out = await bridge.generate_artifact("n1", "mind_map", None, {})
    assert (out.artifact_id, out.status) == ("mm1", "completed")

    lib.artifacts.generate_mind_map.return_value = t.MindMapResult(mind_map=None, note_id=None)
    with pytest.raises(BridgeError):
        await bridge.generate_artifact("n1", "mind_map", None, {})


async def test_artifact_listing_and_lookup(bridge, lib) -> None:
    art = t.Artifact(
        id="a1", title="Deck", _artifact_type=8, status=3, created_at=NOW, source_ids=("s1", "s2")
    )
    lib.artifacts.list.return_value = [art]
    [out] = await bridge.list_artifacts("n1")
    assert (out.id, out.type, out.status, out.source_ids) == ("a1", "slide_deck", "completed", ["s1", "s2"])

    lib.artifacts.lookup.return_value = t.ArtifactLookup(status=t.ArtifactLookupStatus.FOUND, artifact=art)
    assert (await bridge.get_artifact("n1", "a1")).id == "a1"
    lib.artifacts.lookup.return_value = t.ArtifactLookup(status=t.ArtifactLookupStatus.MISSING)
    assert await bridge.get_artifact("n1", "zz") is None
    lib.artifacts.lookup.return_value = t.ArtifactLookup(status=t.ArtifactLookupStatus.UNKNOWN)
    assert await bridge.get_artifact("n1", "zz") is None


@pytest.mark.parametrize(
    ("kind", "fmt", "method", "kwargs"),
    [
        ("audio", None, "download_audio", {}),
        ("video", None, "download_video", {}),
        ("slide_deck", "pptx", "download_slide_deck", {"output_format": "pptx"}),
        ("slide_deck", None, "download_slide_deck", {"output_format": "pdf"}),
        ("infographic", None, "download_infographic", {}),
        ("report", None, "download_report", {}),
        ("mind_map", None, "download_mind_map", {}),
        ("data_table", None, "download_data_table", {}),
        ("quiz", "md", "download_quiz", {"output_format": "markdown"}),
        ("flashcards", "html", "download_flashcards", {"output_format": "html"}),
    ],
)
async def test_download_dispatch(bridge, lib, tmp_path, kind, fmt, method, kwargs) -> None:
    resolved = generation.resolve_download_format(kind, fmt)

    async def fake_download(nb, out, artifact_id=None, **kw):
        Path(out).write_bytes(b"data")
        return out

    mock = getattr(lib.artifacts, method)
    mock.side_effect = fake_download
    art = SimpleNamespace(id="a1", type=kind)
    path = await bridge.download_artifact("n1", art, resolved, tmp_path)  # type: ignore[arg-type]
    assert path.read_bytes() == b"data" and path.suffix == resolved.extension
    call = mock.await_args
    assert call.args[0] == "n1" and call.args[2] == "a1"
    assert call.kwargs == kwargs


async def test_download_unsupported_kind(bridge, tmp_path) -> None:
    fmt = generation.DownloadFormat("x", ".x", "application/x")
    with pytest.raises(NotSupported):
        await bridge.download_artifact("n1", SimpleNamespace(id="a", type="fantasy_map"), fmt, tmp_path)  # type: ignore[arg-type]


async def test_probe_reports_auth_state(bridge, lib) -> None:
    lib.notebooks.list.return_value = []
    result = await bridge.probe()
    assert (result.authenticated, result.account) == (True, "me@example.com")

    from notebooklm import AuthError

    lib.notebooks.list.side_effect = AuthError("session expired")
    result = await bridge.probe()
    assert result.authenticated is False and "notebooklm login" in result.detail
    # session dropped so that the next call reloads credentials from disk
    assert bridge._client is None


async def test_library_errors_are_translated(bridge, lib) -> None:
    from notebooklm import NotebookNotFoundError

    lib.notebooks.get.side_effect = NotebookNotFoundError("nb-x")
    with pytest.raises(NotFound) as ei:
        await bridge.get_notebook("nb-x")
    assert ei.value.code == "notebook_not_found"


async def test_not_logged_in_real_open_path(monkeypatch, tmp_path) -> None:
    """With an empty NOTEBOOKLM_HOME the *real* library raises -> 503 not_authenticated."""
    monkeypatch.setenv("NOTEBOOKLM_HOME", str(tmp_path / "empty-home"))
    monkeypatch.delenv("NOTEBOOKLM_AUTH_JSON", raising=False)
    monkeypatch.delenv("NOTEBOOKLM_PROFILE", raising=False)
    b = NotebookLMBridgeClient(profile="does-not-exist", keepalive_seconds=600)
    with pytest.raises(NotAuthenticated) as ei:
        await b.list_notebooks()
    assert ei.value.status_code == 503 and ei.value.code == "not_authenticated"
    probe = await b.probe()
    assert probe.authenticated is False
    await b.aclose()


def test_request_validation_errors_are_bridge_errors() -> None:
    with pytest.raises(InvalidRequest):
        generation.validate_options("quiz", {"nope": 1})
