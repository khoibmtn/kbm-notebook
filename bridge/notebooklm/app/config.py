"""Runtime configuration, read once from environment variables."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

MIN_TOKEN_LENGTH = 16
DEFAULT_MAX_UPLOAD_MB = 50


class ConfigError(RuntimeError):
    """Raised when an environment variable has an unusable value."""


def _int(env: Mapping[str, str], name: str, default: int, *, minimum: int = 0) -> int:
    raw = env.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer (got {raw!r})") from exc
    if value < minimum:
        raise ConfigError(f"{name} must be >= {minimum} (got {value})")
    return value


def _float(env: Mapping[str, str], name: str, default: float, *, minimum: float = 0.0) -> float:
    raw = env.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = float(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be a number (got {raw!r})") from exc
    if value < minimum:
        raise ConfigError(f"{name} must be >= {minimum} (got {value})")
    return value


def _origins(raw: str | None) -> tuple[str, ...]:
    if not raw:
        return ()
    return tuple(o.strip().rstrip("/") for o in raw.split(",") if o.strip())


@dataclass(frozen=True)
class Settings:
    """All tunables of the bridge. Build with :meth:`from_env` or directly in tests."""

    token: str | None = None
    host: str = "127.0.0.1"
    port: int = 8765
    allowed_origins: tuple[str, ...] = ()
    max_upload_bytes: int = DEFAULT_MAX_UPLOAD_MB * 1024 * 1024
    profile: str | None = None
    tmp_dir: Path | None = None
    health_ttl_seconds: float = 60.0
    keepalive_seconds: float | None = 600.0

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> Settings:
        env = os.environ if env is None else env
        token = (env.get("BRIDGE_TOKEN") or "").strip() or None
        profile = (env.get("NOTEBOOKLM_PROFILE") or "").strip() or None
        tmp = (env.get("BRIDGE_TMP_DIR") or "").strip()
        keepalive = _float(env, "BRIDGE_KEEPALIVE_SECONDS", 600.0)
        return cls(
            token=token,
            host=(env.get("BRIDGE_HOST") or "127.0.0.1").strip(),
            port=_int(env, "BRIDGE_PORT", 8765, minimum=1),
            allowed_origins=_origins(env.get("BRIDGE_ALLOWED_ORIGINS")),
            max_upload_bytes=_int(env, "BRIDGE_MAX_UPLOAD_MB", DEFAULT_MAX_UPLOAD_MB, minimum=1)
            * 1024
            * 1024,
            profile=profile,
            tmp_dir=Path(tmp) if tmp else None,
            health_ttl_seconds=_float(env, "BRIDGE_HEALTH_TTL_SECONDS", 60.0),
            keepalive_seconds=keepalive if keepalive > 0 else None,
        )

    def validate_for_serving(self) -> None:
        """Fail fast (at startup) rather than serving an unprotected bridge."""
        if not self.token:
            raise ConfigError(
                "BRIDGE_TOKEN is not set. Refusing to start without bearer-token protection "
                f"(generate one with: python -c \"import secrets;print(secrets.token_urlsafe(32))\")."
            )
        if len(self.token) < MIN_TOKEN_LENGTH:
            raise ConfigError(f"BRIDGE_TOKEN must be at least {MIN_TOKEN_LENGTH} characters long.")
