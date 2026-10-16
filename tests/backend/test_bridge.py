"""The Dynamo bridge (backend/gcore_bridge.py): audio conversion, the speech request mapping, per-model origins."""
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


if __name__ == "__main__":
    unittest.main()
