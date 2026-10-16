# Orange · Triage IA des urgences — demonstration console

A French-language emergency-call console in which an AI assistant (Gemma 4 via an OpenAI-compatible
endpoint) handles synthetic incoming calls — transcription (Nemotron / Parakeet), contextual dialogue,
Voxtral speech — while a human operator supervises, listens in, takes calls over, reviews and files them.
Everything is synthetic: no real call, no dispatch, no transmission to emergency services.

## Layout

```
backend/            gateway (Python, standard library only) — fixed, next to the console
  server.py           routes, model orchestration, speech guard, guardrails, vacation persistence,
                      forwarding of caller turns to caller sites + per-site latency log
  env.example         settings template (models, caller sites, guardrails; copy to backend/.env)
  guardrails/         F5 tee-proxy runner and its env template
caller/             the simulated caller as its own service — deployable at other locations
  service.py          HTTP service: GET /health, POST /turn (line + WAV audio + timings); CALLER_* environment
  simulation.py       the caller's prompt, delivery profiles and validation, shared with the gateway's built-in caller
  env.example         settings template (copy to caller/.env)
frontend/           browser application
  src/logic.js        controller (React through the mockup's template engine): scheduler, audio, console, themes,
                      caller-site choice and latency views
  src/samples.mjs     100 synthetic scenarios
  build.mjs           embeds the controller and styles into the UI mockup -> frontend/dist/urgence.html
  mockup/             put urgence.html here (git-ignored)      dist/   build output (git-ignored)
tests/
  frontend/           controller lifecycle tests (Node, vm)
  backend/            gateway tests (unittest)
  caller/             caller service tests (unittest)
  e2e/                headless-browser harness with fake models and two fake caller sites (--guarded, --oob, --realproxy, --soak)
tools/preview_local.py   serves the built page with fake models and fake caller sites for UI review
tools/db_report.py       vacations, calls, transcripts and per-site latency from the SQLite database
docs/HANDOFF.md     handoff for the next engineer or AI agent
Dockerfile, docker-compose.yml, Makefile
```

## Caller sites and latency

The voice on the other end of the line is a service of its own (`caller/service.py`): it generates the caller's
next line with the LLM next to it and speaks it with the speech model next to it. The console and its gateway stay
where they are; the gateway lists the sites in `ORANGE_CALLERS` (`name=url,...`), spreads new calls over the ready
sites (or pins one from « Réglages › Site appelant ») and forwards each caller turn with a bearer token. Without any
site, the gateway's built-in caller (its own LLM, then `/api/tts`) plays every call, exactly as before.

Every turn is measured and the sample is stored by the gateway (`latency` table, `POST /api/latency`):

| Field | Measured by | Meaning |
| --- | --- | --- |
| `caller_ms` | browser | Time until the caller's line is ready to play (one request to a site; LLM + `/api/tts` for the built-in caller). |
| `llm_ms`, `tts_ms` | the site (or the gateway) | The site's own model time for the line and its voice. |
| `network_ms` | gateway | Round trip to the site minus the time the site reports: the distance. Built-in caller: none. |
| `stt_ms`, `analyze_ms`, `reply_tts_ms` | browser | The console's own steps: transcription, analysis + reply, the AI's voice (audible call only). |

