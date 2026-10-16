"""Caller service: the simulated caller as its own deployable, so the voice on the other end of the line can live
far from the console (another site, region or cloud) while the console and its gateway stay where they are.

The gateway (backend/server.py, ORANGE_CALLERS) forwards each caller turn to one of these services and measures the
round trip. This service generates the caller's next line with the LLM next to it and speaks it with the speech
model next to it, then answers with the text, the WAV audio and its own timings. Standard library only.

  python3 caller/service.py                     # listens on CALLER_BIND:CALLER_PORT (0.0.0.0:8094)

Routes (JSON; Authorization: Bearer <CALLER_TOKEN> when a token is configured)
  GET  /health   {ready, location, models, services}
  POST /turn     {facts, style, messages, voice} -> {text, audio (base64 WAV), timings {llm_ms, tts_ms, total_ms}, location, model}

Environment
  CALLER_LOCATION      name shown in the console for this site (default: the host name)
  CALLER_BIND, CALLER_PORT   listen address (default 0.0.0.0:8094)
  CALLER_TOKEN         bearer token the gateway must present (empty = open; keep it on a private network then)
  CALLER_LLM_URL       OpenAI-compatible chat endpoint (default http://127.0.0.1:8000/v1/chat/completions)
  CALLER_LLM_MODEL     model id for the caller's lines (default google/gemma-4-26b-a4b-it)
  CALLER_TTS_URL       speech service base (default http://127.0.0.1:8011; uses /v1/audio/speech and /v1/models)
  CALLER_TTS_MODEL     speech model id (default mistralai/Voxtral-4B-TTS-2603)
  CALLER_TTS_VOICES    accepted voice presets (default fr_female,fr_male)
  CALLER_TIMEOUT       seconds allowed for each model request (default 60)
  CALLER_FAKE=1        no models: scripted lines and silent WAV that carries its text (demos of the topology, tests);
                       CALLER_FAKE_LLM_MS / CALLER_FAKE_TTS_MS shape its own timings, CALLER_FAKE_DELAY_MS is added to
                       every request outside them (it stands for the network distance the gateway measures)
Nothing is logged about the dialogue; no transcript or audio is kept here.
"""
import base64
from concurrent.futures import ThreadPoolExecutor
import hmac
import http.server
import json
import os
import re
import socket
import socketserver
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from caller import simulation  # noqa: E402

DEFAULT_LLM_URL = "http://127.0.0.1:8000/v1/chat/completions"
DEFAULT_TTS_URL = "http://127.0.0.1:8011"
DEFAULT_LLM_MODEL = "google/gemma-4-26b-a4b-it"
DEFAULT_TTS_MODEL = "mistralai/Voxtral-4B-TTS-2603"
MAX_BODY = 100_000
NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.\-]{0,39}$")


def settings(env=None, **overrides):
    """Runtime settings from the environment (read when called, so a process picks up its .env once at start)."""
    env = os.environ if env is None else env
    cfg = {
        "location": env.get("CALLER_LOCATION") or socket.gethostname()[:40],
        "bind": env.get("CALLER_BIND", "0.0.0.0"), "port": int(env.get("CALLER_PORT", "8094")),
        "token": env.get("CALLER_TOKEN", ""),
        "llm_url": env.get("CALLER_LLM_URL", DEFAULT_LLM_URL), "llm_model": env.get("CALLER_LLM_MODEL", DEFAULT_LLM_MODEL),
        "tts_url": env.get("CALLER_TTS_URL", DEFAULT_TTS_URL).rstrip("/"), "tts_model": env.get("CALLER_TTS_MODEL", DEFAULT_TTS_MODEL),
        "voices": tuple(v.strip() for v in env.get("CALLER_TTS_VOICES", ",".join(simulation.DEFAULT_VOICES)).split(",") if v.strip()) or simulation.DEFAULT_VOICES,
        "timeout": float(env.get("CALLER_TIMEOUT", "60")),
        "fake": env.get("CALLER_FAKE", "") not in ("", "0", "false", "no"),
        "fake_llm_ms": int(env.get("CALLER_FAKE_LLM_MS", "900")), "fake_tts_ms": int(env.get("CALLER_FAKE_TTS_MS", "700")),
        "fake_delay_ms": int(env.get("CALLER_FAKE_DELAY_MS", "0")),
    }
    cfg.update(overrides)
    if not NAME.match(cfg["location"]):
        raise ValueError("CALLER_LOCATION: letters, digits, space, _ . - only (40 characters)")
    return cfg


