"""The Dynamo bridge (backend/gcore_bridge.py): audio conversion, the speech request mapping, per-model origins."""
import base64
import json
import os
import struct
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
os.environ.setdefault("GCORE_LLM_BASE_URL", "http://llm.invalid:8000")
os.environ.setdefault("GCORE_ASR_BASE_URL", "http://asr.invalid:8000")
os.environ.setdefault("GCORE_TTS_BASE_URL", "http://tts.invalid:8000")
import gcore_bridge as bridge  # noqa: E402


class AudioTests(unittest.TestCase):
    def test_wav_roundtrip_and_resampling(self):
        pcm = struct.pack("<" + "h" * 480, *([1000] * 480))  # 10 ms at 48 kHz
        wav = bridge.wav_header(len(pcm), 48000) + pcm
        out = bridge.wav_to_pcm(wav)
        self.assertEqual(len(out), 240 * 2, "48 kHz becomes 24 kHz PCM16")
        self.assertEqual(struct.unpack("<h", out[:2])[0], 1000)
        self.assertEqual(bridge.wav_to_pcm(bridge.wav_header(0, 24000, bits=8)), None, "unsupported encodings are refused, not guessed")
        header = bridge.wav_header(4, 24000)
        self.assertEqual((header[:4], header[8:12], struct.unpack("<I", header[24:28])[0]), (b"RIFF", b"WAVE", 24000))

    def test_non_wav_audio_needs_ffmpeg(self):
        with patch.object(bridge.shutil, "which", return_value=None):
            with self.assertRaises(ValueError):
                bridge.to_asr_pcm(b"\x1aE\xdf\xa3webm")


class MappingTests(unittest.TestCase):
    def test_speech_request_maps_presets_locale_and_origin(self):
        calls = []
        def fake_upstream(path, payload=None, timeout=120, kind="LLM"):
            calls.append((path, payload, kind))
            return b"\0\0" * 240, "application/octet-stream"
        handler = bridge.Handler.__new__(bridge.Handler)
        sent = {}
        handler.reply = lambda status, body, content_type="application/json": sent.update(status=status, body=body, content_type=content_type)
        with patch.object(bridge, "upstream", fake_upstream):
            handler.speech({"input": "Bonjour.", "model": "nvidia/magpie-tts-multilingual", "voice": "fr_female", "language": "fr", "speed": 1.1, "response_format": "wav"})
        path, payload, kind = calls[0]
        self.assertEqual((path, kind), ("/v1/audio/speech", "TTS"))
        self.assertEqual(payload, {"input": "Bonjour.", "model": "nvidia/magpie-tts-multilingual", "voice": "Magpie-Multilingual.FR-FR.Louise", "language": "fr-FR"},
                         "preset -> Magpie voice, bare code -> locale, no speed or response_format")
        self.assertEqual((sent["status"], sent["content_type"]), (200, "audio/wav")); self.assertTrue(sent["body"].startswith(b"RIFF"))

    def test_a_rendering_cut_short_is_tried_once_more(self):
        text = "Allô ? Oui, bonjour, euh, il faut venir vite. Ma mère est tombée dans la salle de bain et ne peut pas se relever."
        short, full = b"\0\0" * int(2.6 * bridge.TTS_RATE), b"\0\0" * int(7.4 * bridge.TTS_RATE)
        self.assertTrue(bridge.too_short(short, text)); self.assertFalse(bridge.too_short(full, text))
        self.assertFalse(bridge.too_short(b"\0\0" * int(0.4 * bridge.TTS_RATE), "Allô ?"), "short lines vary too much to judge")
        calls = []

        def fake_upstream(path, payload=None, timeout=120, kind="LLM"):
            calls.append((path, payload["voice"])); return (short if len(calls) == 1 else full), "audio/pcm"
        with patch.object(bridge, "upstream", fake_upstream):
            handler = bridge.Handler.__new__(bridge.Handler); out = {}
            handler.reply = lambda status, body, ctype="application/json": out.update(status=status, body=body, ctype=ctype)
            handler.speech({"input": text, "voice": "fr_female_fearful", "language": "fr"})
        self.assertEqual([c[0] for c in calls], ["/v1/audio/speech", "/v1/audio/speech"]); self.assertEqual(calls[0][1], "Magpie-Multilingual.EN-US.Aria.Fearful")
        self.assertEqual((out["status"], out["ctype"], len(out["body"]) - 44), (200, "audio/wav", len(full)), "the longer rendering is kept")

    def test_each_model_has_its_own_origin(self):
        self.assertEqual(bridge.BASES, {"LLM": "http://llm.invalid:8000", "ASR": "http://asr.invalid:8000", "TTS": "http://tts.invalid:8000"})
        self.assertEqual(bridge.realtime_url(), "ws://asr.invalid:8000/v1/realtime?model=nemotron-asr-streaming")
        seen = []
        def fake_urlopen(req, timeout=0):
            seen.append(req.full_url)
            class R:
                headers = {"Content-Type": "application/json"}
                def __enter__(self): return self
                def __exit__(self, *a): return False
                def read(self): return json.dumps({"data": [{"id": "nemotron-asr-streaming"}]}).encode()
            return R()
        with patch.object(bridge, "urlopen", fake_urlopen), patch.dict(bridge._models["ASR"], {"ids": None, "at": 0.0}):
            self.assertIn("nemotron-asr-streaming", bridge.model_ids("ASR"))
        self.assertEqual(seen, ["http://asr.invalid:8000/v1/models"])


