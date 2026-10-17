"""Static knowledge about artifact generation options and download formats.

Kept free of ``notebooklm`` imports so it is trivially unit-testable; a test asserts
these tables stay in sync with the installed library's enums and download registry.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .errors import InvalidRequest, NotSupported

# ----------------------------------------------------------------------- generation options
# option name -> allowed (case-insensitive) enum member names in notebooklm-py.
ENUM_OPTIONS: dict[str, dict[str, tuple[str, ...]]] = {
    "slide_deck": {
        "slide_format": ("detailed_deck", "presenter_slides"),
        "slide_length": ("default", "short"),
    },
    "report": {
        "report_format": (
            "briefing_doc",
            "study_guide",
            "blog_post",
            "concept_explanation",
            "custom",
        ),
    },
    "quiz": {
        "quantity": ("fewer", "standard", "more"),
        "difficulty": ("easy", "medium", "hard"),
    },
    "flashcards": {
        "quantity": ("fewer", "standard", "more"),
        "difficulty": ("easy", "medium", "hard"),
    },
    "mind_map": {},
    "infographic": {
        "orientation": ("landscape", "portrait", "square"),
        "detail_level": ("concise", "standard", "detailed"),
        "style": (
            "auto_select",
            "sketch_note",
            "professional",
            "bento_grid",
            "editorial",
            "instructional",
            "bricks",
            "clay",
            "anime",
            "kawaii",
            "scientific",
        ),
    },
    "data_table": {},
    "audio": {
        "audio_format": ("deep_dive", "brief", "critique", "debate"),
        "audio_length": ("short", "default", "long"),
    },
    "video": {
        "video_format": ("explainer", "brief", "cinematic", "short"),
        "video_style": (
            "auto_select",
            "custom",
            "classic",
            "whiteboard",
            "kawaii",
            "anime",
            "watercolor",
            "retro_print",
            "heritage",
            "paper_craft",
        ),
    },
}
# Free-text options allowed per type (in addition to COMMON_OPTIONS).
STRING_OPTIONS: dict[str, tuple[str, ...]] = {"video": ("style_prompt",)}
COMMON_OPTIONS = ("source_ids", "language")


def validate_options(artifact_type: str, options: dict[str, Any] | None) -> dict[str, Any]:
    """Validate and normalise ``options``; unknown keys or values -> 422."""
    options = dict(options or {})
    enums = ENUM_OPTIONS[artifact_type]
    strings = STRING_OPTIONS.get(artifact_type, ())
    allowed = (*COMMON_OPTIONS, *enums, *strings)

    unknown = sorted(set(options) - set(allowed))
    if unknown:
        raise InvalidRequest(
            f"Unknown option(s) for {artifact_type}: {', '.join(unknown)}. "
            f"Allowed: {', '.join(allowed)}."
        )

    out: dict[str, Any] = {}
    for key, value in options.items():
        if value is None:
            continue
        if key == "source_ids":
            if (
                not isinstance(value, list)
                or not value
                or not all(isinstance(v, str) and v.strip() for v in value)
            ):
                raise InvalidRequest("options.source_ids must be a non-empty list of strings.")
            out[key] = [v.strip() for v in value]
        elif key == "language" or key in strings:
            if not isinstance(value, str) or not value.strip() or len(value) > 5000:
                raise InvalidRequest(f"options.{key} must be a non-empty string.")
            out[key] = value.strip()
        else:
            choices = enums[key]
            normalised = str(value).strip().lower().replace("-", "_")
            if normalised not in choices:
                raise InvalidRequest(
                    f"options.{key} must be one of: {', '.join(choices)} (got {value!r})."
                )
            out[key] = normalised
    return out


# ----------------------------------------------------------------------- download formats
@dataclass(frozen=True)
class DownloadFormat:
    name: str  # API-facing name, e.g. "pptx"
    extension: str  # ".pptx"
    mime: str
    library_format: str | None = None  # value for notebooklm-py's ``output_format`` kwarg


_PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation"

_JSON = DownloadFormat("json", ".json", "application/json", "json")
_MD_QUIZ = DownloadFormat("md", ".md", "text/markdown", "markdown")
_HTML = DownloadFormat("html", ".html", "text/html", "html")

# artifact type -> (default format name, {format name -> DownloadFormat})
DOWNLOADS: dict[str, tuple[str, dict[str, DownloadFormat]]] = {
    "audio": ("m4a", {"m4a": DownloadFormat("m4a", ".m4a", "audio/mp4")}),
    "video": ("mp4", {"mp4": DownloadFormat("mp4", ".mp4", "video/mp4")}),
    "slide_deck": (
        "pdf",
        {
            "pdf": DownloadFormat("pdf", ".pdf", "application/pdf", "pdf"),
            "pptx": DownloadFormat("pptx", ".pptx", _PPTX, "pptx"),
        },
    ),
    "infographic": ("png", {"png": DownloadFormat("png", ".png", "image/png")}),
    "report": ("md", {"md": DownloadFormat("md", ".md", "text/markdown")}),
    "mind_map": ("json", {"json": DownloadFormat("json", ".json", "application/json")}),
    "data_table": ("csv", {"csv": DownloadFormat("csv", ".csv", "text/csv")}),
    "quiz": ("json", {"json": _JSON, "md": _MD_QUIZ, "html": _HTML}),
    "flashcards": ("json", {"json": _JSON, "md": _MD_QUIZ, "html": _HTML}),
}

# Everything the API will *accept* in ``?format=``. Names the library cannot produce
# (mp3) are recognised so they get a precise 501 instead of a generic 400.
KNOWN_FORMATS = {"pptx", "pdf", "json", "md", "markdown", "csv", "png", "mp3", "mp4", "m4a", "html"}


def resolve_download_format(artifact_type: str, requested: str | None) -> DownloadFormat:
    entry = DOWNLOADS.get(artifact_type)
    if entry is None:
        raise NotSupported(f"Downloading artifacts of type '{artifact_type}' is not supported.")
    default, formats = entry
    name = default if not requested else requested.strip().lower()
    if name == "markdown":
        name = "md"
    if name not in KNOWN_FORMATS:
        raise InvalidRequest(
            f"Unknown format '{requested}'. Known formats: {', '.join(sorted(KNOWN_FORMATS))}.",
            code="invalid_format",
            status_code=400,
        )
    if name == "mp3" and artifact_type == "audio":
        raise NotSupported(
            "notebooklm-py delivers Audio Overviews as .m4a (audio/mp4); mp3 conversion is "
            "not available. Request format=m4a (the default)."
        )
    if name not in formats:
        raise InvalidRequest(
            f"Format '{name}' is not available for {artifact_type}. "
            f"Available: {', '.join(formats)} (default {default}).",
            code="unsupported_format",
            status_code=400,
        )
    return formats[name]
