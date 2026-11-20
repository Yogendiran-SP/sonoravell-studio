"""Run Sonoravell over localhost for browser device permissions."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Timer
from urllib.parse import parse_qs, urlsplit
from subprocess import Popen, TimeoutExpired
from shutil import which
import os
import json
import struct
from native_host import available as native_available, discover as native_discover, perform as native_perform

from local_media import codecs, transcode
import webbrowser

APP = Path(__file__).with_name("Sonoravell.html")


class AppHandler(BaseHTTPRequestHandler):
    def trusted(self, api=False):
        host = f"127.0.0.1:{self.server.server_port}"
        if self.headers.get("Host") != host:
            return False
        if api:
            origin = self.headers.get("Origin")
            if origin and origin != f"http://{host}":
                return False
            return self.headers.get("X-Soundweave") == "1"
        return True

    def send_bytes(self, data, content_type, status=200):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Permissions-Policy", "microphone=(self), midi=(self), speaker-selection=(self)")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, data, status=200):
        self.send_bytes(json.dumps(data).encode("utf-8"), "application/json", status)

    def do_GET(self):
        path = urlsplit(self.path).path
        if not self.trusted(path.startswith("/api/")):
            self.send_error(403)
        elif path in ("/", "/Sonoravell.html", "/Soundweave.html"):
            self.send_bytes(APP.read_bytes(), "text/html; charset=utf-8")
        elif path == "/api/capabilities":
            self.send_json({"formats": codecs()[1], "native": native_available()})
        elif path == "/api/plugins":
            self.send_json({"plugins": native_discover()})
        elif path == "/api/native/inspect":
            key = parse_qs(urlsplit(self.path).query).get("id", [""])[0]
            try:
                self.send_json(native_perform(key, "inspect"))
            except (ValueError, OSError, TimeoutExpired) as error:
                self.send_json({"error": str(error)}, 400)
        else:
            self.send_error(404)

    def do_POST(self):
        url = urlsplit(self.path)
        if not self.trusted(api=True):
            self.send_error(403)
            return
        if url.path == "/api/native/render":
            self.native_render()
            return
        if url.path != "/api/encode":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 44 <= length <= 280_000_000:
                raise ValueError("The encoder requires a WAV file under 280 MB.")
            if self.headers.get_content_type() != "audio/wav":
                raise ValueError("Expected a WAV render.")
            self.connection.settimeout(20)
            data = self.rfile.read(length)
            if len(data) != length or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
                raise ValueError("Invalid WAV render.")
            params = {key: value[0] for key, value in parse_qs(url.query, max_num_fields=24).items()}
            result, mimetype = transcode(data, params)
        except (OSError, KeyError, ValueError, TimeoutExpired) as error:
            self.send_json({"error": str(error)}, 400)
            return
        self.send_bytes(result, mimetype)

    def native_render(self):
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 4 < size <= 128_000_000 or self.headers.get_content_type() != "application/octet-stream":
                raise ValueError("Invalid native render request.")
            self.connection.settimeout(20)
            payload = self.rfile.read(size)
            if len(payload) != size:
                raise ValueError("Incomplete native render request.")
            length = struct.unpack_from("<I", payload)[0]
            if not 1 <= length <= min(size - 4, 4_000_000):
                raise ValueError("Invalid native render options.")
            settings = json.loads(payload[4:4 + length])
            if not isinstance(settings, dict) or not isinstance(settings.get("values"), dict):
                raise ValueError("Invalid native plug-in settings.")
            data = native_perform(settings.get("id"), "render", settings, payload[4 + length:])
        except (OSError, ValueError, TimeoutExpired) as error:
            self.send_json({"error": str(error)}, 400)
            return
        self.send_bytes(data, "audio/wav")


def open_window(url):
    if os.name == "nt":
        roots = [Path(path) for name in ("PROGRAMFILES(X86)", "PROGRAMFILES", "LOCALAPPDATA")
                 if (path := os.environ.get(name))]
        for browser, relative in (("msedge", "Microsoft/Edge/Application/msedge.exe"),
                                  ("chrome", "Google/Chrome/Application/chrome.exe")):
            candidates = [root / relative for root in roots]
            if executable := which(browser):
                candidates.insert(0, Path(executable))
            for binary in candidates:
                if binary.is_file():
                    try:
                        Popen([str(binary), f"--app={url}"])
                        return
                    except OSError:
                        continue
    webbrowser.open(url)


def main():
    try:
        server = ThreadingHTTPServer(("127.0.0.1", 8765), AppHandler)
    except OSError:
        raise SystemExit("Port 8765 is in use. Close the previous Sonoravell window or open Sonoravell.html.")
    with server:
        url = "http://127.0.0.1:8765/"
        print(f"Sonoravell is open at {url}. Press Ctrl+C to stop.", flush=True)
        timer = Timer(0.25, lambda: open_window(url))
        timer.daemon = True
        timer.start()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
