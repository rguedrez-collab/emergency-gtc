# Handoff — Orange · Triage IA des urgences

For the next engineer or AI agent. Everything here is about the application in this repository; deployment
hosts, credentials and partner contacts are deliberately kept outside it.

## What this is

A French emergency-call console for a demonstration: synthetic callers (100 scripted scenarios, 20 incident
families) are handled by an AI assistant — speech-to-text, contextual dialogue through an LLM, text-to-speech —
while a human operator supervises a *vacation* (shift): listens to calls, takes them over, reviews and files
them. Nothing is real: no telephony, no dispatch, no transmission to emergency services, no diagnosis.

## Architecture in one screen

```
browser (frontend/dist/urgence.html = mockup shell + src/logic.js)   gateway (backend/server.py, stdlib http.server)
  scheduler: 100 calls, 6 handled by the AI at once, 1 arrival / 6 s   Basic auth · per-service gates (2 slots each)
  audio hand-off: only the selected call is audible                   POST /api/caller   simulated caller line (LLM)
  console: list · call pane · copilot · situation board               POST /api/analyze  extraction + spoken reply (LLM)
  case lifecycle, persistence (snapshot every 2 s)                     POST /api/transcribe (STT) · POST /api/tts (TTS)
  themes: sobre (light) · sombre · verre liquide                       GET/POST /api/session  saved vacation (one owner)
                                                                       optional F5 AI Guardrails (Scans API or tee proxy)
```

- `frontend/build.mjs` embeds `src/logic.js` (with `src/samples.mjs` spliced in) and the `.oc-*` CSS into the mockup's
  template; every patch asserts it applied. The mockup is an external asset (`frontend/mockup/urgence.html` or `ORANGE_MOCKUP`).
- `frontend/src/logic.js` is a `DCLogic` component rendered by the mockup's engine; `renderVals()` feeds `liveControls`,
  `consoleView`, `audioPlayer`, `soundLabel`. All markup goes through `h()`; buttons are NVIDIA Elements
  `nve-button` via `button(label, action, disabled, id, title, {emphasis, tone, key, size})`.
- `backend/server.py` validates every model output (facts must quote the caller, replies pass a deterministic speech
  guard that forbids dispatch claims and medical gestures, one guarded rewrite, one anti-repetition rewrite).

## Invariants the scripts and tests rely on

- Element ids: `#orange-start-session`, `#orange-pause-session`, `#orange-stop-session`, `#orange-session-progress`,
  `#orange-settings`, `#orange-tools`, `#orange-new`, `#orange-scenario`, `#orange-stt`, `#orange-export`,
  `#orange-user-call`, `#orange-theme`, `#orange-close`, `#orange-retry`, `#orange-next`, `#orange-decision`,
  `#orange-close-case`, `#orange-more-*`, `#orange-audio-player` (always in the DOM, hidden on the overview,
  `data-speaker`/`data-playing`/`data-call`), `#orange-player-toggle`, `#orange-player-seek`, `#orange-speaker-label`.
- Text formats: the counter reads exactly `n/100 arrivés · n terminés · n échecs · en cours|en pause|arrêtée`;
  end labels keep the suffix `· à revoir`; the guardrail summary says `Dernier verdict : …`; the overview keeps
  the words `Sélectionnez un appel`.
- List DOM: alert items are `.oc-card[data-call]` (with `.oc-cardtoggle`, `.oc-title`), AI/ended items are
  `.oc-row[data-call]`; the harness helpers `orangeCards()/orangeRows()/orangeOpenFirst()` live in `tests/e2e/verify_local.py`.
- Export JSON: `calls[]` carry `tr`, `facts`, `gaps`, `audit`, `reviewRequired` (always true), `reviewed`.

## Behaviour worth knowing before changing anything

- Overview is silent; selecting a call enables its sound and starts its next turn at once; Escape returns.
- Arrivals count only AI-handled calls (`AI_CALLS = 6`); taken-over and manual calls never block arrivals.
- A call ends after 24 caller turns, or after its scripted turns once its target duration (150–240 s) elapsed;
  taken-over calls end only when the operator closes them. Ended calls queue under « Clôturés »; « Clore le
  dossier » files them under « Dossiers clos ».
- Every analysed call lands in « À traiter » by design (absence of signal ≠ absence of danger). Changing that
  to signal-only is an open product decision, not a bug.
- Persistence: `snapshot()`/`persist()`/`restore()`; one owner tab (id in `sessionStorage`), 15 s lease on the
  gateway, explicit takeover from « Reprendre ». Live microphone calls do not survive a reload.
- Themes are classes on `<html>` (`sober`, `dark`, `glass`, plus `flat` for the first two) and a swap of the
  mockup's ThemeProvider class; speaker colours are CSS variables resolved when the waveform is drawn.
- Guardrails: option A (gateway calls the Scans API before and after the model), option B (tee proxy on the
  LLM path; block = HTTP 200 + substituted sentence + `X-Tee-Prompt-Action: blocked`). A block holds the call
  for a human; nothing is closed automatically.

## How to verify

```bash
make test                                      # 45 controller checks (vm, stubbed React/Audio) + 50 backend tests
make build MOCKUP=/path/to/urgence.html        # frontend/dist/urgence.html (one backend test skips until it exists)
make e2e                                       # 12 headless checks with fake models (needs Playwright + Chromium)
python3 tests/e2e/verify_local.py --guarded | --oob | --realproxy | --soak 300
```
The fake models (`tests/e2e/verify_local.py`) follow an intake protocol so the preview reads like a real call, but
dialogue quality can only be judged with the real models.

## Open items

- Deploy this build to the demonstration host and run the real-model scripts there (kept with the deployment).
- F5 AI Guardrails: real tenant credentials, the tenant region, a joint test; confirm non-cleared outcome strings.
- Decide the « À traiter » policy (every call vs signal-only) with the product owner.
- The mockup's redistribution status before publishing `frontend/dist/` or `frontend/mockup/` anywhere.
