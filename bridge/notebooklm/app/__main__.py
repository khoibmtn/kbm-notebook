"""``python -m app`` - run with BRIDGE_HOST / BRIDGE_PORT (defaults 127.0.0.1:8765)."""

import logging

import uvicorn

from .config import Settings


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    settings = Settings.from_env()
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, log_level="info")


if __name__ == "__main__":
    main()
