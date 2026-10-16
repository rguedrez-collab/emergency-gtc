# Handoff — Orange · Triage IA des urgences

For the next engineer or AI agent. Everything here is about the application in this repository; deployment
hosts, credentials and partner contacts are deliberately kept outside it.

## What this is

A French emergency-call console for a demonstration: synthetic callers (100 scripted scenarios, 20 incident
families) are handled by an AI assistant — speech-to-text, contextual dialogue through an LLM, text-to-speech —
while a human operator supervises a shift (called *session* on screen; `vacation` survives only in code and database
names): listens to calls, takes them over, reviews and files them. Nothing is real: no telephony, no dispatch, no transmission to emergency services, no diagnosis.

## Architecture in one screen

```
browser (frontend/dist/urgence.html = mockup shell + src/logic.js)   gateway (backend/server.py, stdlib http.server) — fixed
  scheduler: 100 calls, 6 handled by the AI at once, 1 arrival / 6 s   Basic auth · per-service gates (2 slots each)
  audio hand-off: only the selected call is audible                   POST /api/caller   caller line: forwarded to the call's site,
  console: list · call pane · copilot · situation board                                  or the built-in caller (own LLM, text only)
  case lifecycle, persistence (snapshot every 2 s)                     POST /api/analyze  extraction + spoken reply (LLM)
  themes: sobre (light) · sombre · verre liquide                       POST /api/transcribe (STT) · POST /api/tts (TTS)
  caller site per call (round robin / pinned), per-turn latency        GET/POST /api/session  saved vacation (one owner)
  samples posted after each turn                                       GET/POST /api/latency  per-site aggregates / one sample
                                                                       optional F5 AI Guardrails (Scans API or tee proxy)
caller sites (caller/service.py, one per location, next to its LLM + TTS; CALLER_* env; bearer token)
  GET /health · POST /turn {facts, style, messages, voice} -> {text, audio (base64 WAV), timings{llm_ms, tts_ms, total_ms}, location}
```