What the console shows: a line on every call card and row (`<site> · appelant <ms>`, the call's median and the
network share in its tooltip), the site and the last round trip in the call header, « Latence · dernier tour » in
the copilot (breakdown and the call's medians behind Détails), « Sites appelants · latence » on the overview
(readiness and round trip from the health probe, median / p95 per site, fallbacks). `GET /api/latency` aggregates the last 500 turns;
`python3 tools/db_report.py --latency` prints the same table from the database. A site that fails is bypassed for
30 s (the built-in caller answers, marked « repli ») and shows as a warning dot in the services chip; set
`ORANGE_CALLER_FALLBACK=0` to fail the turn instead. The site's answer is treated as model output: the line goes
through the same validation as the built-in caller's, the audio must be a WAV.

```bash
# At each site, next to its LLM and TTS:
CALLER_LOCATION=paris CALLER_TOKEN=the-shared-token python3 caller/service.py      # 0.0.0.0:8094
# At the console:
ORANGE_CALLERS=paris=http://10.0.0.5:8094,montreal=https://caller-yul.example ORANGE_CALLER_TOKEN=the-shared-token make run
```
`CALLER_FAKE=1` runs a site without models (scripted lines, silent audio that carries its text), which is what the
preview and the e2e harness use to show two sites with different distances.

### Who answered: the AI or the operator

Each sample carries `handler`: `ai` for a turn the assistant answered, `operator` for a turn after a takeover. Operator
turns record the human's latency separately: `operator_ms` (reaction time, from the caller's last words to the answer
being sent or spoken), `op_tts_ms` (their voice synthesis) and `op_stt_ms` (their microphone transcription). The
aggregates (`GET /api/latency` → `handlers`, `tools/db_report.py --latency`) keep the two apart; the console shows the
operator's reaction on the card (« vous »), in the copilot and on the overview.

## A real caller from a phone

A person can call the console from a phone: open the console's address followed by `/appel` on the mobile (same
Basic-auth credentials), enter an optional pseudonym, tap « Appeler », then hold « Maintenir pour parler » to speak.
The page records each utterance (push-to-talk, 30 s max), uploads it, and plays the spoken replies; it shows the
round trip it measured for each exchange. The console picks the line up as an incoming call (« Appel entrant · ligne
mobile », straight under « À traiter »): the AI greets, transcribes and answers with audio the phone plays; the
operator can take the call, in which case their typed or spoken answers go to the phone. Hanging up on either side
closes the call.

