"""Pydantic request/response models: the stable public contract of the bridge.

These deliberately do **not** mirror ``notebooklm-py`` dataclasses, so the HTTP API
stays stable when the (unofficial, fast-moving) library changes.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

NonEmptyStr = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]

ArtifactTypeName = Literal[
    "slide_deck",
    "report",
    "quiz",
    "flashcards",
    "mind_map",
    "infographic",
    "data_table",
    "audio",
    "video",
]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --------------------------------------------------------------------------- health
class HealthOut(BaseModel):
    ok: bool = True
    version: str
    notebooklm_py_version: str | None = None
    authenticated: bool
    account: str | None = None
    detail: str | None = Field(
        default=None, description="Why the bridge is not authenticated (only when it is not)."
    )


# --------------------------------------------------------------------------- notebooks
class CreateNotebookIn(_Strict):
    title: Title


class SourceOut(BaseModel):
    id: str
    title: str | None = None
    kind: str = Field(description="pdf, web_page, pasted_text, youtube, google_docs, ... or unknown")
    status: str = Field(description="processing | ready | error | preparing | unknown")
    url: str | None = None


class NotebookOut(BaseModel):
    id: str
    title: str
    source_count: int = 0
    updated_at: datetime | None = Field(
        default=None,
        description="Last time the *connected account* opened the notebook "
        "(NotebookLM exposes no true modification time); falls back to created_at.",
    )
    created_at: datetime | None = None


class NotebookDetailOut(NotebookOut):
    sources: list[SourceOut] = Field(default_factory=list)


# --------------------------------------------------------------------------- sources
class AddTextSourceIn(_Strict):
    type: Literal["text"]
    title: Title
    text: NonEmptyStr


class AddUrlSourceIn(_Strict):
    type: Literal["url"]
    url: NonEmptyStr
    title: Title | None = None

    @field_validator("url")
    @classmethod
    def _http_only(cls, v: str) -> str:
        if not v.lower().startswith(("http://", "https://")) or len(v) > 4096:
            raise ValueError("url must be an http(s) URL")
        return v


AddSourceIn = Annotated[AddTextSourceIn | AddUrlSourceIn, Field(discriminator="type")]


class FulltextOut(BaseModel):
    source_id: str
    title: str | None = None
    kind: str = "unknown"
    url: str | None = None
    text: str = Field(description="Readable plain text of the source as indexed by NotebookLM.")
    char_count: int = Field(description="len(text) in Python characters.")


# --------------------------------------------------------------------------- chat
class AskIn(_Strict):
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20000)]
    source_ids: list[NonEmptyStr] | None = Field(default=None, min_length=1, max_length=300)
    conversation_id: NonEmptyStr | None = None


class ReferenceOut(BaseModel):
    source_id: str
    source_title: str | None = None
    citation_number: int | None = None
    cited_text: str | None = None
    start_char: int | None = Field(
        default=None, description="Start offset in the source, in UTF-16 code units."
    )
    end_char: int | None = Field(default=None, description="End offset (exclusive), UTF-16 units.")
    score: float | None = None


class AskOut(BaseModel):
    answer: str
    conversation_id: str
    references: list[ReferenceOut] = Field(default_factory=list)


# --------------------------------------------------------------------------- notes
class CreateNoteIn(_Strict):
    title: Title
    content: str = Field(default="", max_length=200_000)


class NoteOut(BaseModel):
    id: str
    title: str
    content: str
    created_at: datetime | None = None


# --------------------------------------------------------------------------- artifacts
class GenerateArtifactIn(_Strict):
    type: ArtifactTypeName
    instructions: str | None = Field(default=None, max_length=20000)
    options: dict[str, Any] = Field(default_factory=dict)


class ArtifactOut(BaseModel):
    id: str
    title: str
    type: str = Field(description="slide_deck, report, quiz, flashcards, mind_map, ... or unknown")
    status: str = Field(description="pending | in_progress | completed | failed | unknown ...")
    created_at: datetime | None = None
    source_ids: list[str] = Field(default_factory=list)


class GenerationOut(BaseModel):
    task_id: str
    artifact_id: str = Field(description="Same value as task_id (NotebookLM uses one id).")
    type: str
    status: str
    error: str | None = None


# --------------------------------------------------------------------------- sharing
class SharedUserOut(BaseModel):
    email: str
    permission: str = Field(description="owner | editor | viewer | unknown")
    display_name: str | None = None


class ShareOut(BaseModel):
    notebook_id: str
    is_public: bool
    access: str = Field(description="restricted | anyone_with_link")
    view_level: str = Field(description="full_notebook | chat_only")
    share_url: str | None = None
    shared_users: list[SharedUserOut] = Field(default_factory=list)
    max_individuals_share_limit: int | None = None
    is_public_sharing_allowed: bool | None = None


# --------------------------------------------------------------------------- internal
class ProbeResult(BaseModel):
    """Outcome of the cheap authentication probe behind ``/health``."""

    authenticated: bool
    account: str | None = None
    detail: str | None = None
