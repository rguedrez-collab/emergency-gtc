"""Bridge between the gateway (server.py) or the caller service and NVIDIA Dynamo OpenAI frontends (the Gcore
inference stack): an LLM, a Magpie TTS and a realtime Nemotron ASR, each behind its own origin or all behind one.

server.py and caller/service.py talk to services with the demonstration's conventions (Voxtral-style /v1/audio/speech
with preset voices and a tempo, a /transcribe route for STT); the Dynamo frontends serve the models with different
ones. This bridge listens on loopback and translates:

  POST /v1/chat/completions     -> router /v1/chat/completions (as is)
  GET  /v1/health/ready         -> ready when the router lists the LLM
  GET  /v1/models               -> router /v1/models (the gateway probes the tee proxy, and so the bridge, with it)
  GET  /tts/v1/models           -> router /v1/models
  GET  /tts/v1/audio/voices     -> the voice mapping below
  POST /tts/v1/audio/speech     -> router /v1/audio/speech: preset voice -> Magpie voice, fr -> fr-FR, no speed or
                                   response_format; the raw PCM answer is wrapped in a WAV header
  GET  /stt/                    -> {"loaded": [ASR model]} when the router lists it
  POST /stt/transcribe          -> router realtime WebSocket (/v1/realtime): 24 kHz mono PCM16, explicit commits

  python3 backend/gcore_bridge.py      # GCORE_BASE_URL (or the three GCORE_*_BASE_URL) required; 127.0.0.1:8101

Environment: GCORE_BASE_URL (one origin for the three models, e.g. a Dynamo global gateway) or GCORE_LLM_BASE_URL /
GCORE_ASR_BASE_URL / GCORE_TTS_BASE_URL (one frontend each; each falls back to GCORE_BASE_URL), GCORE_API_KEY (optional
bearer token), GCORE_LLM_MODEL (else ORANGE_LLM_MODEL), GCORE_ASR_MODEL, GCORE_ASR_LANGUAGE, GCORE_ASR_PAD_MS (silence added before,after each utterance, default
"300,700": the streaming recogniser then settles the first and last words and their liaisons), GCORE_TTS_RATE,
GCORE_TTS_VOICES, GCORE_TTS_NORMALIZE (1: French text normalisation before synthesis — numbers and ordinals in words,
usual abbreviations expanded, typographic characters plain — so the voice does not stumble), GCORE_BRIDGE_BIND,
GCORE_BRIDGE_PORT.
Audio other than WAV (browser or phone microphone: webm/opus, ogg, mp4) is decoded with ffmpeg when it is on the PATH.
"""
import array
import base64
import hashlib
import http.server
import json
import os
import re
import shutil
import socket
import socketserver
import ssl
import struct
import subprocess
import sys
import threading
import time
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

BASE = os.environ.get("GCORE_BASE_URL", "").rstrip("/")
BASES = {kind: (os.environ.get(f"GCORE_{kind}_BASE_URL") or BASE).rstrip("/") for kind in ("LLM", "ASR", "TTS")}
API_KEY = os.environ.get("GCORE_API_KEY", "")
LLM_MODEL = os.environ.get("GCORE_LLM_MODEL") or os.environ.get("ORANGE_LLM_MODEL", "")
ASR_MODEL = os.environ.get("GCORE_ASR_MODEL", "nemotron-asr-streaming")
ASR_LANGUAGE = os.environ.get("GCORE_ASR_LANGUAGE", "fr-FR")  # empty: the router's default (en-US worker)
TTS_RATE = int(os.environ.get("GCORE_TTS_RATE", "24000"))   # the Dynamo TTS worker's --sample-rate-hz
# Preset -> Magpie voice. The emotional presets (caller/simulation.py) use Pascal's French variants and, for the female
# voice, Magpie's multilingual speakers (every Magpie voice speaks French). GCORE_TTS_VOICES overrides any of them.
DEFAULT_TTS_VOICES = ("fr_female=Magpie-Multilingual.FR-FR.Louise,fr_male=Magpie-Multilingual.FR-FR.Pascal,"
                      "fr_female_fearful=Magpie-Multilingual.EN-US.Aria.Fearful,fr_female_pressed=Magpie-Multilingual.ES-US.Isabela.Fearful,"
                      "fr_female_worried=Magpie-Multilingual.ES-US.Sofia.Fearful,fr_female_calm=Magpie-Multilingual.EN-US.Mia.Calm,"
                      "fr_male_fearful=Magpie-Multilingual.EN-US.Leo.Fearful,fr_male_pressed=Magpie-Multilingual.FR-FR.Pascal.Angry,"
                      "fr_male_worried=Magpie-Multilingual.FR-FR.Pascal.Sad,fr_male_calm=Magpie-Multilingual.FR-FR.Pascal.Calm")
