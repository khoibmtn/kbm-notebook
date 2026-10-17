"""Error mapping + guards that keep our static tables in sync with the installed library."""

from __future__ import annotations

import notebooklm as nlm
import pytest
from notebooklm import downloads, types as t

from app import generation
from app.errors import translate_exception


@pytest.mark.parametrize(
    ("exc", "status", "code"),
    [
        (nlm.AuthError("expired"), 503, "not_authenticated"),
        (nlm.AuthExtractionError("no tokens", payload_preview=""), 503, "not_authenticated"),
        (nlm.NotebookNotFoundError("n1"), 404, "notebook_not_found"),
        (nlm.SourceNotFoundError("s1"), 404, "source_not_found"),
        (nlm.ArtifactNotFoundError("a1"), 404, "artifact_not_found"),
        (nlm.RateLimitError("slow down", retry_after=30), 429, "rate_limited"),
        (nlm.RPCTimeoutError("timed out"), 504, "timeout"),
        (nlm.NetworkError("dns"), 502, "network_error"),
        (nlm.ServerError("boom", status_code=503), 502, "upstream_error"),
        (nlm.ClientError("bad", status_code=400), 502, "upstream_rejected"),
        (nlm.DecodingError("shape changed"), 502, "upstream_changed"),
        (nlm.ValidationError("unsupported file type"), 400, "invalid_request"),
        (nlm.UnsupportedOperationError("android only"), 501, "not_supported"),
        (nlm.ChatError("no answer"), 502, "chat_failed"),
        (nlm.NotebookLMError("generic"), 502, "upstream_error"),
        (RuntimeError("secret internals"), 500, "internal_error"),
    ],
)
def test_translate_exception(exc: BaseException, status: int, code: str) -> None:
    err = translate_exception(exc)
    assert (err.status_code, err.code) == (status, code)
    assert "secret internals" not in err.message


def test_rate_limit_carries_retry_after() -> None:
    err = translate_exception(nlm.RateLimitError("slow", retry_after=30))
    assert err.headers == {"Retry-After": "30"}
    assert err.to_body()["error"]["retry_after"] == 30


def test_library_error_escaping_a_route_is_mapped(client, fake) -> None:
    async def explode():
        raise nlm.AuthError("cookies expired")

    fake.list_notebooks = explode  # type: ignore[method-assign]
    r = client.get("/notebooks")
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "not_authenticated"


def test_unexpected_exception_is_a_clean_500(client, fake) -> None:
    async def explode():
        raise RuntimeError("do not leak me")

    fake.list_notebooks = explode  # type: ignore[method-assign]
    r = client.get("/notebooks")
    assert r.status_code == 500
    assert r.json() == {"error": {"code": "internal_error", "message": "Internal error."}}


def _enum_names(cls) -> set[str]:
    return {m.name.lower() for m in cls}


def test_option_tables_match_library_enums() -> None:
    mapping = {
        ("slide_deck", "slide_format"): t.SlideDeckFormat,
        ("slide_deck", "slide_length"): t.SlideDeckLength,
        ("report", "report_format"): t.ReportFormat,
        ("quiz", "quantity"): t.QuizQuantity,
        ("quiz", "difficulty"): t.QuizDifficulty,
        ("flashcards", "quantity"): t.QuizQuantity,
        ("flashcards", "difficulty"): t.QuizDifficulty,
        ("infographic", "orientation"): t.InfographicOrientation,
        ("infographic", "detail_level"): t.InfographicDetail,
        ("infographic", "style"): t.InfographicStyle,
        ("audio", "audio_format"): t.AudioFormat,
        ("audio", "audio_length"): t.AudioLength,
        ("video", "video_format"): t.VideoFormat,
        ("video", "video_style"): t.VideoStyle,
    }
    for (kind, option), enum_cls in mapping.items():
        ours = set(generation.ENUM_OPTIONS[kind][option])
        theirs = {m.name.lower() if not isinstance(m.value, str) else m.value for m in enum_cls}
        assert ours == theirs, (kind, option)


def test_download_table_matches_library_registry() -> None:
    by_kind = {e.kind.value: e for e in downloads.DOWNLOAD_REGISTRY}
    assert set(generation.DOWNLOADS) == set(by_kind)
    for kind, (default, formats) in generation.DOWNLOADS.items():
        entry = by_kind[kind]
        lib_formats = dict(entry.formats) or {entry.default_output.extension.lstrip("."): entry.default_output}
        assert default == (entry.format_default or entry.default_output.extension.lstrip("."))
        for fmt in formats.values():
            # find the library representation by output extension / name
            candidates = [s for n, s in lib_formats.items() if s.extension == fmt.extension]
            assert candidates, (kind, fmt.name)
            assert candidates[0].mime_type == fmt.mime, (kind, fmt.name)
            if fmt.library_format is not None:
                assert fmt.library_format in lib_formats, (kind, fmt.library_format)
        assert len(formats) == len(lib_formats), kind


def test_every_spec_artifact_type_is_generatable() -> None:
    from app.models import GenerateArtifactIn
    import typing

    spec = {"slide_deck", "report", "quiz", "flashcards", "mind_map", "infographic", "data_table", "audio", "video"}
    declared = set(typing.get_args(GenerateArtifactIn.model_fields["type"].annotation))
    assert declared == spec == set(generation.ENUM_OPTIONS)
