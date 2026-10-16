"""The standalone caller service (caller/service.py): one turn = validation, a line from the LLM, its voice from the
speech model, timings; HTTP routes with bearer-token auth; the fake mode used by the preview and the e2e harness."""
import base64
import json
import sys
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "backend"))
from caller import service, simulation  # noqa: E402
import server  # noqa: E402

PAYLOAD = {"facts": {"incident": "Fumée dans l'escalier", "address": "huit cours Gambetta à Lyon", "name": "Karim"}, "style": "rushed", "voice": "fr_male",
           "messages": [{"role": "caller", "text": "Il y a de la fumée !"}, {"role": "assistant", "text": "Je vous écoute. Où êtes-vous exactement, l'adresse et la ville ?"}]}


def completion(content):
    return json.dumps({"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(content, ensure_ascii=False)}}]}).encode(), {}


class TurnTests(unittest.TestCase):
    cfg = service.settings({"CALLER_LOCATION": "lyon", "CALLER_TOKEN": "", "CALLER_LLM_URL": "http://llm.invalid/v1/chat/completions",
                            "CALLER_TTS_URL": "http://tts.invalid/", "CALLER_LLM_MODEL": "org/site-llm", "CALLER_TTS_MODEL": "org/site-tts"})

    def test_a_turn_generates_speaks_and_times_each_step(self):
        calls = []
        def fake(url, payload=None, headers=None, timeout=60):
            calls.append((url, payload))
            if url.endswith("/v1/chat/completions"):
                return completion({"utterance": "Oui, c'est au huit cours Gambetta, à Lyon. Vite, s'il vous plaît !"})
            return b"RIFF" + b"\0" * 100, {}
        with patch.object(service, "request", side_effect=fake):
            result = service.turn(PAYLOAD, self.cfg)
        self.assertEqual(result["text"], "Oui, c'est au huit cours Gambetta, à Lyon. Vite, s'il vous plaît !")
        self.assertTrue(base64.b64decode(result["audio"]).startswith(b"RIFF"))
        self.assertEqual((result["location"], result["model"], result["tts_model"], result["voice"], result["delivery"], result["retries"]), ("lyon", "org/site-llm", "org/site-tts", "fr_male", "rushed", 0))
        for key in ("llm_ms", "tts_ms", "total_ms"):
            self.assertIsInstance(result["timings"][key], int); self.assertGreaterEqual(result["timings"][key], 0)
        llm, tts = calls
        self.assertEqual(llm[0], "http://llm.invalid/v1/chat/completions")
        self.assertEqual((llm[1]["model"], llm[1]["messages"][0]["content"], llm[1]["response_format"]), ("org/site-llm", simulation.CALLER_SYSTEM, {"type": "json_object"}))
        self.assertIn(simulation.STYLE_NOTES["rushed"], llm[1]["messages"][1]["content"])
        self.assertEqual(tts[0], "http://tts.invalid/v1/audio/speech")
        self.assertEqual(tts[1], {"input": result["text"], "model": "org/site-tts", "response_format": "wav", "language": "fr", "voice": "fr_male", "speed": 1.16})

    def test_unusable_lines_are_resampled_once_then_refused(self):
        answers = [completion({"utterance": "(tousse) Il y a de la fumée !"}), completion({"utterance": "Il y a de la fumée partout, vite !"}), (b"RIFF....", {})]
        with patch.object(service, "request", side_effect=answers):
            result = service.turn(PAYLOAD, self.cfg)
        self.assertEqual((result["text"], result["retries"]), ("Il y a de la fumée partout, vite !", 1))
        with patch.object(service, "request", side_effect=[completion({"utterance": "[pleure]"})] * 2):
            with self.assertRaises(simulation.SimulationError):
                service.turn(PAYLOAD, self.cfg)
        with patch.object(service, "request", return_value=(b'{"choices":[{"finish_reason":"length","message":{"content":"{"}}]}', {})):
            with self.assertRaises(simulation.SimulationError):
                service.turn(PAYLOAD, self.cfg)
        for bad in ({**PAYLOAD, "voice": "en_male"}, {**PAYLOAD, "style": "shouting"}, {**PAYLOAD, "facts": {}}, {**PAYLOAD, "messages": []}, "nope"):
            with self.assertRaises(ValueError):
                service.turn(bad, self.cfg)

    def test_fake_mode_needs_no_model_and_carries_its_text_in_the_audio(self):
        cfg = service.settings({"CALLER_LOCATION": "montreal", "CALLER_FAKE": "1", "CALLER_FAKE_LLM_MS": "1", "CALLER_FAKE_TTS_MS": "1", "CALLER_FAKE_DELAY_MS": "0"})
        with patch.object(service, "request", side_effect=AssertionError("no model must be called")):
            result = service.turn(PAYLOAD, cfg)
        self.assertIn("huit cours Gambetta", result["text"], "the fake caller answers the question the operator just asked, from the facts")
        wav = base64.b64decode(result["audio"])
        self.assertTrue(wav.startswith(b"RIFF")); self.assertEqual(simulation.text_in_wav(wav), result["text"])
        self.assertEqual((result["model"], result["location"]), ("fake", "montreal"))
        self.assertEqual(service.health(cfg)["ready"], True); self.assertTrue(service.health(cfg)["fake"])
        self.assertIsNone(simulation.text_in_wav(b"RIFF" + b"\0" * 40)); self.assertIsNone(simulation.text_in_wav(b"\x1aE\xdf\xa3webm"))

    def test_repeated_lines_are_resampled_and_politeness_tics_trimmed(self):
        messages = [{"role": "caller", "text": "Je suis au 12 rue des Lilas, près du portail gris, devant l'arrêt de bus, s'il vous plaît, dépêchez-vous."},
                    {"role": "assistant", "text": "Il y a un danger autour, du feu, du gaz ?"}]
        lines = iter([{"utterance": "Je suis au 12 rue des Lilas, près du portail gris, devant l'arrêt de bus, je sais pas si elle respire, dépêchez-vous."},
                      {"utterance": "Non, non, rien de ça, s'il vous plaît, dépêchez-vous !"}])
        prompts = []

        def complete(prompt, temperature):
            prompts.append((prompt, temperature))
            return next(lines)
        text, retries = simulation.generate(simulation.build_prompt({"incident": "Ma mère est tombée"}, "urgent", messages), complete, messages=messages)
        self.assertEqual((text, retries), ("Non, non, rien de ça !", 1))
        self.assertTrue(prompts[1][0][-1]["content"].startswith(simulation.REPEAT_NUDGE)); self.assertEqual(prompts[1][1], simulation.TEMPERATURES[1])
        self.assertIn("Il y a un danger autour, du feu, du gaz ?", prompts[1][0][-1]["content"], "the nudge quotes the operator's question")
        # Asked to repeat the address, the caller may say it again; a first « s'il vous plaît » stays.
        again = messages[:1] + [{"role": "assistant", "text": "Vous pouvez me redire l'adresse ?"}]
        text, retries = simulation.generate(simulation.build_prompt({"incident": "Ma mère est tombée"}, "urgent", again),
                                            lambda p, t: {"utterance": "12 rue des Lilas, près du portail gris."}, messages=again)
        self.assertEqual((text, retries), ("12 rue des Lilas, près du portail gris.", 0))
        self.assertEqual(simulation.trim_tics("Oui, s'il vous plaît, venez vite, s'il vous plaît !", []), "Oui, s'il vous plaît, venez vite !")
        self.assertEqual(simulation.trim_tics("S'il vous plaît, dépêchez-vous, elle bouge plus.", ["Venez vite s'il vous plaît"]), "Dépêchez-vous, elle bouge plus.")
        self.assertEqual(simulation.trim_tics("Dépêchez-vous !", ["dépêchez-vous"]), "Dépêchez-vous !", "a line that is only a tic is left alone")
        # When the fresh sample repeats as well, the repeated sentence goes and the rest of the line stays.
        said = [{"role": "caller", "text": "Huit avenue du Parc. La fumée sort de l'appartement du dessus et personne ne répond."}, {"role": "assistant", "text": "C'est bien là ?"}]
        same = {"utterance": "Oui, c'est bien là. La fumée sort de l'appartement du dessus et personne ne répond."}
        text, retries = simulation.generate(simulation.build_prompt({"incident": "Fumée"}, "concerned", said), lambda p, t: same, messages=said)
        self.assertEqual((text, retries), ("Oui, c'est bien là.", 1))

    def test_the_prompt_is_the_gateways(self):
        self.assertIs(server.CALLER_SYSTEM, simulation.CALLER_SYSTEM)
        self.assertIs(server.STYLE_NOTES, simulation.STYLE_NOTES)
        self.assertEqual(server.speech_options({"speaker": "caller", "voice": "fr_male", "style": "rushed"})[0]["speed"], simulation.VOICE_SPEEDS["rushed"])

    def test_settings_validate_the_location_name(self):
        with self.assertRaises(ValueError):
            service.settings({"CALLER_LOCATION": "../etc"})
        cfg = service.settings({"CALLER_LOCATION": "Paris 15e", "CALLER_TTS_VOICES": " fr_female , fr_male ", "CALLER_TTS_URL": "http://tts.invalid/"})
        self.assertEqual((cfg["location"], cfg["voices"], cfg["tts_url"], cfg["bind"], cfg["port"], cfg["fake"]), ("Paris 15e", ("fr_female", "fr_male"), "http://tts.invalid", "0.0.0.0", 8094, False))


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cfg = service.settings({"CALLER_LOCATION": "lyon", "CALLER_TOKEN": "site-token", "CALLER_FAKE": "1", "CALLER_FAKE_LLM_MS": "1", "CALLER_FAKE_TTS_MS": "1"})
        cls.httpd = service.make_server(cls.cfg, bind="127.0.0.1", port=0)
        cls.base = "http://127.0.0.1:%d" % cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown(); cls.httpd.server_close(); cls.thread.join()

    def request(self, path, payload=None, token="site-token", headers=None, raw=None):
        hdr = {"Content-Type": "application/json"}
        if token:
            hdr["Authorization"] = "Bearer " + token
        hdr.update(headers or {})
        req = Request(self.base + path, data=raw if raw is not None else (json.dumps(payload).encode() if payload is not None else None), headers=hdr)
        try:
            with urlopen(req, timeout=5) as resp:
                return resp.status, resp.read(), dict(resp.headers)
        except HTTPError as exc:
            return exc.code, exc.read(), dict(exc.headers)

    def test_health_and_turn_need_the_token(self):
        self.assertEqual(self.request("/health", token=None)[0], 401)
        self.assertEqual(self.request("/health", token="wrong")[0], 401)
        self.assertEqual(self.request("/turn", PAYLOAD, token=None)[0], 401)
        status, body, headers = self.request("/health")
        data = json.loads(body)
        self.assertEqual((status, data["ready"], data["location"], data["service"], headers["X-Caller-Location"]), (200, True, "lyon", "orange-caller", "lyon"))
        self.assertEqual(self.request("/")[0], 200)

    def test_turn_route_answers_text_audio_and_timings(self):
        status, body, _ = self.request("/turn", PAYLOAD)
        self.assertEqual(status, 200, body)
        data = json.loads(body)
        self.assertTrue(data["text"]); self.assertTrue(base64.b64decode(data["audio"]).startswith(b"RIFF"))
        self.assertEqual(sorted(data["timings"]), ["llm_ms", "total_ms", "tts_ms"]); self.assertEqual(data["location"], "lyon")
        # The gateway's remote path accepts exactly this answer.
        site = {"name": "lyon", "url": self.base}
        with patch.dict("os.environ", {"ORANGE_CALLER_TOKEN": "site-token"}):
            result = server.remote_caller_turn(site, {**PAYLOAD, "location": "lyon"})
        self.assertEqual((result["location"], result["text"], result["timings"]["llm_ms"]), ("lyon", data["text"], data["timings"]["llm_ms"]))
        self.assertGreaterEqual(result["timings"]["network_ms"], 0)

    def test_bad_requests_are_explicit(self):
        self.assertEqual(self.request("/turn", {**PAYLOAD, "voice": "en_male"})[0], 400)
        self.assertEqual(self.request("/turn", raw=b"not json")[0], 400)
        self.assertEqual(self.request("/turn", raw=b"{}", headers={"Content-Type": "text/plain"})[0], 400)
        self.assertEqual(self.request("/turn", raw=b"x" * (service.MAX_BODY + 1))[0], 413)
        self.assertEqual(self.request("/other", {})[0], 404)
        self.assertEqual(self.request("/other")[0], 404)
        status, body, _ = self.request("/turn", {**PAYLOAD, "facts": {"incident": "x", "address": "y" * 701}})
        self.assertEqual(status, 400); self.assertIn("fact", json.loads(body)["error"])

    def test_the_gateway_forwards_to_this_service_end_to_end(self):
        """The real HTTP path: gateway caller_route -> this service -> validated answer with audio, no Gemma slot used."""
        with patch.dict("os.environ", {"ORANGE_CALLERS": "lyon=" + self.base, "ORANGE_CALLER_TOKEN": "site-token"}), patch.dict(server.caller_failures, clear=True):
            free = server.GATES["gemma"].free
            result = server.caller_route({**PAYLOAD, "location": "lyon", "call": "TEST-9", "turn": 3})
            self.assertEqual(server.GATES["gemma"].free, free)
            health = server.health()
        self.assertEqual((result["location"], result["source"], result["model"]), ("lyon", "remote_caller", "fake"))
        self.assertEqual(simulation.text_in_wav(base64.b64decode(result["audio"])), result["text"])
        site = next(c for c in health["callers"] if c["name"] == "lyon")
        self.assertTrue(site["ready"]); self.assertIsInstance(site["rtt_ms"], int); self.assertEqual(site["label"], "lyon")

    def test_fake_distance_shows_as_network_time_not_site_time(self):
        far = service.make_server(service.settings({"CALLER_LOCATION": "far", "CALLER_FAKE": "1", "CALLER_FAKE_LLM_MS": "1", "CALLER_FAKE_TTS_MS": "1", "CALLER_FAKE_DELAY_MS": "120"}), bind="127.0.0.1", port=0)
        thread = threading.Thread(target=far.serve_forever, daemon=True); thread.start()
        try:
            site = {"name": "far", "url": "http://127.0.0.1:%d" % far.server_address[1]}
            with patch.dict("os.environ", {"ORANGE_CALLER_TOKEN": ""}):
                result = server.remote_caller_turn(site, {**PAYLOAD, "location": "far"})
            self.assertLess(result["timings"]["service_ms"], 100); self.assertGreaterEqual(result["timings"]["network_ms"], 100)
        finally:
            far.shutdown(); far.server_close(); thread.join()


if __name__ == "__main__":
    unittest.main()