- `caller/simulation.py` holds the simulated caller's prompt, delivery profiles and validation; both the service and
  the gateway's built-in caller import it, so the two callers cannot drift apart. The gateway re-validates a site's
  answer (line + WAV) as model output, measures the round trip (`network_ms` = round trip − the site's `total_ms`),
  bypasses a failed site for 30 s (`caller_failures`) and announces fallbacks (`fallback`, `fallback_reason`,
  `requested_location`) so the console and the latency log show them. Remote turns take no Gemma gate slot.
- `frontend/build.mjs` embeds `src/logic.js` (with `src/samples.mjs` spliced in) and the `.oc-*` CSS into the mockup's
  template; every patch asserts it applied. The mockup is an external asset (`frontend/mockup/urgence.html` or `ORANGE_MOCKUP`).
- `frontend/src/logic.js` is a `DCLogic` component rendered by the mockup's engine; `renderVals()` feeds `liveControls` and
  `consoleView` (the mockup's own header labels and audio tag are removed by the build). All markup goes through `h()`; buttons are NVIDIA Elements
  `nve-button` via `button(label, action, disabled, id, title, {emphasis, tone, key, size})`.
- Models and endpoints are environment-driven (`ORANGE_LLM_MODEL`, `ORANGE_CALLER_MODEL`, `ORANGE_TTS_MODEL`,
  `ORANGE_STT_MODELS`, `ORANGE_TTS_VOICES`, `ORANGE_*_URL`, `ORANGE_*_LABEL`); `/api/health` publishes them under
  `models` and the console derives every displayed model name from it (`labels()`), so the UI never hard-codes a model.
- `backend/server.py` validates every model output (facts must quote the caller, replies pass a deterministic speech
  guard that forbids dispatch claims and medical gestures, one guarded rewrite, one anti-repetition rewrite).

## Invariants the scripts and tests rely on

- Element ids: `#orange-start-session`, `#orange-pause-session`, `#orange-stop-session`, `#orange-analytics`,
  `#orange-session-progress` (inside the Analytique panel: open it first, see the harness's `open_analytics`),
  `#orange-settings`, `#orange-tools`, `#orange-new`, `#orange-scenario`, `#orange-stt`, `#orange-export`,
  `#orange-user-call`, `#orange-theme`, `#orange-site` (only with caller sites), `#orange-close`, `#orange-retry`,
  `#orange-next`, `#orange-decision`, `#orange-close-case`, `#orange-more-*` (incl. `latency`), `#orange-console` (the
  console root, present once a session exists; carries `data-speaker`/`data-playing`/`data-call` for the scripts — the
  fixed audio player and its controls were removed on request, there is no play/pause control).
- Transcript turns show the avatar only (robot for the AI, person for the caller and the operator; speaker and time in
  the avatar's tooltip), no speaker label or clock in front of the bubble; system lines have no head at all.
- Caller identity: `c.phone` is a fictional European number generated per sample (`fakePhone`: mostly +33 in the ARCEP
  fictional mobile range 06 39 98 xx xx, some +49 / +34 / +39), always with two digits masked (`••`) so nothing shown
  is dialable; shown in the call header and the card details, exported with the call. No caller-ID integration exists.
- Bar: actions on the left (open / pause / close), on the right the read-only notice when any, the services chip
  **only as an exception** (a service down, a guardrail configured, a caller site unreachable; nothing otherwise),
  « Analytique » (counter + latency medians) and « Réglages ». The « Démonstration » tag, the mockup's header shift
  clock (« Vacation … ») and its sound label were removed on request; the AI's transcript bubbles are black with
  white text in every theme.
- Text formats: the counter reads exactly `n/100 arrivés · n terminés · n échecs · en cours|en pause|arrêtée`;
  end labels keep the suffix `· à revoir`; the guardrail summary says `Dernier verdict : …`; the overview keeps
  the words `Sélectionnez un appel`; the copilot's latency block is titled `Latence · dernier tour`, the board's
  `Sites appelants · latence`; durations are formatted by `fmtMs` with a narrow no-break space (U+202F) as thousands
  separator; the built-in caller is named `passerelle` on screen and `local` in payloads and the database.
- Tool log names: `Appelant · <site>` for a caller line (result `<ms> ms`, `· repli sur la passerelle` on fallback),
  `<LLM label>` for analysis, `<TTS label> TTS`, `STT`.
- Per-call latency line: `.oc-callmeta.oc-latency`, text `<site> · appelant <ms>` (`oc-site-warn` on fallback), tooltip
  with the median and the network share; absent until the first generated caller line, and on ended rows. On cards it
  shares the last line with the primary action; cards show no processing status (« IA · tour n · … » was removed on
  request), only the signal to check or « en ligne · opérateur ». AI rows keep `id · tour n · state`.
- List DOM: alert items are `.oc-card[data-call]` (with `.oc-cardtoggle`, `.oc-title`), AI/ended items are
  `.oc-row[data-call]`; the harness helpers `orangeCards()/orangeRows()/orangeOpenFirst()` live in `tests/e2e/verify_local.py`.
- Export JSON: `calls[]` carry `tr`, `facts`, `gaps`, `audit`, `reviewRequired` (always true), `reviewed`, `location`,
  `lastCaller`, `latency[]` (per-turn samples, at most 60 per call); the root carries `caller_sites` and the gateway's
  `latency` aggregates.
- Latency sample (browser → `POST /api/latency`, table `latency`): `location` (site that answered, `local`, or `ligne`
  for a real caller's phone), `requested`, `fallback`, `handler` (`ai` | `operator`: who answered that turn),
  `caller_ms`, `network_ms`, `llm_ms`, `tts_ms`, `stt_ms`, `analyze_ms`, `reply_tts_ms`, the operator's own
  `operator_ms` (reaction: caller's last words → answer sent / started speaking), `op_tts_ms`, `op_stt_ms`, and
  `phone_ms` (a round trip measured by the phone, posted through `/api/line/<id>/latency`), plus `call`, `turn`, `base`
  (the vacation's time base, joins `calls(base, id)`). The scripted opening line carries no caller timing
  (`scripted: true`, ignored by the per-site statistics). `GET /api/latency` returns `sites`, `console`, `handlers`
  (ai / operator aggregates kept apart) and `phone`. Columns added later are created on open (`LATENCY_ADDED_COLUMNS`).
- Mobile line (a real caller on a phone, page `/appel` = `frontend/src/line.html`, `ORANGE_LINE_FILE`): `POST /api/line`
  creates a line `{id, token}`; the phone posts recordings to `/api/line/<id>/speech` (its token, `X-Line-Token`), polls
  `/api/line/<id>/events?since=`, fetches `/api/line/<id>/audio/<idx>`, posts `/api/line/<id>/latency` and
  `/api/line/<id>/end`. The console (operator credentials, no token) lists `/api/line/pending` every second, adopts
  each line as a manual call (`createCall(false, {line})` → `c.lineId`, category « Appel entrant · ligne mobile »,
  alerted at once), `claim`s it, pulls its events (`pollLineEvents` → `lineSpeech`: play to the operator when open,
  transcribe, `analyzeCall`), and posts every spoken reply (AI or operator) as WAV to `/api/line/<id>/reply`
  (`deliver`). Lines live in memory, expire after 30 min, keep at most 80 events. The fake models answer a non-WAV
  recording with one canned sentence so the preview and e2e can exercise the loop.

## Behaviour worth knowing before changing anything

- Overview is silent; selecting a call enables its sound and starts its next turn at once; Escape returns.
- Arrivals count only AI-handled calls (`AI_CALLS = 6`); taken-over and manual calls never block arrivals.
- A call ends after 24 caller turns, or after its scripted turns once its target duration (150–240 s) elapsed;
  taken-over calls end only when the operator closes them. Ended calls queue under « Clôturés »; « Clore le
  dossier » files them under « Dossiers clos ».
- Every analysed call lands in « À traiter » by design (absence of signal ≠ absence of danger). Changing that
  to signal-only is an open product decision, not a bug.
- Persistence: `snapshot()`/`persist()`/`restore()` on the browser side; the gateway stores the snapshot and the
  relational `vacations` / `calls` / `turns` tables in SQLite (`state/orange.db`, `ORANGE_DB_PATH`, schema created on
  first use, WAL). One owner tab (id in `sessionStorage`), 15 s lease, explicit takeover from « Reprendre ».
  Live microphone calls do not survive a reload. Clearing the poste deletes the snapshot only; history stays
  (`tools/db_report.py`).
- Themes are classes on `<html>` (`sober`, `dark`, `glass`, plus `flat` for the first two) and a swap of the
  mockup's ThemeProvider class; speaker colours are CSS variables resolved when the waveform is drawn.
- Dialogue steering (`backend/server.py`): the gateway keeps the intake checklist (`intake_state`) and tells the
  model what to ask next with the reference wording (`recueil.à_demander`, from `QUESTIONS`). Relevance: the
  person's state only when a victim is described, dangers only when the incident suggests one, the number of
  people only for collective events, never the callback number; a short « non » settles the question just asked;
  the address question is never dropped (`location`, then `location_again`) and a reply that paraphrases it away
  is replaced; « je ne sais pas si elle respire » brings the two observation steps (`breathing`, `response_check`).
  Outdoors (`OUTDOOR_CUES` on the first line, its street address set aside) a `landmark` is asked instead of the
  floor or door code (`access`). After the essentials come what the crew asks (`age`, `history` when a victim is described, then the caller's `name`);
  a short answer settles the question just asked (never the address); when the person has just stopped breathing
  (`STRONG`) no administrative question is asked that turn. `recueil.phase` turns to `accompagnement` once the
  essentials are known or a dispatch is validated, and the fallbacks add `guide` and `prepare` (not next to smoke).
  Replies that repeat (stems, three-word runs), echo the caller, pile up questions (`overloaded`) or tell the caller
  to call the services (`CALL_US`) get one rewrite then the checklist's own line (`fallback_reply`, with
  `escalation` when the person just stopped breathing and `guide` once help is on its way). The console sends the
  operator's done tool calls (`actions`); a validated dispatch lets the AI say once that help is coming
  (`ARRIVAL_CLAIMS` allowed only then, never with a delay).
- Simulated caller (`caller/simulation.py`): spoken-register prompt (answer the question first, each fact once, tics
  once per call, vouvoiement, no medical gesture of its own), `repeats` + a nudged resample, `drop_repeated_sentences`,
  `trim_tics`; openings, landmarks, accesses, the person's `age`/`health` and a `person` fact with the pronoun vary per
  sample (`frontend/src/samples.mjs`), so the caller can answer the crew's questions truthfully.
- Rewrite requests (`retry_prompt`) keep the shape of a normal request: the refused line and the instruction travel
  inside the JSON user message (`reprise`), because a guardrail that scans the last user message reads a bare
  instruction appended after the model's turn as a prompt injection and blocks it. A truncated rewrite leaves the
  checklist's line in place; a second guard block stays an explicit failure.
- Kubernetes: the console's state volume is mounted root-owned; the pod `fsGroup` (10001) in `deploy/k8s/base/console.yaml`
  is what lets the gateway create its SQLite database there.
- Guardrails: option A (gateway calls the Scans API before and after the model), option B (tee proxy on the
  LLM path; block = HTTP 200 + substituted sentence + `X-Tee-Prompt-Action: blocked`). A block holds the call
  for a human; nothing is closed automatically.
- Caller sites: `pickLocation()` assigns a site to each new scenario call (ready sites in turn, or the pinned
  `sitePolicy`, or `local`); `callerLine()` posts `/api/caller` with `location`, `voice`, `call`, `turn` and uses the
  returned audio when there is one (no `/api/tts` for that line); `recordLatency()` posts one sample per turn at the end
  of `analyzeCall()`. The gateway's health lists `callers[]` (`ready`, `rtt_ms`, `label`, `paused`) and
  `services.callers.ready`; a site down only adds a warning dot (« Sites appelants ») because the built-in caller
  takes over. The guardrail e2e modes keep the built-in caller (their fake scripts specific injection lines).

## How to verify

```bash
make test                                      # 53 controller checks (vm, stubbed React/Audio) + 61 backend + 10 caller-service tests
make build MOCKUP=/path/to/urgence.html        # frontend/dist/urgence.html (one backend test skips until it exists)
make e2e                                       # 14 headless checks: fake models, two fake caller sites, one simulated phone line (needs Playwright + Chromium)
python3 tests/e2e/verify_local.py --guarded | --oob | --realproxy | --soak 300 | --no-sites
```
The fake models (`tests/e2e/verify_local.py`) follow an intake protocol so the preview reads like a real call, but
dialogue quality can only be judged with the real models. The fake caller sites (`start_fake_sites`, also used by
`tools/preview_local.py`) run the real `caller/service.py` code in `CALLER_FAKE` mode with an extra delay per site
(`lyon +40 ms`, `montreal +150 ms`); their silent WAV carries its text in a private RIFF chunk (`simulation.fake_wav`
/ `text_in_wav`) so the fake STT reads it back.

## Tool calls

- `propose_tools()` (rules on the caller's words + the model's valid `tools`), `run_tool()` behind `POST /api/tool`
  (`lookup_address` → `GEOCODER_URL`, best effort; dispatch tools need `approve: true` and only return a simulated
  decision). The console's `proposeTools()` dedupes per call, runs lookups at once, leaves dispatches « à valider »;
  `approveTool()` records `simulated_dispatch` in the audit and a system line, `declineTool()` records `tool_declined`.
  Copilot block « Actions · outils » (`.oc-action`, buttons `#orange-approve-A<n>` / `#orange-decline-A<n>`); the board's
  feed shows validated dispatches and recognised addresses. `c.actions` persists (snapshot, export, `calls.actions`).

## Kubernetes

- `deploy/k8s/base` (kustomize): console Deployment (gateway + `backend/gcore_bridge.py` via `backend/entrypoint.sh`),
  PVC for `/app/state`, two caller-site Deployments (`caller/entrypoint.sh` starts the same bridge), Services, one
  HTTPRoute with 180 s timeouts. Both images answer `GET /healthz` without auth for the probes.
- The bridge translates for NVIDIA Dynamo OpenAI frontends: `/stt/transcribe` → `/v1/realtime` WebSocket (24 kHz
  PCM16, explicit commits, `GCORE_ASR_LANGUAGE`), `/tts/v1/audio/speech` → Magpie voices (`GCORE_TTS_VOICES`, raw PCM
  wrapped in WAV, no tempo), chat completions passed through; one origin per model (`GCORE_*_BASE_URL`) or one for all
  (`GCORE_BASE_URL`). ffmpeg is in the gateway image for browser/phone recordings.
- The cluster overlay (namespace, registry, hostnames, frontend Services) is private; it names hosts.

## Open items

- Deploy this build to the demonstration host and run the real-model scripts there (kept with the deployment).
- Caller sites with real models: run `caller/service.py` (or the `caller` image) at a second location with its own
  LLM + TTS, set `ORANGE_CALLERS` / `ORANGE_CALLER_TOKEN` on the gateway, and compare `GET /api/latency` across
  sites; the fake sites only prove the plumbing and the measurement path.
- F5 AI Guardrails: real tenant credentials, the tenant region, a joint test; confirm non-cleared outcome strings.
- Decide the « À traiter » policy (every call vs signal-only) with the product owner.
- The mockup's redistribution status before publishing `frontend/dist/` or `frontend/mockup/` anywhere.

- Address lookup (`lookup_address`): spelled-out house numbers become digits (`digits_from_words`), the city named after
  « à » or a comma is located first (`type=municipality`) and the street is searched near it, then inside it
  (`citycode`); a match in another commune is reported as « aucune correspondance … pour <ville> ».
