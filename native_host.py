"""Run explicitly selected installed plug-ins in a short-lived worker."""
from hashlib import sha256
from importlib.util import find_spec
from pathlib import Path
import json
import math
import struct
import subprocess
import sys
import tempfile

from local_media import scan_plugins


def available():
    return find_spec("pedalboard") is not None and find_spec("numpy") is not None


def plugin_id(path):
    return sha256(path.encode("utf-8")).hexdigest()[:32]


def discover():
    return [{**row, "id": plugin_id(row["path"])} for row in scan_plugins()]


def plugin_path(key):
    for row in discover():
        if row["id"] == key and row["kind"] in {"VST3", "Audio Unit"}:
            return row["path"]
    raise ValueError("The installed VST3 or Audio Unit was not found in the system scan.")


def perform(key, operation, settings=None, audio=b""):
    if not available():
        raise ValueError("Install Pedalboard into the Python used by the localhost launcher.")
    with tempfile.TemporaryDirectory(prefix="soundweave-native-") as folder:
        work = Path(folder)
        request = {"operation": operation, "path": plugin_path(key), "settings": settings or {}}
        (work / "request.json").write_text(json.dumps(request), encoding="utf-8")
        if audio:
            (work / "input.wav").write_bytes(audio)
        worker = subprocess.run(
            [sys.executable, str(Path(__file__).resolve()), str(work)], stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, timeout=95 if operation == "render" else 30, check=False
        )
        response = work / "result.json"
        if not response.is_file():
            raise ValueError("The native plug-in worker stopped before returning a result.")
        result = json.loads(response.read_text(encoding="utf-8"))
        if result.get("error"):
            raise ValueError(result["error"])
        if worker.returncode != 0:
            raise ValueError("The selected plug-in failed to load or render.")
        if operation == "render":
            return (work / "result.wav").read_bytes()
        return result


def read_wav(file):
    import numpy as np

    raw = file.read_bytes()
    if len(raw) < 44 or raw[:4] != b"RIFF" or raw[8:12] != b"WAVE":
        raise ValueError("Expected a PCM float Wave file.")
    code, channels, rate, _, _, bits = struct.unpack_from("<HHIIHH", raw, 20)
    if code != 3 or bits != 32 or channels not in (1, 2) or raw[36:40] != b"data":
        raise ValueError("Render a mono or stereo 32-bit float WAV for this plug-in.")
    count = struct.unpack_from("<I", raw, 40)[0]
    if count == 0 or count % (4 * channels) or 44 + count > len(raw) or not 8000 <= rate <= 192000:
        raise ValueError("Invalid waveform size or sample rate.")
    data = np.frombuffer(raw, dtype="<f4", count=count//4, offset=44)
    return np.ascontiguousarray(data.reshape((-1, channels)).T), rate


def write_wav(file, values, rate):
    import numpy as np

    audio = np.asarray(values, dtype=np.float32)
    if audio.ndim == 1:
        audio = audio[None, :]
    if audio.ndim != 2 or audio.shape[0] not in (1, 2) or not audio.shape[1]:
        raise ValueError("The plug-in must return one or two audio channels.")
    if not np.isfinite(audio).all():
        raise ValueError("The plug-in returned invalid audio samples.")
    channels = audio.shape[0]
    data = np.asarray(audio.T, dtype="<f4", order="C").tobytes()
    header = struct.pack("<4sI4s4sIHHIIHH4sI", b"RIFF", len(data) + 36, b"WAVE",
                         b"fmt ", 16, 3, channels, rate, rate * channels * 4,
                         channels * 4, 32, b"data", len(data))
    file.write_bytes(header + data)


def midi_messages(rows, duration, controls=None):
    if not isinstance(rows, list) or len(rows) > 100_000:
        raise ValueError("The MIDI selection is too large.")
    events = []
    for pitch, velocity, start, end in rows:
        if not isinstance(pitch, int) or not 0 <= pitch <= 127 or not isinstance(velocity, int) or not 1 <= velocity <= 127:
            raise ValueError("A MIDI note has an invalid pitch or velocity.")
        if not 0 <= start < end <= duration:
            raise ValueError("A MIDI note falls outside the render range.")
        events.append((bytes((0x90, pitch, velocity)), float(start)))
        events.append((bytes((0x80, pitch, 0)), float(end)))
    if controls is not None:
        if not isinstance(controls, list) or len(controls) > 100_000:
            raise ValueError("The MIDI control selection is too large.")
        for at, status, a, b in controls:
            if (not isinstance(at, (int, float)) or not 0 <= at <= duration or
                    status not in (0xB0, 0xE0) or
                    not all(isinstance(n, int) and 0 <= n <= 127 for n in (a, b))):
                raise ValueError("A MIDI control event is invalid.")
            events.append((bytes((status, a, b)), float(at)))
    order = {0x80: 0, 0xB0: 1, 0xE0: 1, 0x90: 2}
    return sorted(events, key=lambda item: (item[1], order[item[0][0]]))


def worker(directory):
    from pedalboard import load_plugin

    request = json.loads((directory / "request.json").read_text(encoding="utf-8"))
    plug = load_plugin(request["path"])
    if request["operation"] == "inspect":
        return {"instrument": bool(plug.is_instrument), "parameters": [
            {"key": key, "name": str(parameter.name or key), "unit": str(parameter.label or ""),
             "value": float(parameter.raw_value)}
            for key, parameter in plug.parameters.items()
            if math.isfinite(float(parameter.raw_value))
        ]}
    settings = request["settings"]
    for key, value in settings.get("values", {}).items():
        if key not in plug.parameters or not isinstance(value, (int, float)) or not 0 <= value <= 1:
            raise ValueError("A plug-in parameter is invalid.")
        plug.parameters[key].raw_value = value
    if plug.is_instrument:
        duration = float(settings["duration"])
        rate = 48000
        if not .01 <= duration <= 180:
            raise ValueError("Render up to three minutes per instrument pass.")
        messages = midi_messages(settings.get("notes", []), duration, settings.get("controls"))
        rendered = plug(messages, duration=duration, sample_rate=rate, num_channels=2)
    else:
        data, rate = read_wav(directory / "input.wav")
        rendered = plug(data, rate)
    write_wav(directory / "result.wav", rendered, rate)
    return {"ok": True}


def main(directory):
    work = Path(directory)
    try:
        result = worker(work)
    except Exception as error:
        result = {"error": str(error)[:350]}
    (work / "result.json").write_text(json.dumps(result), encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1])
