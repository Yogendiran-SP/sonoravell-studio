"""Verify the localhost service, codecs and plug-in inventory without audio hardware."""
from array import array
from http.server import ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import json
import math
import struct
import sys
import unittest
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from launch import AppHandler
from local_media import codecs, scan_plugins, transcode
from native_host import midi_messages, read_wav, write_wav


def fixture():
    memory = BytesIO()
    tone = array("h", (int(6000 * math.sin(i * (2 * math.pi * 440 / 48000)))
                       for i in range(48000)))
    if sys.byteorder == "big":
        tone.byteswap()
    with wave.open(memory, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(48000)
        output.writeframes(tone.tobytes())
    return memory.getvalue()


class LocalChecks(unittest.TestCase):
    def test_plugin_scan(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            plugin = root / "Fixture.vst3" / "Contents" / "Resources"
            plugin.mkdir(parents=True)
            (plugin / "moduleinfo.json").write_text(json.dumps({
                "Name": "Fixture Compressor", "Factory Info": {"Vendor": "Fixture Audio"}
            }), encoding="utf-8")
            (root / "MIDI Translator.clap").touch()
            (root / "Other.txt").touch()
            result = scan_plugins([root])
            self.assertEqual([row["kind"] for row in result], ["VST3", "CLAP"])
            self.assertEqual(result[0]["name"], "Fixture Compressor")
            self.assertEqual(result[0]["vendor"], "Fixture Audio")

    def test_codecs(self):
        _, formats = codecs()
        if not formats:
            self.skipTest("FFmpeg is unavailable")
        starts = {"wav": b"RIFF", "aiff": b"FORM", "caf": b"caff", "flac": b"fLaC",
                  "ogg": b"OggS", "opus": b"OggS"}
        for name in formats:
            with self.subTest(codec=name):
                output, mimetype = transcode(fixture(), {
                    "format": name, "rate": "48000", "bits": "24", "bitrate": "192",
                    "title": "Fixture", "artist": "Test", "dither": "1",
                    "loudness": "1", "lufs": "-14", "ceiling": "-1"
                })
                self.assertGreater(len(output), 2000)
                self.assertTrue(mimetype.startswith("audio/"))
                if name in starts:
                    self.assertTrue(output.startswith(starts[name]))
                elif name in {"m4a", "alac"}:
                    self.assertEqual(output[4:8], b"ftyp")
                elif name == "mp3":
                    self.assertTrue(output.startswith(b"ID3"))

    def test_native_worker_payload(self):
        try:
            import numpy as np
        except ImportError:
            self.skipTest("NumPy is unavailable")
        with TemporaryDirectory() as folder:
            src = Path(folder) / "float.wav"
            wave = np.sin(np.arange(200, dtype=np.float32) * .1)[None, :]
            write_wav(src, wave, 48000)
            data, rate = read_wav(src)
            self.assertEqual(rate, 48000)
            np.testing.assert_equal(data, wave)
        events = midi_messages([[60, 100, 0, .5], [60, 101, .5, 1]], 2)
        self.assertEqual(events[1][0][0], 0x80)
        self.assertEqual(events[2][0][0], 0x90)
        with self.assertRaises(ValueError):
            midi_messages([[60, 100, .5, .4]], 2)
        controls = [[0, 0xB0, 64, 127], [.5, 0xE0, 0, 80], [.75, 0xB0, 64, 0]]
        events = midi_messages([[60, 100, 0, .5]], 2, controls)
        self.assertEqual([event[0][0] for event in events], [0xB0, 0x90, 0x80, 0xE0, 0xB0])
        with self.assertRaises(ValueError):
            midi_messages([], 2, [[0, 0xF0, 0, 0]])

    def test_server(self):
        with ThreadingHTTPServer(("127.0.0.1", 0), AppHandler) as server:
            worker = Thread(target=server.serve_forever, daemon=True)
            worker.start()
            host = f"http://127.0.0.1:{server.server_port}"
            try:
                with urlopen(host, timeout=3) as reply:
                    self.assertIn(b"<title>Sonoravell Studio</title>", reply.read())
                with self.assertRaises(HTTPError) as rejected:
                    urlopen(host + "/api/plugins", timeout=3)
                self.assertEqual(rejected.exception.code, 403)
                with self.assertRaises(HTTPError) as rejected:
                    urlopen(Request(host + "/api/capabilities", headers={
                        "X-Soundweave": "1", "Origin": "https://example.org"}), timeout=3)
                self.assertEqual(rejected.exception.code, 403)
                with urlopen(Request(host + "/api/capabilities", headers={"X-Soundweave": "1"}), timeout=3) as reply:
                    self.assertEqual(json.load(reply)["formats"], codecs()[1])
                if "wav" in codecs()[1]:
                    request = Request(host + "/api/encode?format=wav&bits=16&rate=44100",
                                      data=fixture(), headers={
                                          "X-Soundweave": "1", "Content-Type": "audio/wav"
                                      })
                    with urlopen(request, timeout=8) as reply:
                        data = reply.read()
                        self.assertEqual(data[:4], b"RIFF")
                        self.assertEqual(struct.unpack_from("<I", data, 24)[0], 44100)
            finally:
                server.shutdown()


if __name__ == "__main__":
    unittest.main(verbosity=2)