class SpeechQualityTests(unittest.TestCase):
    """What the bridge does for intelligibility: text the voice can read, audio the recogniser can settle."""

    def test_french_normalisation_for_the_voice(self):
        cases = {
            "Nous sommes au 12 rue des Lilas, au 3e étage, porte gauche.": "Nous sommes au douze rue des Lilas, au troisième étage, porte gauche.",
            "Il est 14h30, Mme Durand et M. Martin attendent au n° 7, bd Saint-Michel": "Il est quatorze heures trente, Madame Durand et Monsieur Martin attendent au numéro sept, boulevard Saint-Michel.",
            "Ça fait 10 min… elle a 80 ans ! Appelez le 06 39 98 12 42": "Ça fait dix minutes... elle a quatre-vingts ans ! Appelez le zéro six trente-neuf quatre-vingt-dix-huit douze quarante-deux.",
            "dites‑moi « où exactement »": "dites-moi où exactement.",
            "1er étage, 2e porte, 21e siècle, 100 % sûr": "premier étage, deuxième porte, vingt et unième siècle, cent pour cent sûr.",
            "Restez en ligne.": "Restez en ligne.",
        }
        for text, expected in cases.items():
            self.assertEqual(bridge.normalize_fr(text), expected)
        for n, words in ((71, "soixante et onze"), (80, "quatre-vingts"), (81, "quatre-vingt-un"), (91, "quatre-vingt-onze"), (200, "deux cents"), (231, "deux cent trente et un"), (1001, "mille un")):
            self.assertEqual(bridge.number_words(n), words)
        self.assertEqual((bridge.ordinal_words(1, True), bridge.ordinal_words(5), bridge.ordinal_words(9), bridge.ordinal_words(80)), ("première", "cinquième", "neuvième", "quatre-vingtième"))

    def test_transcript_spacing_and_utterance_padding(self):
        self.assertEqual(bridge.clean_transcript("Bonjour, ici, la plateforme  Pouvez vous me dire ,où vous êtes ?  "), "Bonjour, ici, la plateforme Pouvez vous me dire, où vous êtes?")
        self.assertEqual(bridge.clean_transcript("Ça fait 10 min... oui"), "Ça fait 10 min... oui")
        sent = []
        class FakeWS:
            def __init__(self, url): sent.append(("open", url))
            def send_json(self, obj): sent.append(obj)
            def recv_json(self):
                last = sent[-1]
                if last[0] == "open" if isinstance(last, tuple) else False: return {"type": "session.created"}
                if isinstance(last, dict) and last.get("type") == "session.update": return {"type": "session.updated"}
                return {"type": "conversation.item.input_audio_transcription.completed", "transcript": " deux  mots ,ici "}
            def close(self): pass
        with patch.object(bridge, "WebSocket", FakeWS):
            text = bridge.transcribe(b"\x01\x00" * 2400)  # 100 ms of audio
        appended = sum(len(base64.b64decode(e["audio"])) for e in sent if isinstance(e, dict) and e.get("type") == "input_audio_buffer.append")
        self.assertEqual(appended, 2 * 24000 * (bridge.ASR_PAD_MS[0] + 100 + bridge.ASR_PAD_MS[1]) // 1000, "silence before and after the utterance")
        self.assertEqual(text, "deux mots, ici")


if __name__ == "__main__":
    unittest.main()
