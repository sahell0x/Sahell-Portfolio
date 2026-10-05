# syntax=docker/dockerfile:1

# Python 3.12, not 3.13: vox uses the stdlib `audioop` module, removed in 3.13.
FROM python:3.12-slim

# ffmpeg backs pydub's audio handling; the rest is for building wheels that
# have no prebuilt aarch64/x86 variant.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# Defaults only. Compose overrides both from .env, and the app reads the same
# two names (app/config.py), so a port change is one line in one file.
ENV HOST=0.0.0.0 \
    PORT=8000

# Dependencies first so edits to application code don't invalidate the layer.
COPY requirements.txt ./requirements.txt
RUN pip install --upgrade pip && pip install -r requirements.txt

# app/ and vox/ are both plain packages under /srv, imported off the working
# directory — no install step, no editable egg-link. vox/ ships no vendor SDKs
# of its own: its provider registries resolve lazily, so only the Sarvam +
# OpenAI + default-web path is ever imported.
COPY . .

# The only two paths written at runtime, created before the drop to an
# unprivileged user so that compose's named volumes inherit its ownership:
#   agent_data/  vox reads the agent prompt from agent_data/<assistant_id>/
#   logs/        one CSV transcript per session
RUN useradd --create-home --uid 10001 --user-group --shell /usr/sbin/nologin app \
    && mkdir -p agent_data logs \
    && chown -R app:app /srv

USER app

# Documentation only — the published port is set by compose from .env.
EXPOSE 8000

# Shell form on purpose: $PORT has to be expanded at container start, not
# frozen at build time.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os,sys,urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8000')+'/health', timeout=4).status == 200 else 1)"

# exec so uvicorn becomes PID 1's direct child and receives SIGTERM itself.
CMD ["sh", "-c", "exec uvicorn app.main:app --host \"${HOST:-0.0.0.0}\" --port \"${PORT:-8000}\""]