TTS_VOICES = dict(item.split("=", 1) for item in DEFAULT_TTS_VOICES.split(",") if "=" in item)
TTS_VOICES.update(item.split("=", 1) for item in os.environ.get("GCORE_TTS_VOICES", "").split(",") if "=" in item)
LANGUAGES = {"fr": "fr-FR", "en": "en-US"}  # the TTS worker wants a locale, the gateway sends a bare code
ASR_RATE = 24000                             # the realtime adapter accepts 24 kHz PCM16 only
ASR_PAD_MS = tuple(int(x) for x in (os.environ.get("GCORE_ASR_PAD_MS", "300,700").split(",") + ["0"])[:2])
TTS_NORMALIZE = os.environ.get("GCORE_TTS_NORMALIZE", "1") not in ("0", "false", "no")
MAX_TURN_S = 55                              # the adapter refuses utterances over 60 s: longer audio is several commits
APPEND_BYTES = 48000                         # 1 s of audio per input_audio_buffer.append
MAX_BODY = 20 * 1024 * 1024


class UpstreamError(Exception):
    def __init__(self, status, body, content_type="application/json"):
        super().__init__(f"HTTP {status}")
        self.status, self.body, self.content_type = status, body, content_type


def upstream(path, payload=None, timeout=120, kind="LLM"):
    headers = {"Content-Type": "application/json"}
    if API_KEY:
        headers["Authorization"] = "Bearer " + API_KEY
    data = payload if isinstance(payload, (bytes, type(None))) else json.dumps(payload).encode()
    try:
        with urlopen(Request(BASES[kind] + path, data=data, headers=headers), timeout=timeout) as response:
            return response.read(), response.headers.get("Content-Type", "application/octet-stream")
    except HTTPError as exc:
        raise UpstreamError(exc.code, exc.read()[:4000], exc.headers.get("Content-Type", "application/json")) from exc


_models = {kind: {"at": 0.0, "ids": None} for kind in BASES}
_models_lock = threading.Lock()


def model_ids(kind="LLM"):
    """The frontend's model ids, cached briefly: the console polls health every few seconds."""
    with _models_lock:
        cache = _models[kind]
        if cache["ids"] is None or time.monotonic() - cache["at"] > 5:
            try:
                data, _ = upstream("/v1/models", timeout=5, kind=kind)
                cache["ids"] = {m.get("id") for m in json.loads(data).get("data", []) if isinstance(m, dict)}
            except Exception:
                cache["ids"] = set()
            cache["at"] = time.monotonic()
        return cache["ids"]


# ---- Audio ----

def wav_header(pcm_len, rate, channels=1, bits=16):
    block = channels * bits // 8
    return (b"RIFF" + struct.pack("<I", 36 + pcm_len) + b"WAVE" + b"fmt " + struct.pack("<IHHIIHH", 16, 1, channels, rate, rate * block, block, bits)
            + b"data" + struct.pack("<I", pcm_len))