It is plain HTTPS (upload + polling through the gateway's `/api/line/*` routes), so it works through the demonstration
tunnel in Android Chrome, as a page added to the home screen, or inside a WebView-based Android app. Lines live in the
gateway's memory only and expire after 30 minutes of silence; nothing of a real voice is written to disk. A WebRTC
transport (full-duplex, lower latency) would need a media server or peer connection and can replace the polling
behind the same console logic. The phone's measured round trips land in the latency log as `phone_ms`.

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
Serve it behind HTTPS (e.g. a tunnel); the page loads NVIDIA Elements assets from jsDelivr and talks only
to this gateway. Everything below is configured through environment variables (or `backend/.env`).

## Configuration

### Models

| Variable | Default | Meaning |
| --- | --- | --- |
| `ORANGE_LLM_MODEL` | `google/gemma-4-26b-a4b-it` | Model id sent to the LLM endpoint for analysis and the AI operator's replies. |
| `ORANGE_CALLER_MODEL` | *= `ORANGE_LLM_MODEL`* | Model id for the simulated caller (can be a different, cheaper model). |
| `ORANGE_TTS_MODEL` | `mistralai/Voxtral-4B-TTS-2603` | Model id sent to the speech endpoint. |
| `ORANGE_STT_MODELS` | `nemotron,parakeet` | Accepted STT models, comma-separated; the first is the default. |
| `ORANGE_TTS_VOICES` | `fr_female,fr_male` | Voice presets the gateway accepts. |
| `ORANGE_LLM_LABEL`, `ORANGE_TTS_LABEL` | `Gemma 4`, `Voxtral` | Names the console shows (default: demo names, otherwise the id's last segment). |

`/api/health` publishes the active set under `models`; the console builds every displayed model name from it.

### Endpoints and runtime

| Variable | Default | Meaning |
| --- | --- | --- |
| `ORANGE_GEMMA_URL` | `http://127.0.0.1:8000/v1/chat/completions` | LLM endpoint (OpenAI-compatible). |
| `ORANGE_LLM_URL` | *= `ORANGE_GEMMA_URL`* | Where `/api/analyze` sends the AI operator's turn — point it at the guardrail proxy for option B. |
| `ORANGE_CALLER_LLM_URL` | *= `ORANGE_GEMMA_URL`* | Where the simulated caller's turn is sent. |
| `ORANGE_STT_URL` | `http://127.0.0.1:8098` | STT service base (`/transcribe`). |
| `ORANGE_TTS_URL` | `http://127.0.0.1:8011` | Speech service base (`/v1/audio/speech`, `/v1/models`). |
| `ORANGE_BIND`, `ORANGE_PORT` | `127.0.0.1`, `8092` | Listen address and port (`0.0.0.0` inside a container). |
| `ORANGE_PASSWORD_FILE` | `.access-password` | File holding the Basic-auth password of user `demo`. |
| `ORANGE_STATE_DIR`, `ORANGE_DB_PATH` | `state/`, `state/orange.db` | Runtime state and the SQLite database. |
| `ORANGE_STATIC_FILE` | `frontend/dist/urgence.html` | The page served at `/`. |
| `ORANGE_LINE_FILE` | `frontend/src/line.html` | The caller's phone page served at `/appel`. |
| `F5_GUARDRAILS_*` | unset | Option A guardrails (see `backend/env.example`). |

### Caller sites

| Variable | Default | Meaning |
| --- | --- | --- |
| `ORANGE_CALLERS` | unset (built-in caller) | Caller services by site: `name=url,...` (names: letters, digits, `_`, `-`). |
| `ORANGE_CALLER_TOKEN` | unset | Bearer token presented to every site (their `CALLER_TOKEN`). |
| `ORANGE_CALLER_TIMEOUT` | `60` | Seconds allowed for one remote turn. |
| `ORANGE_CALLER_FALLBACK` | `1` | `0`: a failing site is an error for that turn instead of a fallback to the built-in caller. |

The caller service reads `CALLER_LOCATION` (name shown), `CALLER_BIND` / `CALLER_PORT` (`0.0.0.0:8094`), `CALLER_TOKEN`,
`CALLER_LLM_URL` / `CALLER_LLM_MODEL`, `CALLER_TTS_URL` / `CALLER_TTS_MODEL` / `CALLER_TTS_VOICES`, `CALLER_TIMEOUT` and
`CALLER_FAKE` (+ `CALLER_FAKE_LLM_MS`, `CALLER_FAKE_TTS_MS`, `CALLER_FAKE_DELAY_MS`); see `caller/env.example`.

## Docker

The `Dockerfile` has three targets: `gateway` (the console's gateway, real model services), `caller` (the
simulated-caller service for a site) and `preview` (fake models and two fake caller sites, for UI review). The
commands work the same with `nerdctl`.

```bash
mkdir -p frontend/mockup && cp /path/to/urgence.html frontend/mockup/   # the mockup stays out of git
echo 'a-strong-password' > .access-password && chmod 600 .access-password

# With compose (gateway on the host network, models on the host's localhost):
docker compose up -d gateway
docker compose --profile caller up -d caller                # a caller site on :8094 (run at each site)
docker compose --profile preview up -d                      # UI review with fake models + fake sites on :8093
docker compose exec preview cat /app/state/.preview-password

# Or build and run by hand:
docker build --target gateway -t emergency-gtc/gateway .
docker build --target caller  -t emergency-gtc/caller .
docker build --target preview -t emergency-gtc/preview .

docker run -d --name orange-gateway --restart unless-stopped --network host \
  -e ORANGE_BIND=127.0.0.1 \
  -e ORANGE_LLM_MODEL=google/gemma-4-26b-a4b-it \
  -e ORANGE_CALLER_MODEL=google/gemma-4-26b-a4b-it \
  -e ORANGE_TTS_MODEL=mistralai/Voxtral-4B-TTS-2603 \
  -e ORANGE_STT_MODELS=nemotron,parakeet \
  -e ORANGE_GEMMA_URL=http://127.0.0.1:8000/v1/chat/completions \
  -e ORANGE_STT_URL=http://127.0.0.1:8098 \
  -e ORANGE_TTS_URL=http://127.0.0.1:8011 \
  -e ORANGE_CALLERS=paris=http://10.0.0.5:8094,montreal=https://caller-yul.example \
  -e ORANGE_CALLER_TOKEN=the-shared-token \
  -v "$PWD/state:/app/state" \
  -v "$PWD/.access-password:/run/secrets/access-password:ro" \
  emergency-gtc/gateway

# At a site (next to its own LLM and TTS; CALLER_FAKE=1 for a model-less site):
docker run -d --name orange-caller --restart unless-stopped --network host \
  -e CALLER_LOCATION=paris \
  -e CALLER_TOKEN=the-shared-token \
  -e CALLER_LLM_URL=http://127.0.0.1:8000/v1/chat/completions \
  -e CALLER_LLM_MODEL=google/gemma-4-26b-a4b-it \
  -e CALLER_TTS_URL=http://127.0.0.1:8011 \
  -e CALLER_TTS_MODEL=mistralai/Voxtral-4B-TTS-2603 \
  emergency-gtc/caller

docker run -d --name orange-preview --restart unless-stopped -p 127.0.0.1:8093:8093 \
  -v orange-preview-state:/app/state emergency-gtc/preview
docker exec orange-preview cat /app/state/.preview-password
```
Without host networking, point `ORANGE_GEMMA_URL` / `ORANGE_STT_URL` / `ORANGE_TTS_URL` (and the site's
`CALLER_LLM_URL` / `CALLER_TTS_URL`) at the model services' addresses and publish the ports with `-p` (the images
already listen on `0.0.0.0`). Add `-e ORANGE_LLM_URL=http://<proxy>:8100/v1/chat/completions` to route the AI
operator's turns through the F5 tee proxy. Every variable from the Configuration section can be passed the same way.
Leave `ORANGE_CALLERS` out for a single-site deployment. Expose a caller site only over a private network or VPN, or
behind TLS, and always with a token.

## Kubernetes (Envoy Gateway, NVIDIA Dynamo frontends)

`deploy/k8s/base` deploys the console (gateway + bridge, SQLite on a persistent volume), two caller sites and an
HTTPRoute; a cluster-specific overlay sets namespace, images, hostnames and the Dynamo frontends of each site. The
bridge (`backend/gcore_bridge.py`, started by the images' entrypoints when `GCORE_BASE_URL` or `GCORE_LLM_BASE_URL` /
`GCORE_ASR_BASE_URL` / `GCORE_TTS_BASE_URL` is set) maps the gateway's STT route to the frontends' realtime WebSocket
ASR, the Voxtral-style speech request to the Magpie TTS (preset voices → `GCORE_TTS_VOICES`) and passes chat
completions through; model names and labels then default to the Gcore stack's. See `deploy/k8s/README.md`.

## Storage

The gateway keeps everything in a SQLite database, `state/orange.db` (`ORANGE_DB_PATH`; in Docker the
`state` volume). It is created on first use: `snapshot` (the running vacation, restored on reload),
`vacations`, `calls` (summary, facts, signals, guardrail verdict, audit trail), `turns` (every transcript
line) and `latency` (one row per turn: site, fallback, the timings above). The browser saves every 2 s while
something changed. « Réinitialiser le poste » forgets the running vacation only; calls, transcripts and latency
samples stay. `python3 tools/db_report.py` lists them (`--transcript TEST-3`, `--csv calls.csv`, `--latency`).
All of it is synthetic data.

## Tests

```bash
make test                                   # controller + gateway + caller service unit tests
pip install -r requirements-dev.txt && python3 -m playwright install chromium
make e2e                                    # ORANGE_CHROMIUM=/path/to/chrome to use a specific build; --no-sites for the built-in caller
python3 tests/e2e/verify_local.py --guarded # fake F5 tee proxy on the LLM path
```

## Safety boundaries (by design)

No diagnosis, no medical gesture, no claim that help is on its way; the AI asks observation questions,
gives general safety instructions and hands over to a human on any guardrail block. Every call is
archived as requiring human review. The demonstration boundary is stated on the decision action and in
the system line it writes (the header tag was removed to keep the console sober).
