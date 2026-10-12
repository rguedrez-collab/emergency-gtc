# Orange · Triage IA des urgences — demonstration console

A French-language emergency-call console in which an AI assistant (Gemma 4 via an OpenAI-compatible
endpoint) handles synthetic incoming calls — transcription (Nemotron / Parakeet), contextual dialogue,
Voxtral speech — while a human operator supervises, listens in, takes calls over, reviews and files them.
Everything is synthetic: no real call, no dispatch, no transmission to emergency services.

## What is in this repository

| File | Role |
| --- | --- |
| `server.py` | Gateway (stdlib `http.server`, Basic auth). Routes: `/api/analyze`, `/api/caller`, `/api/transcribe`, `/api/tts`, `/api/health`, `/api/voices`, `/api/session` (vacation persistence). Per-service concurrency gates, speech guard, optional F5 AI Guardrails (out-of-band Scans API or tee proxy). |
| `logic.js` | Browser controller (React, embedded into the mockup's template engine): scheduler for 100 synthetic calls, audio hand-off, console UI, case lifecycle, persistence, themes. |
| `prepare_ui.mjs` | Build step: embeds `logic.js` and the console styles into the UI mockup and writes `generated/urgence.html` (+ `build.json` with hashes). |
| `samples.mjs` | 100 synthetic caller-only scenarios (20 incident families). |
| `preview_local.py` | Serves the built page locally with in-process fake models (no GPU) for UI review. |
| `test_server.py`, `test_controller.mjs` | Backend tests (unittest) and controller tests (Node, vm). |
| `verify_local.py` | Headless-browser acceptance harness against the real gateway code with fake models (`--guarded`, `--oob`, `--realproxy`, `--soak`, `--gaps-only`). |
| `env.example`, `tee-proxy.env.example`, `guardrail_proxy.sh` | Guardrail configuration templates and the script that runs F5's tee proxy next to the LLM. |

## What is deliberately *not* here

- **The UI mockup** (`urgence.html`, ~2.6 MB bundle). The build needs it: pass its path to `prepare_ui.mjs`
  or set `ORANGE_MOCKUP`. It embeds third-party UI libraries — check its redistribution terms before
  adding it or the generated page to any shared repository. `generated/` is git-ignored for that reason.
- **Deployment details** (hosts, SSH, tunnel URLs, VM scripts) and **credentials** (Basic-auth password,
  registry pull password, F5 token/project). Keep them in your private operations notes and in the
  git-ignored files `.access-password`, `.acr-password`, `.env`, `tee-proxy.env`.
- Model services. The gateway expects local OpenAI-compatible endpoints: LLM on `127.0.0.1:8000`,
  TTS on the Voxtral port, STT on `127.0.0.1:8098` (see `server.py`).

## Run locally (UI review, fake models)

```bash
export ORANGE_MOCKUP=/path/to/urgence.html
node prepare_ui.mjs                       # -> generated/urgence.html
python3 preview_local.py --password-file .preview-password   # user demo; the file is created if missing
# open http://127.0.0.1:8093
```

## Run the gateway (real models)

```bash
echo 'a-strong-password' > .access-password && chmod 600 .access-password
cp env.example .env   # optional: guardrail settings
python3 server.py     # 127.0.0.1:8092, user demo
```
Environment: `ORANGE_PORT`, `ORANGE_PASSWORD_FILE`, `ORANGE_STATE_DIR` (saved vacation, default `state/`),
`ORANGE_LLM_URL` / `ORANGE_CALLER_LLM_URL` (LLM endpoints; point the first at the tee proxy for option B),
`F5_GUARDRAILS_*` (option A). Serve it behind HTTPS (e.g. a tunnel); the page loads NVIDIA Elements assets
from jsDelivr and talks only to this gateway.

## Tests

```bash
node test_controller.mjs
python3 -m unittest discover -p 'test_*.py'
pip install -r requirements-dev.txt && python3 -m playwright install chromium
python3 verify_local.py            # ORANGE_CHROMIUM=/path/to/chrome to use a specific build
python3 verify_local.py --guarded  # fake F5 tee proxy on the LLM path
```

## Safety boundaries (by design)

No diagnosis, no medical gesture, no claim that help is on its way; the AI asks observation questions,
gives general safety instructions and hands over to a human on any guardrail block. Every call is
archived as requiring human review. The page states the demonstration boundary once (header tag) and
on the decision action.
