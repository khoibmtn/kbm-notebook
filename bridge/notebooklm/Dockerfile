# NotebookLM Bridge (UNOFFICIAL) - xem README.md.
# Dang nhap Google PHAI lam tren may chu (`notebooklm login`), sau do mount thu muc ~/.notebooklm vao /data.
#
#   docker build -t kbm-notebooklm-bridge .
#   docker run -d --name notebooklm-bridge --restart unless-stopped \
#     --user "$(id -u):$(id -g)" \
#     -e BRIDGE_TOKEN="$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')" \
#     -v "$HOME/.notebooklm:/data" \
#     -p 127.0.0.1:8765:8765 kbm-notebooklm-bridge
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    NOTEBOOKLM_HOME=/data \
    BRIDGE_HOST=0.0.0.0 \
    BRIDGE_PORT=8765

WORKDIR /srv/bridge
COPY pyproject.toml README.md ./
COPY app ./app
RUN pip install . && mkdir -p /data && chmod 0777 /data

USER 10001:10001
VOLUME ["/data"]
EXPOSE 8765

HEALTHCHECK --interval=60s --timeout=10s --start-period=15s --retries=3 \
  CMD python -c "import os,urllib.request as u; r=u.Request('http://127.0.0.1:%s/health' % os.environ['BRIDGE_PORT'], headers={'Authorization':'Bearer '+os.environ['BRIDGE_TOKEN']}); u.urlopen(r, timeout=5)"

CMD ["sh", "-c", "exec uvicorn app.main:app --host \"$BRIDGE_HOST\" --port \"$BRIDGE_PORT\" --no-server-header"]
