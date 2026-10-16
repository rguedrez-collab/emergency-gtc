# syntax=docker/dockerfile:1
# Three images from one file:
#   gateway  — the console's gateway (standard library only): the built page, the model routes, the vacation database,
#              forwarding of caller turns to remote caller sites (ORANGE_CALLERS), the per-site latency log, the phone
#              page (/appel); with GCORE_*_BASE_URL set, the Dynamo bridge runs alongside (backend/entrypoint.sh)
#   caller   — the simulated-caller service (caller/service.py), deployed at each site next to its own LLM and TTS,
#              with the same optional bridge (caller/entrypoint.sh)
#   preview  — the console with in-process fake models and two fake caller sites, for UI review without a GPU
# The UI mockup is not part of the repository: copy it to frontend/mockup/urgence.html (git-ignored) before
# building the gateway or preview image, or point the build argument at another path inside the build context.

FROM node:20-alpine AS ui
WORKDIR /build/frontend
COPY frontend/build.mjs ./
COPY frontend/src ./src
ARG MOCKUP=frontend/mockup/urgence.html
COPY ${MOCKUP} ./mockup/urgence.html
RUN node build.mjs

FROM python:3.12-slim AS gateway
WORKDIR /app
# ffmpeg: the bridge decodes microphone and phone recordings (webm/opus, ogg, mp4) to PCM for the realtime ASR.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 orange && mkdir -p /app/state && chown -R orange:orange /app
COPY --chown=orange:orange backend/server.py backend/gcore_bridge.py backend/entrypoint.sh ./backend/
COPY --chown=orange:orange caller/__init__.py caller/simulation.py ./caller/
COPY --chown=orange:orange tools/db_report.py ./tools/
COPY --chown=orange:orange frontend/src/line.html ./frontend/src/
COPY --from=ui --chown=orange:orange /build/frontend/dist ./frontend/dist
RUN chmod 755 backend/entrypoint.sh
USER 10001  # numeric, so runAsNonRoot can be verified by the orchestrator
# Inside the container the gateway must listen on all interfaces; publish or proxy it as you see fit.
# Model endpoints default to localhost: with network_mode: host they are the host's services, otherwise set
# ORANGE_GEMMA_URL / ORANGE_STT_URL / ORANGE_TTS_URL (and ORANGE_LLM_URL for a guardrail proxy), or GCORE_BASE_URL /
# GCORE_LLM_BASE_URL / GCORE_ASR_BASE_URL / GCORE_TTS_BASE_URL for Dynamo frontends (the bridge then starts).
# Remote caller sites: ORANGE_CALLERS="paris=http://host:8094,..." and ORANGE_CALLER_TOKEN.
ENV ORANGE_BIND=0.0.0.0 ORANGE_PORT=8092 ORANGE_STATE_DIR=/app/state ORANGE_PASSWORD_FILE=/run/secrets/access-password
EXPOSE 8092
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD ["python3", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8092/healthz', timeout=4)"]
CMD ["backend/entrypoint.sh"]

FROM python:3.12-slim AS caller
WORKDIR /app
RUN useradd --create-home --uid 10001 orange && chown -R orange:orange /app
COPY --chown=orange:orange caller/__init__.py caller/simulation.py caller/service.py caller/entrypoint.sh ./caller/
COPY --chown=orange:orange backend/gcore_bridge.py ./backend/
RUN chmod 755 caller/entrypoint.sh
USER 10001  # numeric, so runAsNonRoot can be verified by the orchestrator
# One service per site. Set CALLER_LOCATION (the name the console shows), CALLER_TOKEN (shared with the gateway's
# ORANGE_CALLER_TOKEN) and the site's model endpoints CALLER_LLM_URL / CALLER_TTS_URL — or GCORE_BASE_URL /
# GCORE_LLM_BASE_URL / GCORE_TTS_BASE_URL for Dynamo frontends (the bridge then starts); CALLER_FAKE=1 needs no models.
ENV CALLER_BIND=0.0.0.0 CALLER_PORT=8094
EXPOSE 8094
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD ["python3", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8094/healthz', timeout=4)"]
CMD ["caller/entrypoint.sh"]

FROM python:3.12-slim AS preview
WORKDIR /app
RUN useradd --create-home --uid 10001 orange && mkdir -p /app/state && chown -R orange:orange /app
COPY --chown=orange:orange backend/server.py ./backend/
COPY --chown=orange:orange caller/__init__.py caller/simulation.py caller/service.py ./caller/
COPY --chown=orange:orange tests/e2e/verify_local.py ./tests/e2e/
COPY --chown=orange:orange tools/preview_local.py tools/db_report.py ./tools/
COPY --chown=orange:orange frontend/src/logic.js frontend/src/line.html ./frontend/src/
COPY --from=ui --chown=orange:orange /build/frontend/dist ./frontend/dist
USER 10001  # numeric, so runAsNonRoot can be verified by the orchestrator
ENV ORANGE_STATE_DIR=/app/state
EXPOSE 8093
# The Basic-auth password is generated on first start into the state volume:
#   docker compose exec preview cat /app/state/.preview-password
# Two fake caller sites (lyon +40 ms, montreal +150 ms) run inside the container; add --no-sites to keep the built-in caller.
CMD ["python3", "-u", "tools/preview_local.py", "--bind", "0.0.0.0", "--port", "8093", "--password-file", "/app/state/.preview-password"]
