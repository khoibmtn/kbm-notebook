"""Uniform JSON errors: ``{"error": {"code": str, "message": str}}``.

Library exceptions from ``notebooklm-py`` are translated at the client boundary
(:func:`translate_exception`) so route handlers only ever see :class:`BridgeError`.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

import notebooklm as nlm

logger = logging.getLogger("bridge.errors")

MAX_MESSAGE_LEN = 500


class BridgeError(Exception):
    """An error with a stable machine-readable ``code`` and an HTTP status."""

    status_code: int = 500
    code: str = "internal_error"

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        status_code: int | None = None,
        headers: dict[str, str] | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = _clip(message)
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code
        self.headers = headers or {}
        self.details = details or {}

    def to_body(self) -> dict[str, Any]:
        error: dict[str, Any] = {"code": self.code, "message": self.message}
        error.update(self.details)
        return {"error": error}


class InvalidRequest(BridgeError):
    status_code = 422
    code = "invalid_request"


class NotFound(BridgeError):
    status_code = 404
    code = "not_found"


class NotAuthenticated(BridgeError):
    """No usable Google login on the bridge host (503, not 401: the *caller* is fine)."""

    status_code = 503
    code = "not_authenticated"


class NotSupported(BridgeError):
    status_code = 501
    code = "not_supported"


class Conflict(BridgeError):
    status_code = 409
    code = "conflict"


class PayloadTooLarge(BridgeError):
    status_code = 413
    code = "payload_too_large"


class Unauthorized(BridgeError):
    status_code = 401
    code = "unauthorized"


def _clip(message: str) -> str:
    message = " ".join(str(message).split())
    return message if len(message) <= MAX_MESSAGE_LEN else message[: MAX_MESSAGE_LEN - 1] + "…"


NOT_LOGGED_IN_HINT = (
    "The bridge host has no valid Google session. Run `notebooklm login` "
    "(or `notebooklm login --master-token --account EMAIL`) on that host."
)
UPSTREAM_CHANGED_HINT = (
    "Google's undocumented protocol appears to have changed; "
    "upgrade notebooklm-py on the bridge host."
)


def is_auth_failure(exc: BaseException) -> bool:
    return isinstance(
        exc,
        (
            nlm.AuthError,
            nlm.AuthExtractionError,
            nlm.exceptions.HeadlessReauthError,
        ),
    )


def translate_open_error(exc: BaseException) -> BridgeError:
    """Map a failure while *opening* the client (loading stored credentials)."""
    if isinstance(exc, BridgeError):
        return exc
    if isinstance(exc, (FileNotFoundError, ValueError)) or is_auth_failure(exc):
        return NotAuthenticated(f"{NOT_LOGGED_IN_HINT} ({type(exc).__name__}: {exc})")
    if isinstance(exc, nlm.NotebookLMError):
        return translate_exception(exc)
    logger.exception("Unexpected error while opening NotebookLM client")
    return BridgeError(
        f"Could not open the NotebookLM client: {type(exc).__name__}",
        code="client_unavailable",
        status_code=503,
    )


# Order matters: the first matching entry wins, so subclasses come before bases.
def translate_exception(exc: BaseException) -> BridgeError:  # noqa: C901 - flat dispatch table
    """Map any exception raised by ``notebooklm-py`` to a :class:`BridgeError`."""
    if isinstance(exc, BridgeError):
        return exc

    msg = str(exc) or type(exc).__name__

    if is_auth_failure(exc):
        return NotAuthenticated(f"{NOT_LOGGED_IN_HINT} ({msg})")
    if isinstance(exc, nlm.NotebookNotFoundError):
        return NotFound(msg, code="notebook_not_found")
    if isinstance(exc, nlm.SourceNotFoundError):
        return NotFound(msg, code="source_not_found")
    if isinstance(exc, nlm.ArtifactNotFoundError):
        return NotFound(msg, code="artifact_not_found")
    if isinstance(exc, nlm.NoteNotFoundError):
        return NotFound(msg, code="note_not_found")
    if isinstance(exc, nlm.NotFoundError):
        return NotFound(msg)
    if isinstance(exc, nlm.RateLimitError):
        retry_after = getattr(exc, "retry_after", None)
        headers = {"Retry-After": str(int(retry_after))} if retry_after else {}
        details = {"retry_after": int(retry_after)} if retry_after else {}
        return BridgeError(
            msg, code="rate_limited", status_code=429, headers=headers, details=details
        )
    if isinstance(exc, (nlm.WaitTimeoutError, nlm.RPCTimeoutError, TimeoutError)):
        return BridgeError(msg, code="timeout", status_code=504)
    if isinstance(exc, nlm.UnsupportedOperationError):
        return NotSupported(msg)
    if isinstance(exc, nlm.ValidationError):
        return InvalidRequest(msg, code="invalid_request", status_code=400)
    if isinstance(exc, nlm.ConfigurationError):
        return BridgeError(msg, code="misconfigured", status_code=500)
    if isinstance(exc, nlm.NotebookLimitError):
        return Conflict(msg, code="notebook_limit_reached")
    if isinstance(exc, nlm.ArtifactNotReadyError):
        return Conflict(msg, code="artifact_not_ready")
    if isinstance(exc, nlm.SourceProcessingError):
        return BridgeError(msg, code="source_processing_failed", status_code=422)
    if isinstance(exc, nlm.SourceAddError):
        return BridgeError(msg, code="source_add_failed", status_code=502)
    if isinstance(exc, nlm.ArtifactDownloadError):
        return BridgeError(msg, code="download_failed", status_code=502)
    if isinstance(exc, nlm.ArtifactFeatureUnavailableError):
        return BridgeError(msg, code="feature_unavailable", status_code=503)
    if isinstance(
        exc,
        (
            nlm.DecodingError,
            nlm.ChatResponseParseError,
            nlm.ArtifactParseError,
            nlm.RPCResponseTooLargeError,
        ),
    ):
        return BridgeError(f"{msg} {UPSTREAM_CHANGED_HINT}", code="upstream_changed", status_code=502)
    if isinstance(exc, nlm.NetworkError):
        return BridgeError(msg, code="network_error", status_code=502)
    if isinstance(exc, nlm.ServerError):
        return BridgeError(msg, code="upstream_error", status_code=502)
    if isinstance(exc, nlm.ClientError):
        return BridgeError(msg, code="upstream_rejected", status_code=502)
    if isinstance(exc, nlm.ChatError):
        return BridgeError(msg, code="chat_failed", status_code=502)
    if isinstance(exc, nlm.NotebookLMError):
        return BridgeError(msg, code="upstream_error", status_code=502)

    logger.exception("Unhandled exception", exc_info=exc)
    return BridgeError("Internal error.", code="internal_error", status_code=500)


def error_response(err: BridgeError) -> JSONResponse:
    return JSONResponse(err.to_body(), status_code=err.status_code, headers=err.headers or None)


def _validation_message(exc: RequestValidationError) -> str:
    parts: list[str] = []
    for item in exc.errors()[:5]:
        loc = ".".join(str(p) for p in item.get("loc", ()) if p != "body")
        parts.append(f"{loc or 'body'}: {item.get('msg', 'invalid')}")
    return "; ".join(parts) or "Invalid request."


_HTTP_CODES = {
    400: "bad_request",
    404: "not_found",
    405: "method_not_allowed",
    413: "payload_too_large",
    415: "unsupported_media_type",
}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(BridgeError)
    async def _bridge(_: Request, exc: BridgeError) -> JSONResponse:
        return error_response(exc)

    @app.exception_handler(nlm.NotebookLMError)
    async def _library(_: Request, exc: nlm.NotebookLMError) -> JSONResponse:
        return error_response(translate_exception(exc))

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        return error_response(InvalidRequest(_validation_message(exc)))

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _HTTP_CODES.get(exc.status_code, "http_error")
        err = BridgeError(
            str(exc.detail), code=code, status_code=exc.status_code, headers=dict(exc.headers or {})
        )
        return error_response(err)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled exception", exc_info=exc)
        return error_response(BridgeError("Internal error."))