def request(url, payload=None, headers=None, timeout=60):
    data = json.dumps(payload).encode() if isinstance(payload, dict) else payload
    req = Request(url, data=data, headers=headers or {"Content-Type": "application/json"})
    with urlopen(req, timeout=timeout) as response:
        return response.read(), dict(response.headers)


def complete(prompt, temperature, cfg):
    body, _ = request(cfg["llm_url"], simulation.chat_request(prompt, temperature, cfg["llm_model"]), timeout=cfg["timeout"])
    return simulation.completion_json(body)


def speak(text, voice, style, cfg):
    data, _ = request(cfg["tts_url"] + "/v1/audio/speech", simulation.speech_request(text, voice, style, cfg["tts_model"]), timeout=cfg["timeout"])
    if not data.startswith(b"RIFF"):
        raise RuntimeError("invalid speech response")
    return data


# --- Fake models: the caller answers whatever the operator just asked, from the sample's facts; the audio is silence
# of a plausible length carrying its text (see simulation.fake_wav), so a fake transcriber reads it back.
FAKE_ANSWERS = [
    (r"où êtes-vous|adresse|ville|lieu", "Oui, c'est au {address}. Faites vite, s'il vous plaît, je ne sais pas quoi faire."),
    (r"consciente|respire|état", "Elle… elle ne bouge presque pas. Je crois qu'elle respire, mais c'est faible, je ne suis pas sûr."),
    (r"quelqu'un d'autre|avec vous|combien", "Je ne sais pas combien de personnes il y a, je n'ai pas tout vu. Un voisin arrive."),
    (r"accède|accès|entrée|guider", "L'entrée, c'est {access}. Vous m'entendez toujours ?"),
    (r"votre nom|rappeler|numéro", "Je m'appelle {name}. Je vous en prie, restez avec moi."),
    (r"changé|ligne|repère", "Il y a {landmark}. Rien n'a changé, je crois… Je suis vraiment inquiet."),
]
FAKE_LINES = ["Ça fait {elapsed}, à peu près. Je suis vraiment inquiet.", "Je reste ici, je ne bouge pas. Dites-moi quoi faire.",
              "Vous m'entendez toujours ? S'il vous plaît, restez avec moi."]


def fake_complete(prompt, temperature, cfg, turn=[0]):
    body = json.loads(prompt[1]["content"])
    facts, dialogue = body["facts"], body.get("dialogue", [])
    asked = next((m["text"] for m in reversed(dialogue) if m["role"] in ("assistant", "operator")), "").lower()
    turn[0] += 1
    line = next((answer for pattern, answer in FAKE_ANSWERS if re.search(pattern, asked)), FAKE_LINES[turn[0] % len(FAKE_LINES)])
    fill = {k: facts.get(k) or "là où je suis" for k in ("address", "landmark", "elapsed", "access", "name")}
    time.sleep(cfg["fake_llm_ms"] / 1000)
    return {"utterance": line.format(**fill)}


def fake_speak(text, voice, style, cfg):
    time.sleep(cfg["fake_tts_ms"] / 1000)
    return simulation.fake_wav(text)


def turn(payload, cfg):
    """One caller turn: validate, generate the line, speak it, time each step."""
    data = simulation.validate_turn(payload, cfg["voices"])
    start = time.monotonic()
    prompt = simulation.build_prompt(data["facts"], data["style"], data["messages"])
    completer = (lambda p, t: fake_complete(p, t, cfg)) if cfg["fake"] else (lambda p, t: complete(p, t, cfg))
    text, retries = simulation.generate(prompt, completer, messages=data["messages"])
    llm_done = time.monotonic()
    audio = fake_speak(text, data["voice"], data["style"], cfg) if cfg["fake"] else speak(text, data["voice"], data["style"], cfg)
    end = time.monotonic()
    return {"text": text, "audio": base64.b64encode(audio).decode("ascii"), "location": cfg["location"],
            "model": "fake" if cfg["fake"] else cfg["llm_model"], "tts_model": "fake" if cfg["fake"] else cfg["tts_model"],
            "voice": data["voice"], "delivery": data["style"], "retries": retries,
            "timings": {"llm_ms": round((llm_done - start) * 1000), "tts_ms": round((end - llm_done) * 1000), "total_ms": round((end - start) * 1000)}}


