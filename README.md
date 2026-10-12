# Orange · Triage IA des urgences — demonstration console

A French-language emergency-call console in which an AI assistant (Gemma 4 via an OpenAI-compatible
endpoint) handles synthetic incoming calls — transcription (Nemotron / Parakeet), contextual dialogue,
Voxtral speech — while a human operator supervises, listens in, takes calls over, reviews and files them.
Everything is synthetic: no real call, no dispatch, no transmission to emergency services.

## Layout

```
backend/            gateway (Python, standard library only)
  server.py           routes, model orchestration, speech guard, guardrails, vacation persistence
  env.example         guardrail settings template (copy to backend/.env)
  guardrails/         F5 tee-proxy runner and its env template
frontend/           browser application
  src/logic.js        controller (React through the mockup's template engine): scheduler, audio, console, themes
  src/samples.mjs     100 synthetic scenarios
  build.mjs           embeds the controller and styles into the UI mockup -> frontend/dist/urgence.html
  mockup/             put urgence.html here (git-ignored)      dist/   build output (git-ignored)
tests/
  frontend/           controller lifecycle tests (Node, vm)
  backend/            gateway tests (unittest)
  e2e/                headless-browser harness with fake models (--guarded, --oob, --realproxy, --soak)
tools/preview_local.py   serves the built page with fake models for UI review
docs/HANDOFF.md     handoff for the next engineer or AI agent
Dockerfile, docker-compose.yml, Makefile
```

## What is deliberately *not* here

- **The UI mockup** (`urgence.html`, ~2.6 MB bundle). The build needs it: put it in `frontend/mockup/`,
  or pass `ORANGE_MOCKUP`. It embeds third-party UI libraries — check its redistribution terms before
  adding it or the built page to any shared repository. `frontend/mockup/` and `frontend/dist/` are git-ignored for that reason.
- **Deployment details** (hosts, SSH, tunnel URLs, VM scripts) and **credentials** (Basic-auth password,
  registry pull password, F5 token/project). Keep them in your private operations notes and in the
  git-ignored files `.access-password`, `.acr-password`, `backend/.env`, `backend/guardrails/tee-proxy.env`.
- Model services. The gateway expects local OpenAI-compatible endpoints: LLM on `127.0.0.1:8000`,
  TTS on the Voxtral port, STT on `127.0.0.1:8098` (see `backend/server.py`).

## Run locally (UI review, fake models)

```bash
mkdir -p frontend/mockup && cp /path/to/urgence.html frontend/mockup/   # or: make build MOCKUP=/path/to/urgence.html
make preview          # builds, then serves on http://127.0.0.1:8093 (user demo; .preview-password is created)
```

## Run the gateway (real models)

```bash
echo 'a-strong-password' > .access-password && chmod 600 .access-password
cp backend/env.example backend/.env   # optional: guardrail settings
make run                              # python3 backend/server.py -> 127.0.0.1:8092, user demo
```
Environment: `ORANGE_PORT`, `ORANGE_PASSWORD_FILE` (default `.access-password` at the repo root), `ORANGE_STATE_DIR` (saved vacation, default `state/`), `ORANGE_STATIC_FILE` (page to serve, default `frontend/dist/urgence.html`),
`ORANGE_LLM_URL` / `ORANGE_CALLER_LLM_URL` (LLM endpoints; point the first at the tee proxy for option B),
`ORANGE_GEMMA_URL`, `ORANGE_STT_URL`, `ORANGE_TTS_URL` (model service bases), `ORANGE_BIND` (listen address),
`F5_GUARDRAILS_*` (option A). Serve it behind HTTPS (e.g. a tunnel); the page loads NVIDIA Elements assets
from jsDelivr and talks only to this gateway.

## Docker

```bash
mkdir -p frontend/mockup && cp /path/to/urgence.html frontend/mockup/   # the mockup stays out of git
echo 'a-strong-password' > .access-password && chmod 600 .access-password
docker compose up -d gateway                                # host network; models on the host's localhost
docker compose --profile preview up -d                      # UI review with fake models on :8093
docker compose exec preview cat /app/state/.preview-password
```
The `Dockerfile` has two targets (`gateway`, `preview`) built from the same UI stage. Without host
networking, point the gateway at the model services with `ORANGE_GEMMA_URL`, `ORANGE_STT_URL`,
`ORANGE_TTS_URL` (and `ORANGE_LLM_URL` for a guardrail proxy); `ORANGE_BIND` controls the listen address.

## Tests

```bash
make test                                   # controller + gateway unit tests
pip install -r requirements-dev.txt && python3 -m playwright install chromium
make e2e                                    # ORANGE_CHROMIUM=/path/to/chrome to use a specific build
python3 tests/e2e/verify_local.py --guarded # fake F5 tee proxy on the LLM path
```

## Safety boundaries (by design)

No diagnosis, no medical gesture, no claim that help is on its way; the AI asks observation questions,
gives general safety instructions and hands over to a human on any guardrail block. Every call is
archived as requiring human review. The page states the demonstration boundary once (header tag) and
on the decision action.
