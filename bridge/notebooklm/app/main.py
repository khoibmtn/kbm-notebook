"""FastAPI application: ``uvicorn app.main:app --port 8765``."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import shutil
import tempfile
import time
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any

import notebooklm
from fastapi import APIRouter, FastAPI, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import TypeAdapter, ValidationError
from starlette.background import BackgroundTask
from starlette.datastructures import UploadFile

from . import __version__
from .auth import BearerAuthMiddleware
from .client import BridgeClient, NotebookLMBridgeClient
from .config import Settings
from .errors import (
    BridgeError,
    Conflict,
    InvalidRequest,
    NotFound,
    install_error_handlers,
)
from .generation import resolve_download_format, validate_options
from .limits import BodySizeLimitMiddleware
from .models import (
    AddSourceIn,
    AddTextSourceIn,
    ArtifactOut,
    AskIn,
    AskOut,
    CreateNoteIn,
    CreateNotebookIn,
    FulltextOut,
    GenerateArtifactIn,
    GenerationOut,
    HealthOut,
    NoteOut,
    NotebookDetailOut,
    NotebookOut,
    ProbeResult,
    ShareOut,
    SourceOut,
)

logger = logging.getLogger("bridge")

_ADD_SOURCE_ADAPTER: TypeAdapter[Any] = TypeAdapter(AddSourceIn)


# ----------------------------------------------------------------------------- helpers
class HealthCache:
    """Caches the (network) authentication probe for ``ttl`` seconds."""

    def __init__(self, client: BridgeClient, ttl: float, clock: Callable[[], float]) -> None:
        self._client, self._ttl, self._clock = client, ttl, clock
        self._value: ProbeResult | None = None
        self._at = 0.0
        self._lock = asyncio.Lock()

    async def get(self, refresh: bool = False) -> ProbeResult:
        if not refresh and self._fresh():
            return self._value  # type: ignore[return-value]
        async with self._lock:
            if not refresh and self._fresh():
                return self._value  # type: ignore[return-value]
            try:
                value = await self._client.probe()
            except Exception as exc:  # the probe must never take /health down
                logger.warning("Health probe failed: %s", exc)
                value = ProbeResult(authenticated=False, detail=f"probe failed: {type(exc).__name__}")
            self._value, self._at = value, self._clock()
            return value

    def _fresh(self) -> bool:
        return self._value is not None and (self._clock() - self._at) < self._ttl


def _safe_name(name: str | None, fallback: str, limit: int = 100) -> str:
    cleaned = re.sub(r"[^\w\-. ]+", "_", Path(name or "").name, flags=re.UNICODE).strip(" ._")
    return (cleaned or fallback)[:limit]


def _validation_text(exc: ValidationError) -> str:
    parts = []
    for item in exc.errors(include_input=False, include_url=False)[:5]:
        loc = ".".join(str(p) for p in item["loc"])
        parts.append(f"{loc or 'body'}: {item['msg']}")
    return "; ".join(parts)


def _copy_upload(src: Any, dest: Path) -> int:
    with dest.open("wb") as out:
        shutil.copyfileobj(src, out, length=1024 * 1024)
    return dest.stat().st_size


def _client(request: Request) -> BridgeClient:
    return request.app.state.client


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _mkdtemp(settings: Settings, prefix: str) -> Path:
    if settings.tmp_dir is not None:
        settings.tmp_dir.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix=prefix, dir=settings.tmp_dir))


# ----------------------------------------------------------------------------- routes
router = APIRouter()

_ADD_SOURCE_OPENAPI: dict[str, Any] = {
    "requestBody": {
        "required": True,
        "content": {
            "application/json": {
                "schema": {
                    "oneOf": [
                        {"$ref": "#/components/schemas/AddTextSourceIn"},
                        {"$ref": "#/components/schemas/AddUrlSourceIn"},
                    ]
                }
            },
            "multipart/form-data": {
                "schema": {
                    "type": "object",
                    "required": ["file"],
                    "properties": {
                        "file": {"type": "string", "format": "binary"},
                        "title": {"type": "string"},
                    },
                }
            },
        },
    }
}


@router.get("/health", response_model=HealthOut, response_model_exclude_none=True)
async def health(request: Request, refresh: bool = False) -> HealthOut:
    probe = await request.app.state.health.get(refresh)
    return HealthOut(
        ok=True,
        version=__version__,
        notebooklm_py_version=notebooklm.__version__,
        authenticated=probe.authenticated,
        account=probe.account,
        detail=None if probe.authenticated else probe.detail,
    )


@router.get("/notebooks", response_model=list[NotebookOut])
async def list_notebooks(request: Request) -> list[NotebookOut]:
    return await _client(request).list_notebooks()


@router.post("/notebooks", response_model=NotebookOut, status_code=201)
async def create_notebook(body: CreateNotebookIn, request: Request) -> NotebookOut:
    return await _client(request).create_notebook(body.title)


@router.get("/notebooks/{notebook_id}", response_model=NotebookDetailOut)
async def get_notebook(notebook_id: str, request: Request) -> NotebookDetailOut:
    client = _client(request)
    notebook, sources = await asyncio.gather(
        client.get_notebook(notebook_id), client.list_sources(notebook_id)
    )
    return NotebookDetailOut(
        **{**notebook.model_dump(), "source_count": len(sources)}, sources=sources
    )


@router.get("/notebooks/{notebook_id}/sources", response_model=list[SourceOut])
async def list_sources(notebook_id: str, request: Request) -> list[SourceOut]:
    return await _client(request).list_sources(notebook_id)


@router.post(
    "/notebooks/{notebook_id}/sources",
    response_model=SourceOut,
    status_code=201,
    openapi_extra=_ADD_SOURCE_OPENAPI,
)
async def add_source(notebook_id: str, request: Request) -> SourceOut:
    """Add a source: JSON ``{type:'text'|'url',...}`` or multipart (``file``, optional ``title``)."""
    client = _client(request)
    ctype = request.headers.get("content-type", "").split(";")[0].strip().lower()

    if ctype == "multipart/form-data":
        settings = _settings(request)
        async with request.form() as form:
            upload = form.get("file")
            if not isinstance(upload, UploadFile):
                raise InvalidRequest("Multipart field 'file' (the file to upload) is required.")
            raw_title = form.get("title")
            title = raw_title.strip() if isinstance(raw_title, str) and raw_title.strip() else None
            work = _mkdtemp(settings, "kbm-nlm-up-")
            try:
                dest = work / _safe_name(upload.filename, "upload")
                size = await asyncio.to_thread(_copy_upload, upload.file, dest)
                if size == 0:
                    raise InvalidRequest("Uploaded file is empty.")
                return await client.add_file_source(notebook_id, dest, title)
            finally:
                shutil.rmtree(work, ignore_errors=True)

    if ctype and ctype != "application/json" and not ctype.endswith("+json"):
        raise BridgeError(
            "Use application/json or multipart/form-data.",
            code="unsupported_media_type",
            status_code=415,
        )
    try:
        payload = json.loads((await request.body()) or b"null")
        data = _ADD_SOURCE_ADAPTER.validate_python(payload)
    except json.JSONDecodeError as exc:
        raise InvalidRequest("Body must be valid JSON.") from exc
    except ValidationError as exc:
        raise InvalidRequest(_validation_text(exc)) from exc

    if isinstance(data, AddTextSourceIn):
        return await client.add_text_source(notebook_id, data.title, data.text)
    return await client.add_url_source(notebook_id, data.url, data.title)


@router.delete("/notebooks/{notebook_id}/sources/{source_id}", status_code=204)
async def delete_source(notebook_id: str, source_id: str, request: Request) -> Response:
    await _client(request).delete_source(notebook_id, source_id)
    return Response(status_code=204)


@router.get("/notebooks/{notebook_id}/sources/{source_id}/fulltext", response_model=FulltextOut)
async def source_fulltext(notebook_id: str, source_id: str, request: Request) -> FulltextOut:
    """Readable full text of one source as indexed by NotebookLM (used to import sources elsewhere)."""
    return await _client(request).get_source_fulltext(notebook_id, source_id)


@router.post("/notebooks/{notebook_id}/ask", response_model=AskOut)
async def ask(notebook_id: str, body: AskIn, request: Request) -> AskOut:
    client = _client(request)
    result = await client.ask(notebook_id, body.question, body.source_ids, body.conversation_id)
    if result.references:
        try:
            titles = {s.id: s.title for s in await client.list_sources(notebook_id)}
        except BridgeError:
            logger.warning("Could not resolve source titles for references", exc_info=True)
            titles = {}
        for ref in result.references:
            ref.source_title = titles.get(ref.source_id)
    return result


@router.get("/notebooks/{notebook_id}/notes", response_model=list[NoteOut])
async def list_notes(notebook_id: str, request: Request) -> list[NoteOut]:
    return await _client(request).list_notes(notebook_id)


@router.post("/notebooks/{notebook_id}/notes", response_model=NoteOut, status_code=201)
async def create_note(notebook_id: str, body: CreateNoteIn, request: Request) -> NoteOut:
    return await _client(request).create_note(notebook_id, body.title, body.content)


@router.get("/notebooks/{notebook_id}/artifacts", response_model=list[ArtifactOut])
async def list_artifacts(notebook_id: str, request: Request) -> list[ArtifactOut]:
    return await _client(request).list_artifacts(notebook_id)


@router.post(
    "/notebooks/{notebook_id}/artifacts/generate",
    response_model=GenerationOut,
    status_code=202,
)
async def generate_artifact(
    notebook_id: str, body: GenerateArtifactIn, request: Request
) -> GenerationOut:
    options = validate_options(body.type, body.options)
    instructions = body.instructions.strip() if body.instructions else None
    return await _client(request).generate_artifact(
        notebook_id, body.type, instructions or None, options
    )


async def _require_artifact(client: BridgeClient, notebook_id: str, artifact_id: str) -> ArtifactOut:
    artifact = await client.get_artifact(notebook_id, artifact_id)
    if artifact is None:
        raise NotFound(
            f"Artifact {artifact_id} not found. Right after generation it can take a few "
            "seconds before NotebookLM lists it; retry shortly.",
            code="artifact_not_found",
        )
    return artifact


@router.get("/notebooks/{notebook_id}/artifacts/{artifact_id}", response_model=ArtifactOut)
async def get_artifact(notebook_id: str, artifact_id: str, request: Request) -> ArtifactOut:
    return await _require_artifact(_client(request), notebook_id, artifact_id)


@router.get(
    "/notebooks/{notebook_id}/artifacts/{artifact_id}/download",
    response_class=FileResponse,
    responses={200: {"content": {"application/octet-stream": {}}}},
)
async def download_artifact(
    notebook_id: str,
    artifact_id: str,
    request: Request,
    format: Annotated[
        str | None,
        Query(description="pptx|pdf|json|md|html|csv|png|mp4|m4a - default depends on the type"),
    ] = None,
) -> FileResponse:
    client = _client(request)
    artifact = await _require_artifact(client, notebook_id, artifact_id)
    fmt = resolve_download_format(artifact.type, format)
    if artifact.status != "completed":
        raise Conflict(
            f"Artifact is not ready (status: {artifact.status}).", code="artifact_not_ready"
        )

    work = _mkdtemp(_settings(request), "kbm-nlm-dl-")
    try:
        path = await client.download_artifact(notebook_id, artifact, fmt, work)
        if not path.is_file() or path.stat().st_size == 0:
            raise BridgeError(
                "NotebookLM returned an empty file.", code="download_failed", status_code=502
            )
    except BaseException:
        shutil.rmtree(work, ignore_errors=True)
        raise
    return FileResponse(
        path,
        media_type=fmt.mime,
        filename=_safe_name(artifact.title, "artifact") + fmt.extension,
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"},
        background=BackgroundTask(shutil.rmtree, work, ignore_errors=True),
    )


@router.get("/notebooks/{notebook_id}/share", response_model=ShareOut)
async def share_status(notebook_id: str, request: Request) -> ShareOut:
    return await _client(request).get_share_status(notebook_id)


# ----------------------------------------------------------------------------- factory
def create_app(
    settings: Settings | None = None,
    client: BridgeClient | None = None,
    *,
    clock: Callable[[], float] = time.monotonic,
) -> FastAPI:
    settings = settings or Settings.from_env()
    client = client or NotebookLMBridgeClient(
        profile=settings.profile, keepalive_seconds=settings.keepalive_seconds
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        settings.validate_for_serving()  # fail fast: never serve without a token
        logger.info(
            "NotebookLM Bridge %s (UNOFFICIAL, notebooklm-py %s) listening; profile=%s",
            __version__,
            notebooklm.__version__,
            settings.profile or "default",
        )
        try:
            yield
        finally:
            await client.aclose()

    app = FastAPI(
        title="KBM Notebook - NotebookLM Bridge (unofficial)",
        version=__version__,
        description="Stable HTTP API over the unofficial notebooklm-py library. "
        "Every request needs `Authorization: Bearer <BRIDGE_TOKEN>`.",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
    )
    app.state.settings = settings
    app.state.client = client
    app.state.health = HealthCache(client, settings.health_ttl_seconds, clock)

    install_error_handlers(app)
    app.include_router(router)

    # Innermost -> outermost: size limit, auth, CORS (CORS outermost so that preflight
    # requests are answered without a token and 401s still carry CORS headers).
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_upload_bytes)
    app.add_middleware(BearerAuthMiddleware, token=settings.token)
    if settings.allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(settings.allowed_origins),
            allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
            allow_headers=["Authorization", "Content-Type"],
            max_age=600,
        )
    return app


app = create_app()