def wav_to_pcm(data):
    """PCM16 mono at ASR_RATE from a PCM16 or float32 WAV, or None when the WAV is another encoding."""
    fmt, samples, pos = None, None, 12
    while pos + 8 <= len(data):
        cid, size = data[pos:pos + 4], struct.unpack("<I", data[pos + 4:pos + 8])[0]
        body = data[pos + 8:pos + 8 + size]
        if cid == b"fmt ":
            tag, channels, rate, _, _, bits = struct.unpack("<HHIIHH", body[:16])
            if tag == 0xFFFE and len(body) >= 26:  # WAVE_FORMAT_EXTENSIBLE: the subformat's first two bytes are the tag
                tag = struct.unpack("<H", body[24:26])[0]
            fmt = (tag, channels, rate, bits)
        elif cid == b"data":
            samples = body
            break
        pos += 8 + size + (size & 1)
    if not fmt or samples is None or fmt[1] < 1:
        return None
    tag, channels, rate, bits = fmt
    if tag == 1 and bits == 16:
        values = array.array("h")
        values.frombytes(samples[:len(samples) // 2 * 2])
        scale = 1
    elif tag == 3 and bits == 32:
        values = array.array("f")
        values.frombytes(samples[:len(samples) // 4 * 4])
        scale = 32767
    else:
        return None
    if sys.byteorder != "little":
        values.byteswap()
    mono = [sum(values[i:i + channels]) / channels * scale for i in range(0, len(values) - channels + 1, channels)] \
        if channels > 1 or scale != 1 else values
    return resample(mono, rate)


def resample(values, rate):
    if rate != ASR_RATE and len(values) > 1:
        step, count = rate / ASR_RATE, int(len(values) * ASR_RATE / rate)
        out = []
        for i in range(count):
            p = i * step
            j = int(p)
            f = p - j
            nxt = values[j + 1] if j + 1 < len(values) else values[j]
            out.append(values[j] * (1 - f) + nxt * f)
        values = out
    pcm = array.array("h", (max(-32768, min(32767, int(round(v)))) for v in values))
    if sys.byteorder != "little":
        pcm.byteswap()
    return pcm.tobytes()


def to_asr_pcm(data):
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        pcm = wav_to_pcm(data)
        if pcm is not None:
            return pcm
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise ValueError("this audio container needs ffmpeg on the bridge host (brew install ffmpeg); WAV works without it")
    done = subprocess.run([ffmpeg, "-nostdin", "-loglevel", "error", "-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", str(ASR_RATE), "pipe:1"],
                          input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
    if done.returncode != 0:
        raise ValueError("ffmpeg could not decode the audio")
    return done.stdout


# ---- Realtime transcription over a minimal WebSocket client ----
# The router answers 400 to a handshake that offers Sec-WebSocket-Extensions (permessage-deflate), which common
# clients send by default; this client offers none.

class WebSocket:
    def __init__(self, url, timeout=30):
        u = urlsplit(url)
        secure = u.scheme in ("wss", "https")
        sock = socket.create_connection((u.hostname, u.port or (443 if secure else 80)), timeout=timeout)
        if secure:
            sock = ssl.create_default_context().wrap_socket(sock, server_hostname=u.hostname)
        self.sock, self.buffer = sock, b""
        key = base64.b64encode(os.urandom(16)).decode()
        lines = [f"GET {u.path or '/'}{'?' + u.query if u.query else ''} HTTP/1.1", f"Host: {u.netloc}", "Connection: Upgrade",
                 "Upgrade: websocket", "Sec-WebSocket-Version: 13", f"Sec-WebSocket-Key: {key}"]
        if API_KEY:
            lines.append("Authorization: Bearer " + API_KEY)
        sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())
        while b"\r\n\r\n" not in self.buffer:
            chunk = sock.recv(4096)
            if not chunk:
                raise ConnectionError("websocket handshake: connection closed")
            self.buffer += chunk
        head, self.buffer = self.buffer.split(b"\r\n\r\n", 1)
        status, *header_lines = head.decode("latin-1").split("\r\n")
        headers = {k.strip().lower(): v.strip() for k, _, v in (line.partition(":") for line in header_lines)}
        if " 101 " not in status + " ":
            raise ConnectionError("websocket handshake: " + status)
        accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        if headers.get("sec-websocket-accept") != accept:
            raise ConnectionError("websocket handshake: bad Sec-WebSocket-Accept")

    def _send(self, opcode, payload):
        mask, n = os.urandom(4), len(payload)
        head = bytes([0x80 | opcode]) + (bytes([0x80 | n]) if n < 126 else
                                         bytes([0x80 | 126]) + struct.pack(">H", n) if n < 65536 else bytes([0x80 | 127]) + struct.pack(">Q", n))
        masked = bytes(b ^ mask[i & 3] for i, b in enumerate(payload))
        self.sock.sendall(head + mask + masked)

    def send_json(self, obj):
        self._send(0x1, json.dumps(obj).encode())

    def _read(self, n):
        while len(self.buffer) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("websocket closed by the router")
            self.buffer += chunk
        data, self.buffer = self.buffer[:n], self.buffer[n:]
        return data

    def recv_json(self):
        fragments = []
        while True:
            b0, b1 = self._read(2)
            n = b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            mask = self._read(4) if b1 & 0x80 else None
            payload = self._read(n)
            if mask:
                payload = bytes(b ^ mask[i & 3] for i, b in enumerate(payload))
            opcode = b0 & 0x0F
            if opcode == 0x8:
                raise ConnectionError("websocket closed by the router: " + payload[2:].decode("utf-8", "replace"))
            if opcode == 0x9:
                self._send(0xA, payload)
                continue
            if opcode == 0xA:
                continue
            fragments.append(payload)
            if b0 & 0x80:
                return json.loads(b"".join(fragments))

    def close(self):
        try:
            self._send(0x8, struct.pack(">H", 1000))
        except OSError:
            pass
        self.sock.close()


def realtime_url():
    origin = urlsplit(BASES["ASR"])
    scheme = "wss" if origin.scheme == "https" else "ws"
    return f"{scheme}://{origin.netloc}{origin.path}/v1/realtime?model={ASR_MODEL}"  # the frontend routes on ?model=


def wait_for(ws, *types):
    while True:
        event = ws.recv_json()
        if event.get("type") == "error":
            raise RuntimeError("ASR: " + str((event.get("error") or {}).get("message", "error")))
        if event.get("type") in types:
            return event


def clean_transcript(text):
    """Streaming output as the console shows it: one space between words, none before punctuation."""
    text = re.sub(r"\s+", " ", text or "").strip()
    text = re.sub(r"\s+([,.;:!?…])", r"\1", text)
    return re.sub(r"([,;:!?])(?=[^\s\d.,;:!?…])", r"\1 ", text)


def transcribe(pcm):
    # Silence around the utterance: the recogniser's first and last words (and their liaisons) are decided with context,
    # instead of being cut by the start of the stream or the commit.
    pcm = b"\0\0" * (ASR_RATE * ASR_PAD_MS[0] // 1000) + pcm + b"\0\0" * (ASR_RATE * ASR_PAD_MS[1] // 1000)
    ws = WebSocket(realtime_url())
    try:
        wait_for(ws, "session.created")
        transcription = {"model": ASR_MODEL}
        if ASR_LANGUAGE:
            transcription["language"] = ASR_LANGUAGE
        ws.send_json({"type": "session.update", "session": {"type": "transcription", "audio": {"input": {
            "format": {"type": "audio/pcm", "rate": ASR_RATE}, "transcription": transcription, "turn_detection": None}}}})
        wait_for(ws, "session.updated")
        texts, turn = [], ASR_RATE * 2 * MAX_TURN_S
        for start in range(0, max(len(pcm), 1), turn):
            piece = pcm[start:start + turn]
            for i in range(0, len(piece), APPEND_BYTES):
                ws.send_json({"type": "input_audio_buffer.append", "audio": base64.b64encode(piece[i:i + APPEND_BYTES]).decode()})
            ws.send_json({"type": "input_audio_buffer.commit"})
            texts.append(wait_for(ws, "conversation.item.input_audio_transcription.completed").get("transcript") or "")
        return clean_transcript(" ".join(t.strip() for t in texts if t.strip()))
    finally:
        ws.close()


# ---- French text normalisation for the speech model ----
# Magpie reads what it is given; numerals, ordinals, abbreviations and typographic characters are where a voice
# stumbles or mis-links words. Numbers up to 9999 become words, longer digit runs are read digit by digit.

UNITS = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize",
         "dix-sept", "dix-huit", "dix-neuf"]
TENS = {20: "vingt", 30: "trente", 40: "quarante", 50: "cinquante", 60: "soixante"}
ABBREVIATIONS = {"M.": "Monsieur", "Mme": "Madame", "Mlle": "Mademoiselle", "Dr": "Docteur", "Pr": "Professeur", "n°": "numéro", "N°": "numéro",
                 "bd": "boulevard", "Bd": "boulevard", "av.": "avenue", "Av.": "avenue", "St": "Saint", "Ste": "Sainte", "km": "kilomètres", "min": "minutes",
                 "etc.": "et cætera", "SAMU": "SAMU", "RDC": "rez-de-chaussée", "rdc": "rez-de-chaussée"}
TYPOGRAPHY = {"\u2019": "'", "\u2018": "'", "\u201c": '"', "\u201d": '"', "\u2011": "-", "\u2013": "-", "\u2014": "-", "\u2026": "...", "\u00ab": "", "\u00bb": "",
              "\u00b7": ", ", "\u202f": " ", "\u00a0": " ", "*": "", "[": "", "]": "", "_": " "}


def number_words(n):
    """A French cardinal (0..9999) in words."""
    if n < 20:
        return UNITS[n]
    if n < 100:
        tens, unit = divmod(n, 10)
        if tens == 7 or tens == 9:  # soixante-dix, quatre-vingt-dix count on from 60 and 80
            tens, unit = tens - 1, unit + 10
        base = "quatre-vingt" if tens == 8 else TENS[tens * 10]
        if unit == 0:
            return "quatre-vingts" if tens == 8 else base
        if unit == 1 and tens not in (8,):
            return base + " et un"
        if unit == 11 and tens == 6:
            return "soixante et onze"
        return base + "-" + UNITS[unit]
    if n < 1000:
        hundreds, rest = divmod(n, 100)
        head = "cent" if hundreds == 1 else UNITS[hundreds] + " cent"
        if rest == 0:
            return head + ("s" if hundreds > 1 else "")
        return head + " " + number_words(rest)
    thousands, rest = divmod(n, 1000)
    head = "mille" if thousands == 1 else number_words(thousands) + " mille"
    return head if rest == 0 else head + " " + number_words(rest)


def ordinal_words(n, feminine=False):
    if n == 1:
        return "première" if feminine else "premier"
    base = number_words(n)
    if base.endswith("e"):
        base = base[:-1]
    elif base.endswith("cinq"):
        base += "u"
    elif base.endswith("neuf"):
        base = base[:-1] + "v"
    elif base.endswith("s") and n % 100 in (0, 80):
        base = base[:-1]
    return base + "ième"


SPEECH_CHARS_PER_SECOND = 16  # French read aloud: a line shorter than 65 % of this estimate was cut short


def too_short(pcm, text):
    """A rendering that stopped early: less than 65 % of the expected duration for a line of at least 40 characters."""
    return len(text) >= 40 and len(pcm) / (TTS_RATE * 2) < 0.65 * len(text) / SPEECH_CHARS_PER_SECOND


def normalize_fr(text):
    """Text as a French voice should read it: plain characters, numbers in words, abbreviations expanded, final punctuation."""
    for char, plain in TYPOGRAPHY.items():
        text = text.replace(char, plain)
    text = re.sub(r"(\d+)\s*h\s*(\d{2})\b", lambda m: f"{number_words(int(m.group(1)))} heures {number_words(int(m.group(2)))}", text)
    text = re.sub(r"(\d+)\s*h\b", lambda m: f"{number_words(int(m.group(1)))} heures", text)
    text = re.sub(r"(\d+)\s*%", lambda m: f"{number_words(int(m.group(1)))} pour cent", text)
    text = re.sub(r"\b(\d{1,4})\s*(er|re|ère|e|ème|eme)\b", lambda m: ordinal_words(int(m.group(1)), m.group(2) in ("re", "ère")), text)
    text = re.sub(r"\d+", lambda m: number_words(int(m.group(0))) if len(m.group(0)) <= 4 and not m.group(0).startswith("0")
                  else " ".join(number_words(int(d)) for d in m.group(0)), text)
    def expand(word):
        for core in (word, word.rstrip(",;:!?()."), word.strip(",;:!?().")):  # « M. » keeps its dot, « min... » loses the dots
            if core in ABBREVIATIONS:
                return word.replace(core, ABBREVIATIONS[core], 1)
        return word
    text = " ".join(expand(w) for w in text.split(" "))
    text = re.sub(r"\s+", " ", text).strip()
    if text and text[-1] not in ".!?":
        text += "."
    return text


# ---- HTTP ----

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # never log transcripts or audio

    def reply(self, status, body, content_type="application/json"):
        if isinstance(body, dict):
            body = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 < length <= MAX_BODY:
            raise ValueError("invalid request size")
        return self.rfile.read(length)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/v1/health/ready":
            ready = not LLM_MODEL or LLM_MODEL in model_ids()
            self.reply(200 if ready and model_ids() else 503, {"ready": bool(ready and model_ids()), "model": LLM_MODEL})
        elif path == "/v1/models":  # also the tee proxy's health probe
            self.proxy_get("/v1/models")
        elif path == "/tts/v1/models":
            self.proxy_get("/v1/models", kind="TTS")
        elif path == "/tts/v1/audio/voices":
            self.reply(200, {"voices": TTS_VOICES, "language": LANGUAGES})
        elif path in ("/stt", "/stt/"):
            self.reply(200, {"loaded": [ASR_MODEL] if ASR_MODEL in model_ids("ASR") else [], "language": ASR_LANGUAGE or None})
        elif path == "/healthz":
            self.reply(200, {"ok": True})
        else:
            self.reply(404, {"error": "not found"})

    def proxy_get(self, path, kind="LLM"):
        try:
            data, ctype = upstream(path, timeout=10, kind=kind)
            self.reply(200, data, ctype)
        except UpstreamError as exc:
            self.reply(exc.status, exc.body, exc.content_type)
        except Exception as exc:
            self.reply(502, {"error": type(exc).__name__})

    def do_POST(self):
        path = urlsplit(self.path).path
        try:
            if path == "/v1/chat/completions":
                data, ctype = upstream("/v1/chat/completions", self.body())
                self.reply(200, data, ctype)
            elif path == "/tts/v1/audio/speech":
                self.speech(json.loads(self.body()))
            elif path == "/stt/transcribe":
                self.reply(200, {"text": transcribe(to_asr_pcm(self.body())), "model": ASR_MODEL, "language": ASR_LANGUAGE or None})
            else:
                self.reply(404, {"error": "not found"})
        except UpstreamError as exc:
            self.reply(exc.status, exc.body, exc.content_type)
        except ValueError as exc:
            self.reply(400, {"error": str(exc)[:300]})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:
            self.reply(502, {"error": f"{type(exc).__name__}: {str(exc)[:300]}"})

    def speech(self, payload):
        if not isinstance(payload, dict) or not isinstance(payload.get("input"), str):
            raise ValueError("input text required")
        # The frontend's TTS takes pcm only, at speed 1.0, with a Magpie voice and a locale; the text is normalised first.
        request = {"input": normalize_fr(payload["input"]) if TTS_NORMALIZE else payload["input"], "model": payload.get("model"),
                   "voice": TTS_VOICES.get(payload.get("voice"), payload.get("voice")),
                   "language": LANGUAGES.get(payload.get("language"), payload.get("language"))}
        body = {k: v for k, v in request.items() if v}
        pcm, _ = upstream("/v1/audio/speech", body, kind="TTS")
        if too_short(pcm, request["input"]):
            # Magpie occasionally stops early on a long line (a few percent of the emotional variants' renderings): one more
            # try, and the longer rendering is kept.
            again, _ = upstream("/v1/audio/speech", body, kind="TTS")
            pcm = max(pcm, again, key=len)
        self.reply(200, wav_header(len(pcm), TTS_RATE) + pcm, "audio/wav")


def main():
    if not all(BASES.values()):
        sys.exit("GCORE_BASE_URL (or GCORE_LLM_BASE_URL, GCORE_ASR_BASE_URL and GCORE_TTS_BASE_URL) is required")
    bind, port = os.environ.get("GCORE_BRIDGE_BIND", "127.0.0.1"), int(os.environ.get("GCORE_BRIDGE_PORT", "8101"))
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    socketserver.ThreadingTCPServer.daemon_threads = True
    with socketserver.ThreadingTCPServer((bind, port), Handler) as server:
        targets = BASE if len(set(BASES.values())) == 1 else ", ".join(f"{k} {v}" for k, v in BASES.items())
        print(f"Gcore bridge on {bind}:{port} -> {targets} (ASR {ASR_MODEL}, {ASR_LANGUAGE or 'frontend default'}; "
              f"ffmpeg {'found' if shutil.which('ffmpeg') else 'missing: WAV only'})", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
