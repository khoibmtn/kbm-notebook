"""In-memory ``BridgeClient`` used by the HTTP-level tests."""

from __future__ import annotations

import itertools
from pathlib import Path
from typing import Any

from app import generation
from app.errors import NotAuthenticated, NotFound
from app.models import (
    ArtifactOut,
    AskOut,
    FulltextOut,
    GenerationOut,
    NoteOut,
    NotebookOut,
    ProbeResult,
    ReferenceOut,
    ShareOut,
    SharedUserOut,
    SourceOut,
)


class FakeClient:
    def __init__(self) -> None:
        self._ids = itertools.count(1)
        self.authenticated = True
        self.account: str | None = "tester@example.com"
        self.probe_calls = 0
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self.notebooks: dict[str, NotebookOut] = {}
        self.sources: dict[str, list[SourceOut]] = {}
        self.notes: dict[str, list[NoteOut]] = {}
        self.artifacts: dict[str, list[ArtifactOut]] = {}
        self.file_payloads: dict[str, bytes] = {}
        self.fulltexts: dict[str, str] = {}
        self.ask_references: list[ReferenceOut] = []
        self.uploaded: list[tuple[str, bytes, str | None]] = []
        self.closed = False
        self.add_notebook("nb1", "Giải phẫu học", ["s1", "s2"])

    # -- test helpers ----------------------------------------------------------
    def _id(self, prefix: str) -> str:
        return f"{prefix}{next(self._ids)}"

    def add_notebook(self, nb_id: str, title: str, source_ids: list[str] | None = None) -> None:
        self.notebooks[nb_id] = NotebookOut(id=nb_id, title=title, source_count=len(source_ids or []))
        self.sources[nb_id] = [
            SourceOut(id=s, title=f"Source {s}", kind="pdf", status="ready") for s in source_ids or []
        ]
        self.notes[nb_id] = []
        self.artifacts[nb_id] = []

    def complete(self, nb_id: str, artifact_id: str, payload: bytes = b"PK\x03\x04fake") -> None:
        for i, art in enumerate(self.artifacts[nb_id]):
            if art.id == artifact_id:
                self.artifacts[nb_id][i] = art.model_copy(update={"status": "completed"})
        self.file_payloads[artifact_id] = payload

    def _nb(self, nb_id: str) -> NotebookOut:
        try:
            return self.notebooks[nb_id]
        except KeyError:
            raise NotFound(f"Notebook {nb_id} not found", code="notebook_not_found") from None

    def _require_auth(self) -> None:
        if not self.authenticated:
            raise NotAuthenticated("not logged in")

    # -- BridgeClient ----------------------------------------------------------
    async def probe(self) -> ProbeResult:
        self.probe_calls += 1
        if not self.authenticated:
            return ProbeResult(authenticated=False, detail="Run `notebooklm login`")
        return ProbeResult(authenticated=True, account=self.account)

    async def list_notebooks(self) -> list[NotebookOut]:
        self._require_auth()
        return list(self.notebooks.values())

    async def create_notebook(self, title: str) -> NotebookOut:
        self._require_auth()
        nb_id = self._id("nb")
        self.add_notebook(nb_id, title)
        return self.notebooks[nb_id]

    async def get_notebook(self, notebook_id: str) -> NotebookOut:
        return self._nb(notebook_id)

    async def list_sources(self, notebook_id: str) -> list[SourceOut]:
        self._nb(notebook_id)
        return list(self.sources[notebook_id])

    async def add_text_source(self, notebook_id: str, title: str, text: str) -> SourceOut:
        self._nb(notebook_id)
        src = SourceOut(id=self._id("s"), title=title, kind="pasted_text", status="processing")
        self.sources[notebook_id].append(src)
        self.calls.append(("add_text", (notebook_id, title, text)))
        return src

    async def add_url_source(self, notebook_id: str, url: str, title: str | None = None) -> SourceOut:
        self._nb(notebook_id)
        src = SourceOut(id=self._id("s"), title=title or url, kind="web_page", status="processing", url=url)
        self.sources[notebook_id].append(src)
        return src

    async def add_file_source(self, notebook_id: str, path: Path, title: str | None = None) -> SourceOut:
        self._nb(notebook_id)
        self.uploaded.append((path.name, path.read_bytes(), title))
        src = SourceOut(id=self._id("s"), title=title or path.name, kind="pdf", status="processing")
        self.sources[notebook_id].append(src)
        return src

    async def delete_source(self, notebook_id: str, source_id: str) -> None:
        self._nb(notebook_id)
        before = len(self.sources[notebook_id])
        self.sources[notebook_id] = [s for s in self.sources[notebook_id] if s.id != source_id]
        if len(self.sources[notebook_id]) == before:
            raise NotFound("no such source", code="source_not_found")

    async def get_source_fulltext(self, notebook_id: str, source_id: str) -> FulltextOut:
        self._nb(notebook_id)
        src = next((s for s in self.sources[notebook_id] if s.id == source_id), None)
        if src is None:
            raise NotFound("no such source", code="source_not_found")
        text = self.fulltexts.get(source_id, f"Nội dung đầy đủ của {src.title}")
        return FulltextOut(
            source_id=src.id, title=src.title, kind=src.kind, url=src.url, text=text, char_count=len(text)
        )

    async def ask(
        self,
        notebook_id: str,
        question: str,
        source_ids: list[str] | None = None,
        conversation_id: str | None = None,
    ) -> AskOut:
        self._nb(notebook_id)
        self.calls.append(("ask", (notebook_id, question, source_ids, conversation_id)))
        return AskOut(
            answer="Tim có 4 buồng [1][2].",
            conversation_id=conversation_id or "conv-1",
            references=[r.model_copy() for r in self.ask_references],
        )

    async def list_notes(self, notebook_id: str) -> list[NoteOut]:
        self._nb(notebook_id)
        return list(self.notes[notebook_id])

    async def create_note(self, notebook_id: str, title: str, content: str) -> NoteOut:
        self._nb(notebook_id)
        note = NoteOut(id=self._id("n"), title=title, content=content)
        self.notes[notebook_id].append(note)
        return note

    async def list_artifacts(self, notebook_id: str) -> list[ArtifactOut]:
        self._nb(notebook_id)
        return list(self.artifacts[notebook_id])

    async def get_artifact(self, notebook_id: str, artifact_id: str) -> ArtifactOut | None:
        self._nb(notebook_id)
        return next((a for a in self.artifacts[notebook_id] if a.id == artifact_id), None)

    async def generate_artifact(
        self, notebook_id: str, artifact_type: str, instructions: str | None, options: dict[str, Any]
    ) -> GenerationOut:
        self._nb(notebook_id)
        self.calls.append(("generate", (notebook_id, artifact_type, instructions, options)))
        art_id = self._id("a")
        self.artifacts[notebook_id].append(
            ArtifactOut(id=art_id, title=f"Bản {artifact_type}", type=artifact_type, status="in_progress")
        )
        return GenerationOut(task_id=art_id, artifact_id=art_id, type=artifact_type, status="in_progress")

    async def download_artifact(
        self, notebook_id: str, artifact: ArtifactOut, fmt: generation.DownloadFormat, dest_dir: Path
    ) -> Path:
        self.calls.append(("download", (artifact.id, fmt.name, fmt.library_format)))
        path = dest_dir / f"artifact{fmt.extension}"
        path.write_bytes(self.file_payloads[artifact.id])
        self.last_download_dir = dest_dir
        return path

    async def get_share_status(self, notebook_id: str) -> ShareOut:
        self._nb(notebook_id)
        return ShareOut(
            notebook_id=notebook_id,
            is_public=False,
            access="restricted",
            view_level="full_notebook",
            shared_users=[SharedUserOut(email="owner@example.com", permission="owner")],
            max_individuals_share_limit=1000,
            is_public_sharing_allowed=True,
        )

    async def aclose(self) -> None:
        self.closed = True
