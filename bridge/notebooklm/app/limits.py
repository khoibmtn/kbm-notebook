"""Request body size limit (default 50 MB, ``BRIDGE_MAX_UPLOAD_MB``)."""

from __future__ import annotations

from starlette.datastructures import Headers
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .errors import PayloadTooLarge, error_response


class BodySizeLimitMiddleware:
    """Reject bodies larger than ``max_bytes`` with 413.

    A declared ``Content-Length`` is checked up front; for chunked/undeclared bodies the
    bytes actually received are counted and :class:`PayloadTooLarge` is raised from
    ``receive`` (handled by the app's error handlers) as soon as the limit is crossed.
    """

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    def _too_large(self) -> PayloadTooLarge:
        mb = self.max_bytes / (1024 * 1024)
        return PayloadTooLarge(f"Request body exceeds the {mb:g} MB limit.")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        declared = Headers(scope=scope).get("content-length")
        if declared is not None:
            try:
                too_big = int(declared) > self.max_bytes
            except ValueError:
                too_big = False
            if too_big:
                await error_response(self._too_large())(scope, receive, send)
                return

        received = 0

        async def counting_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise self._too_large()
            return message

        await self.app(scope, counting_receive, send)