def health(cfg):
    if cfg["fake"]:
        services = {"llm": {"ready": True, "fake": True}, "tts": {"ready": True, "fake": True}}
    else:
        origin = urlsplit(cfg["llm_url"])

        def check(item):
            name, url = item
            try:
                request(url, timeout=3)
                return name, {"ready": True}
            except Exception:
                return name, {"ready": False}
        with ThreadPoolExecutor(max_workers=2) as pool:
            services = dict(pool.map(check, [("llm", f"{origin.scheme}://{origin.netloc}/v1/models"), ("tts", cfg["tts_url"] + "/v1/models")]))
    return {"ready": all(s["ready"] for s in services.values()), "location": cfg["location"], "service": "orange-caller",
            "models": {"llm": "fake" if cfg["fake"] else cfg["llm_model"], "tts": "fake" if cfg["fake"] else cfg["tts_model"], "voices": list(cfg["voices"])},
            "services": services, "fake": cfg["fake"]}


class Handler(http.server.BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(150)

    def log_message(self, *args):
        pass  # never log dialogue, audio or tokens

    @property
    def cfg(self):
        return self.server.cfg

    def reply(self, status, data, extra=None):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Caller-Location", self.cfg["location"])
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def distance(self):
        # Fake mode: the extra delay stands in for the network distance, so it sits outside the timed work and shows up
        # in the gateway's round trip (network_ms, health rtt_ms) rather than in this site's own timings.
        if self.cfg["fake"] and self.cfg["fake_delay_ms"]:
            time.sleep(self.cfg["fake_delay_ms"] / 1000)

    def authorized(self):
        self.distance()
        token = self.cfg["token"]
        if not token:
            return True
        supplied = self.headers.get("Authorization", "").encode("latin-1", "replace")
        if hmac.compare_digest(supplied, ("Bearer " + token).encode()):
            return True
        self.reply(401, {"error": "bearer token required"}, {"WWW-Authenticate": "Bearer"})
        return False

    def do_GET(self):
        if urlsplit(self.path).path == "/healthz":  # orchestrator probe: no token, no model probe
            self.reply(200, {"ok": True})
            return
        if not self.authorized():
            return
        if urlsplit(self.path).path in ("/", "/health"):
            self.reply(200, health(self.cfg))
        else:
            self.reply(404, {"error": "not found"})

    do_HEAD = do_GET

    def do_POST(self):
        if not self.authorized():
            return
        if urlsplit(self.path).path != "/turn":
            self.reply(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY or self.headers.get("Transfer-Encoding"):
                self.reply(413 if length > MAX_BODY else 400, {"error": "invalid request size"})
                return
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                raise ValueError("application/json required")
            payload = json.loads(self.rfile.read(length))
            self.reply(200, turn(payload, self.cfg))
        except (ValueError, TypeError) as exc:
            self.reply(400, {"error": str(exc)[:240]})
        except simulation.SimulationError as exc:
            self.reply(502, {"error": str(exc)})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:  # model service failure: the type only, never the upstream address
            self.reply(502, {"error": "Service modèle du site appelant en échec.", "detail": type(exc).__name__})


def make_server(cfg, bind=None, port=None):
    """A threaded server carrying its settings (tests and the preview run several in one process)."""
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    socketserver.ThreadingTCPServer.daemon_threads = True
    httpd = socketserver.ThreadingTCPServer((cfg["bind"] if bind is None else bind, cfg["port"] if port is None else port), Handler)
    httpd.cfg = cfg
    return httpd


def load_env_file(path):
    try:
        lines = Path(path).read_text().splitlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def serve():
    load_env_file(Path(__file__).resolve().parent / ".env")
    cfg = settings()
    with make_server(cfg) as httpd:
        print(f"Caller service '{cfg['location']}' listening on {cfg['bind']}:{cfg['port']}; "
              f"{'fake models' if cfg['fake'] else 'LLM ' + cfg['llm_model'] + ' · TTS ' + cfg['tts_model']}; "
              f"{'bearer token required' if cfg['token'] else 'no token (private network only)'}", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    serve()
