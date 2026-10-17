"""Bearer-token authentication (``Authorization: Bearer <BRIDGE_TOKEN>``).

Implemented as a pure ASGI middleware so that *every* path - including unknown ones and
``/health`` - is rejected with 401 **before** any request body is read or parsed (an
unauthenticated multipart upload is never spooled to disk).
"""

from __future__ import annotations

import hashlib
import hmac

from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

from .errors import BridgeError, Unauthorized, error_response


def extract_bearer(authorization: str | None) -> str | None:
    """Return the token of a ``Bearer`` header, or ``None`` when absent/malformed."""
    if not authorization:
        return None
    scheme, _, value = authorization.strip().partition(" ")
    value = value.strip()
    if scheme.lower() != "bearer" or not value:
        return None
    return value


def tokens_match(provided: str | None, expected: str) -> bool:
    """Constant-time comparison.

    Both sides are hashed first so the comparison time does not depend on the length of
    the supplied value and arbitrary (non-ASCII) input is handled safely.
    """
    a = hashlib.sha256((provided or "").encode("utf-8", "surrogatepass")).digest()
    b = hashlib.sha256(expected.encode("utf-8", "surrogatepass")).digest()
    valid = hmac.compare_digest(a, b)
    return valid and bool(provided) and bool(expected)


class BearerAuthMiddleware:
    def __init__(self, app: ASGIApp, token: str | None) -> None:
        self.app = app
        self.token = token

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        if not self.token:
            err: BridgeError = BridgeError(
                "BRIDGE_TOKEN is not configured on the bridge.",
                code="bridge_not_configured",
                status_code=503,
            )
        else:
            provided = extract_bearer(Headers(scope=scope).get("authorization"))
            if tokens_match(provided, self.token):
                await self.app(scope, receive, send)
                return
            err = Unauthorized(
                "Missing or invalid bearer token.",
                headers={"WWW-Authenticate": 'Bearer realm="kbm-notebooklm-bridge"'},
            )
        await error_response(err)(scope, receive, send)
