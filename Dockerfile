# syntax=docker/dockerfile:1
# Two images from one file:
#   gateway  — the production gateway (standard library only) serving the built page and the model routes
#   preview  — the same page with in-process fake models, for UI review without a GPU
# The UI mockup is not part of the repository: copy it to frontend/mockup/urgence.html (git-ignored) before
# building, or point the build argument at another path inside the build context.

FROM node:20-alpine AS ui
WORKDIR /build/frontend
COPY frontend/build.mjs ./
COPY frontend/src ./src
ARG MOCKUP=frontend/mockup/urgence.html
COPY ${MOCKUP} ./mockup/urgence.html
RUN node build.mjs

FROM python:3.12-slim AS gateway
WORKDIR /app
RUN useradd --create-home --uid 10001 orange && mkdir -p /app/state && chown -R orange:orange /app
COPY --chown=orange:orange backend/server.py ./backend/
COPY --from=ui --chown=orange:orange /build/frontend/dist ./frontend/dist
USER orange
# Inside the container the gateway must listen on all interfaces; publish or proxy it as you see fit.
# Model endpoints default to localhost: with network_mode: host they are the host's services, otherwise set
# ORANGE_GEMMA_URL / ORANGE_STT_URL / ORANGE_TTS_URL (and ORANGE_LLM_URL for a guardrail proxy).
ENV ORANGE_BIND=0.0.0.0 ORANGE_PORT=8092 ORANGE_STATE_DIR=/app/state ORANGE_PASSWORD_FILE=/run/secrets/access-password
EXPOSE 8092
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD ["python3", "-c", "import sys,urllib.request,urllib.error\ntry:\n    urllib.request.urlopen('http://127.0.0.1:8092/', timeout=4)\nexcept urllib.error.HTTPError as e:\n    sys.exit(0 if e.code == 401 else 1)"]
CMD ["python3", "-u", "backend/server.py"]

FROM python:3.12-slim AS preview
WORKDIR /app
RUN useradd --create-home --uid 10001 orange && mkdir -p /app/state && chown -R orange:orange /app
COPY --chown=orange:orange backend/server.py ./backend/
COPY --chown=orange:orange tests/e2e/verify_local.py ./tests/e2e/
COPY --chown=orange:orange tools/preview_local.py ./tools/
COPY --chown=orange:orange frontend/src/logic.js ./frontend/src/
COPY --from=ui --chown=orange:orange /build/frontend/dist ./frontend/dist
USER orange
ENV ORANGE_STATE_DIR=/app/state
EXPOSE 8093
# The Basic-auth password is generated on first start into the state volume:
#   docker compose exec preview cat /app/state/.preview-password
CMD ["python3", "-u", "tools/preview_local.py", "--bind", "0.0.0.0", "--port", "8093", "--password-file", "/app/state/.preview-password"]
