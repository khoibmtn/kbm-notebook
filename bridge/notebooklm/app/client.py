"""Async facade over ``notebooklm-py``.

* :class:`BridgeClient` - the ``Protocol`` the HTTP layer depends on. Tests inject a
  ``FakeClient`` implementing it; nothing in ``main.py`` touches the library directly.
* :class:`NotebookLMBridgeClient` - the real implementation. It lazily opens one
  long-lived ``NotebookLMClient`` (loaded from ``notebooklm login`` storage), reopens
  it after an authentication failure (so a fresh ``notebooklm login`` is picked up
  without restarting the bridge) and translates library errors to ``BridgeError``.

Only methods that exist in notebooklm-py 0.8.5 are used.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any, Protocol, TypeVar, runtime_checkable

from . import generation
from .errors import (
    BridgeError,
    NotAuthenticated,
    NotFound,
    NotSupported,
    InvalidRequest,
    is_auth_failure,
    translate_exception,
    translate_open_error,
)
from .models import (
    ArtifactOut,
    AskOut,
    GenerationOut,
    NoteOut,
    NotebookOut,
    ProbeResult,
    ReferenceOut,
    ShareOut,
    SharedUserOut,
    SourceOut,
)

logger = logging.getLogger("bridge.client")
T = TypeVar("T")


@runtime_checkable
class BridgeClient(Protocol):
    """Everything the HTTP layer needs from NotebookLM. Implement it to fake the service."""

    async def probe(self) -> ProbeResult: ...

    async def list_notebooks(self) -> list[NotebookOut]: ...
    async def create_notebook(self, title: str) -> NotebookOut: ...
    async def get_notebook(self, notebook_id: str) -> NotebookOut: ...

    async def list_sources(self, notebook_id: str) -> list[SourceOut]: ...
    async def add_text_source(self, notebook_id: str, title: str, text: str) -> SourceOut: ...
    async def add_url_source(
        self, notebook_id: str, url: str, title: str | None = None
    ) -> SourceOut: ...
    async def add_file_source(
        self, notebook_id: str, path: Path, title: str | None = None
    ) -> SourceOut: ...
    async def delete_source(self, notebook_id: str, source_id: str) -> None: ...

    async def ask(
        self,
        notebook_id: str,
        question: str,
        source_ids: list[str] | None = None,
        conversation_id: str | None = None,
    ) -> AskOut: ...

    async def list_notes(self, notebook_id: str) -> list[NoteOut]: ...
    async def create_note(self, notebook_id: str, title: str, content: str) -> NoteOut: ...

    async def list_artifacts(self, notebook_id: str) -> list[ArtifactOut]: ...
    async def get_artifact(self, notebook_id: str, artifact_id: str) -> ArtifactOut | None:
        """Return the artifact, or ``None`` when it is not (yet) listed."""
        ...

    async def generate_artifact(
        self,
        notebook_id: str,
        artifact_type: str,
        instructions: str | None,
        options: dict[str, Any],
    ) -> GenerationOut: ...
    async def download_artifact(
        self,
        notebook_id: str,
        artifact: ArtifactOut,
        fmt: generation.DownloadFormat,
        dest_dir: Path,
    ) -> Path: ...

    async def get_share_status(self, notebook_id: str) -> ShareOut: ...

    async def aclose(self) -> None: ...


# ------------------------------------------------------------------ real implementation
class NotebookLMBridgeClient:
    """``BridgeClient`` backed by ``notebooklm.NotebookLMClient``."""

    def __init__(self, *, profile: str | None = None, keepalive_seconds: float | None = 600.0):
        self._profile = profile
        self._keepalive = keepalive_seconds
        self._lock = asyncio.Lock()
        self._ctx: Any = None
        self._client: Any = None

    # -- lifecycle ---------------------------------------------------------------
    def _new_context(self) -> Any:
        from notebooklm import NotebookLMClient
        from notebooklm.options import ClientConfig, WebBackendConfig, WebSessionOptions

        config = ClientConfig(
            backend=WebBackendConfig(session=WebSessionOptions(keepalive_interval=self._keepalive))
        )
        return NotebookLMClient.from_storage(profile=self._profile, config=config)

    async def _ensure(self) -> Any:
        client = self._client
        if client is not None and client.is_connected():
            return client
        async with self._lock:
            client = self._client
            if client is not None and client.is_connected():
                return client
            await self._close_quietly()
            ctx = self._new_context()
            try:
                client = await ctx.__aenter__()
            except Exception as exc:
                raise translate_open_error(exc) from exc
            self._ctx, self._client = ctx, client
            logger.info("NotebookLM client opened (profile=%s)", self._profile or "default")
            return client

    async def _close_quietly(self) -> None:
        ctx, self._ctx, self._client = self._ctx, None, None
        if ctx is not None:
            try:
                await ctx.__aexit__(None, None, None)
            except Exception:  # pragma: no cover - best effort
                logger.debug("Error while closing NotebookLM client", exc_info=True)

    async def aclose(self) -> None:
        async with self._lock:
            await self._close_quietly()

    async def _run(self, op: Callable[[Any], Awaitable[T]]) -> T:
        client = await self._ensure()
        try:
            return await op(client)
        except BridgeError:
            raise
        except Exception as exc:
            err = translate_exception(exc)
            if is_auth_failure(exc):
                # Drop the session so the next request reloads credentials from disk.
                async with self._lock:
                    if self._client is client:
                        await self._close_quietly()
            raise err from exc

    # -- health ------------------------------------------------------------------
    async def probe(self) -> ProbeResult:
        try:
            await self._run(lambda c: c.notebooks.list())
        except NotAuthenticated as exc:
            return ProbeResult(authenticated=False, detail=exc.message)
        except BridgeError as exc:
            return ProbeResult(authenticated=False, detail=f"{exc.code}: {exc.message}")
        account: str | None = None
        try:
            account = await self._run(lambda c: c.get_account_email())
        except BridgeError:
            logger.debug("Could not resolve account email", exc_info=True)
        return ProbeResult(authenticated=True, account=account)

    # -- notebooks ---------------------------------------------------------------
    async def list_notebooks(self) -> list[NotebookOut]:
        return [_notebook(n) for n in await self._run(lambda c: c.notebooks.list())]

    async def create_notebook(self, title: str) -> NotebookOut:
        return _notebook(await self._run(lambda c: c.notebooks.create(title)))

    async def get_notebook(self, notebook_id: str) -> NotebookOut:
        # NOTE: notebooks.get() bumps the account's "last viewed" time (library behaviour).
        return _notebook(await self._run(lambda c: c.notebooks.get(notebook_id)))

    # -- sources -----------------------------------------------------------------
    async def list_sources(self, notebook_id: str) -> list[SourceOut]:
        return [_source(s) for s in await self._run(lambda c: c.sources.list(notebook_id))]

    async def add_text_source(self, notebook_id: str, title: str, text: str) -> SourceOut:
        return _source(await self._run(lambda c: c.sources.add_text(notebook_id, title, text)))

    async def add_url_source(
        self, notebook_id: str, url: str, title: str | None = None
    ) -> SourceOut:
        return _source(
            await self._run(lambda c: c.sources.add_url(notebook_id, url, title=title))
        )

    async def add_file_source(
        self, notebook_id: str, path: Path, title: str | None = None
    ) -> SourceOut:
        return _source(
            await self._run(lambda c: c.sources.add_file(notebook_id, path, title=title))
        )

    async def delete_source(self, notebook_id: str, source_id: str) -> None:
        # The library treats unknown ids as a silent no-op, so resolve against the list.
        sources = await self._run(lambda c: c.sources.list(notebook_id))
        if all(s.id != source_id for s in sources):
            raise NotFound(f"Source {source_id} not found in notebook.", code="source_not_found")
        await self._run(lambda c: c.sources.delete(notebook_id, source_id))

    # -- chat --------------------------------------------------------------------
    async def ask(
        self,
        notebook_id: str,
        question: str,
        source_ids: list[str] | None = None,
        conversation_id: str | None = None,
    ) -> AskOut:
        result = await self._run(
            lambda c: c.chat.ask(
                notebook_id, question, source_ids=source_ids, conversation_id=conversation_id
            )
        )
        return AskOut(
            answer=result.answer,
            conversation_id=result.conversation_id,
            references=[
                ReferenceOut(
                    source_id=r.source_id,
                    citation_number=r.citation_number,
                    cited_text=r.cited_text,
                    start_char=r.start_char,
                    end_char=r.end_char,
                    score=r.score,
                )
                for r in result.references
            ],
        )

    # -- notes -------------------------------------------------------------------
    async def list_notes(self, notebook_id: str) -> list[NoteOut]:
        return [_note(n) for n in await self._run(lambda c: c.notes.list(notebook_id))]

    async def create_note(self, notebook_id: str, title: str, content: str) -> NoteOut:
        return _note(await self._run(lambda c: c.notes.create(notebook_id, title, content)))

    # -- artifacts ---------------------------------------------------------------
    async def list_artifacts(self, notebook_id: str) -> list[ArtifactOut]:
        return [_artifact(a) for a in await self._run(lambda c: c.artifacts.list(notebook_id))]

    async def get_artifact(self, notebook_id: str, artifact_id: str) -> ArtifactOut | None:
        from notebooklm.types import ArtifactLookupStatus

        lookup = await self._run(lambda c: c.artifacts.lookup(notebook_id, artifact_id))
        if lookup.status == ArtifactLookupStatus.FOUND and lookup.artifact is not None:
            return _artifact(lookup.artifact)
        return None

    async def generate_artifact(
        self,
        notebook_id: str,
        artifact_type: str,
        instructions: str | None,
        options: dict[str, Any],
    ) -> GenerationOut:
        return await self._run(
            lambda c: _generate(c, notebook_id, artifact_type, instructions, options)
        )

    async def download_artifact(
        self,
        notebook_id: str,
        artifact: ArtifactOut,
        fmt: generation.DownloadFormat,
        dest_dir: Path,
    ) -> Path:
        out = dest_dir / f"artifact{fmt.extension}"
        returned = await self._run(
            lambda c: _download(c, notebook_id, artifact.id, artifact.type, fmt, str(out))
        )
        path = Path(returned) if returned else out
        return path if path.exists() else out

    # -- sharing -----------------------------------------------------------------
    async def get_share_status(self, notebook_id: str) -> ShareOut:
        from notebooklm.types import share_permission_to_str

        status = await self._run(lambda c: c.sharing.get_status(notebook_id))
        return ShareOut(
            notebook_id=status.notebook_id,
            is_public=status.is_public,
            access=status.access.name.lower(),
            view_level=status.view_level.name.lower(),
            share_url=status.share_url,
            shared_users=[
                SharedUserOut(
                    email=u.email,
                    permission=share_permission_to_str(u.permission),
                    display_name=u.display_name,
                )
                for u in status.shared_users
            ],
            max_individuals_share_limit=status.max_individuals_share_limit,
            is_public_sharing_allowed=status.is_public_sharing_allowed,
        )


# ------------------------------------------------------------------ converters
def _notebook(nb: Any) -> NotebookOut:
    return NotebookOut(
        id=nb.id,
        title=nb.title or "",
        source_count=nb.sources_count or 0,
        updated_at=nb.last_viewed_at or nb.created_at,
        created_at=nb.created_at,
    )


def _source(src: Any) -> SourceOut:
    from notebooklm.types import source_status_to_str

    return SourceOut(
        id=src.id,
        title=src.title,
        kind=src.kind.value,
        status=source_status_to_str(src.status),
        url=src.url,
    )


def _note(note: Any) -> NoteOut:
    return NoteOut(id=note.id, title=note.title, content=note.content, created_at=note.created_at)


def _artifact(art: Any) -> ArtifactOut:
    return ArtifactOut(
        id=art.id,
        title=art.title,
        type=art.kind.value,
        status=art.status_str,
        created_at=art.created_at,
        source_ids=list(art.source_ids),
    )


def _enum(cls: Any, name: str | None) -> Any:
    return None if name is None else cls[name.upper()]


def _generation(kind: str, status: Any) -> GenerationOut:
    return GenerationOut(
        task_id=status.task_id,
        artifact_id=status.task_id,
        type=kind,
        status=str(getattr(status.status, "value", status.status)),
        error=status.error,
    )


async def _generate(
    c: Any, nb: str, kind: str, instructions: str | None, options: dict[str, Any]
) -> GenerationOut:
    """Dispatch to the matching ``client.artifacts.generate_*`` method."""
    from notebooklm import types as t

    a = c.artifacts
    sources = options.get("source_ids")
    # language=None -> notebooklm-py's configured default language
    language = options.get("language")

    if kind == "slide_deck":
        st = await a.generate_slide_deck(
            nb,
            source_ids=sources,
            language=language,
            instructions=instructions,
            slide_format=_enum(t.SlideDeckFormat, options.get("slide_format")),
            slide_length=_enum(t.SlideDeckLength, options.get("slide_length")),
        )
    elif kind == "report":
        fmt = t.ReportFormat(options.get("report_format", "briefing_doc"))
        custom = fmt == t.ReportFormat.CUSTOM
        st = await a.generate_report(
            nb,
            report_format=fmt,
            source_ids=sources,
            language=language,
            custom_prompt=instructions if custom else None,
            extra_instructions=None if custom else instructions,
        )
    elif kind in ("quiz", "flashcards"):
        fn = a.generate_quiz if kind == "quiz" else a.generate_flashcards
        st = await fn(
            nb,
            source_ids=sources,
            instructions=instructions,
            quantity=_enum(t.QuizQuantity, options.get("quantity")),
            difficulty=_enum(t.QuizDifficulty, options.get("difficulty")),
        )
    elif kind == "mind_map":
        result = await a.generate_mind_map(
            nb, source_ids=sources, language=language, instructions=instructions
        )
        if not result.note_id:
            raise BridgeError(
                "Mind map was generated but NotebookLM did not return an id for it.",
                code="upstream_error",
                status_code=502,
            )
        # Note-backed mind maps are produced synchronously.
        return GenerationOut(
            task_id=result.note_id, artifact_id=result.note_id, type=kind, status="completed"
        )
    elif kind == "infographic":
        st = await a.generate_infographic(
            nb,
            source_ids=sources,
            language=language,
            instructions=instructions,
            orientation=_enum(t.InfographicOrientation, options.get("orientation")),
            detail_level=_enum(t.InfographicDetail, options.get("detail_level")),
            style=_enum(t.InfographicStyle, options.get("style")),
        )
    elif kind == "data_table":
        st = await a.generate_data_table(
            nb, source_ids=sources, language=language, instructions=instructions
        )
    elif kind == "audio":
        st = await a.generate_audio(
            nb,
            source_ids=sources,
            language=language,
            instructions=instructions,
            audio_format=_enum(t.AudioFormat, options.get("audio_format")),
            audio_length=_enum(t.AudioLength, options.get("audio_length")),
        )
    elif kind == "video":
        if options.get("video_format") == "cinematic":
            st = await a.generate_cinematic_video(
                nb, source_ids=sources, language=language, instructions=instructions
            )
        else:
            st = await a.generate_video(
                nb,
                source_ids=sources,
                language=language,
                instructions=instructions,
                video_format=_enum(t.VideoFormat, options.get("video_format")),
                video_style=_enum(t.VideoStyle, options.get("video_style")),
                style_prompt=options.get("style_prompt"),
            )
    else:  # pragma: no cover - guarded by the request model
        raise InvalidRequest(f"Unsupported artifact type: {kind}")
    return _generation(kind, st)


async def _download(
    c: Any, nb: str, artifact_id: str, kind: str, fmt: generation.DownloadFormat, out: str
) -> str:
    a = c.artifacts
    if kind == "audio":
        return await a.download_audio(nb, out, artifact_id)
    if kind == "video":
        return await a.download_video(nb, out, artifact_id)
    if kind == "slide_deck":
        return await a.download_slide_deck(nb, out, artifact_id, output_format=fmt.library_format)
    if kind == "infographic":
        return await a.download_infographic(nb, out, artifact_id)
    if kind == "report":
        return await a.download_report(nb, out, artifact_id)
    if kind == "mind_map":
        return await a.download_mind_map(nb, out, artifact_id)
    if kind == "data_table":
        return await a.download_data_table(nb, out, artifact_id)
    if kind == "quiz":
        return await a.download_quiz(nb, out, artifact_id, output_format=fmt.library_format)
    if kind == "flashcards":
        return await a.download_flashcards(nb, out, artifact_id, output_format=fmt.library_format)
    raise NotSupported(f"Downloading artifacts of type '{kind}' is not supported.")
