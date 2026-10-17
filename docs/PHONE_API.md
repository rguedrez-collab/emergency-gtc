# Phone API — place a call on the line from an app

The console's gateway exposes the caller's side of a call as a small HTTP API, so an Android app (native or an HTML
app in a WebView) can be the person on the phone. The console, open in a browser, picks the line up: the AI operator
answers, or a human takes the call. Everything is a demonstration: nothing is transmitted to real emergency services.

## Configuration (gateway)

| Variable | Meaning |
|---|---|
| `ORANGE_PHONE_KEYS` | Comma-separated API keys for the phone side. A key opens the line routes only (`/api/line…`, `/api/phone`, `/appel`). Without it, an app must use the console's user/password. |
| `ORANGE_CORS_ORIGINS` | Origins allowed to call the API from another site: `*` or a comma-separated list (e.g. `https://app.example,capacitor://localhost`). Needed by an HTML app; a native app does not care. |

Send the key as `Authorization: Bearer <key>` or `X-Api-Key: <key>`. Keys never reach the browser console or the repository.

## The flow

```
POST /api/line  {"name": "Camille"}                          -> {"id": "…", "token": "…", "poll_ms": 700}
GET  /api/line/{id}/events?since=0   (X-Line-Token)           -> {"status": "ringing|live|ended", "events": [...], "now": …}
POST /api/line/{id}/speech           (X-Line-Token, X-Filename: speech.webm, body = audio bytes)
GET  /api/line/{id}/audio/{idx}      (X-Line-Token)           -> audio/wav 24 kHz mono (a reply, by event index)
POST /api/line/{id}/latency          (X-Line-Token) {"rtt_ms": 2300, "handler": "ai"|"operator"}   (optional telemetry)
POST /api/line/{id}/end              (X-Line-Token)
GET  /api/phone                                               -> this contract, as JSON
```

Events (`type`): `speech` (what the phone sent, with `size`), `claimed` (the console took the line; `status` becomes `live`),
`reply` (`speaker`: `assistant` or `operator`, `text`, `size`; fetch the audio by `idx`), `end` (`by`: `phone` or `console`).
Poll `events` every `poll_ms` with `since` = last `idx` + 1. A line that nobody picks up stays `ringing` and is dropped
after 30 minutes without activity.

Accepted audio for `speech`: one utterance, 30 s at most, 15 MB at most, container by `X-Filename` extension:
`.webm` / `.ogg` (Opus), `.mp4` / `.m4a` (AAC), `.wav`, `.mp3`. Android `MediaRecorder` with `OutputFormat.MPEG_4` +
`AudioEncoder.AAC` gives a `.m4a`; Chrome's `MediaRecorder` gives `audio/webm;codecs=opus`.

## Minimal clients

HTML / JavaScript (works in Chrome on Android, a WebView, Capacitor; `tools/phone_client.html` is a complete one):

```js
const base = 'https://<console-host>', key = '<phone key>';
const H = {Authorization: 'Bearer ' + key};
const line = await (await fetch(base + '/api/line', {method: 'POST', headers: {...H, 'Content-Type': 'application/json'}, body: JSON.stringify({name: 'Camille'})})).json();
const L = {...H, 'X-Line-Token': line.token};
// record with MediaRecorder, then:
await fetch(`${base}/api/line/${line.id}/speech`, {method: 'POST', headers: {...L, 'Content-Type': 'application/octet-stream', 'X-Filename': 'speech.webm'}, body: blob});
// poll:
const d = await (await fetch(`${base}/api/line/${line.id}/events?since=${since}`, {headers: L})).json();
for (const e of d.events) if (e.type === 'reply') new Audio(URL.createObjectURL(await (await fetch(`${base}/api/line/${line.id}/audio/${e.idx}`, {headers: L})).blob())).play();
```

Kotlin (OkHttp), native Android:

```kotlin
val client = OkHttpClient(); val json = "application/json".toMediaType()
val base = "https://<console-host>"; val key = "<phone key>"
val line = JSONObject(client.newCall(Request.Builder().url("$base/api/line").header("Authorization", "Bearer $key")
    .post("""{"name":"Camille"}""".toRequestBody(json)).build()).execute().body!!.string())
val id = line.getString("id"); val token = line.getString("token")
// after MediaRecorder (MPEG_4 / AAC) wrote speech.m4a:
client.newCall(Request.Builder().url("$base/api/line/$id/speech").header("Authorization", "Bearer $key").header("X-Line-Token", token)
    .header("X-Filename", "speech.m4a").post(File(cacheDir, "speech.m4a").asRequestBody("application/octet-stream".toMediaType())).build()).execute()
// poll /api/line/$id/events?since=N with the same two headers; for a "reply" event download /api/line/$id/audio/{idx} and play it with MediaPlayer.
```

## Checks from a shell

```bash
curl -s -X POST https://<console-host>/api/line -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d '{"name":"Test"}'
curl -s https://<console-host>/api/phone -H "X-Api-Key: $KEY" | jq .
```

## Notes for the app

- The console must be open and in session in a browser for the line to be answered; the phone only sees `ringing` otherwise.
- Replies are WAV 24 kHz mono. Expect a few seconds between `speech` and the first `reply` (transcription, analysis, voice).
- `end` from the phone closes the call on the console side; `end` from the console appears as an `end` event with `by: console`.
- The key is shared by the demo's phones; rotate it by changing `ORANGE_PHONE_KEYS`.
