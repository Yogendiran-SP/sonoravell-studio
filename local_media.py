"""Local plug-in discovery and audio transcoding for Sonoravell."""
from functools import lru_cache
from pathlib import Path
import json
import math
import os
import re
import shutil
import subprocess
import tempfile

FORMATS = {
    "wav": ("wav", "", "audio/wav"),
    "aiff": ("aiff", "", "audio/aiff"),
    "caf": ("caf", "", "audio/x-caf"),
    "flac": ("flac", "flac", "audio/flac"),
    "m4a": ("ipod", "aac", "audio/mp4"),
    "alac": ("ipod", "alac", "audio/mp4"),
    "ogg": ("ogg", "libvorbis", "audio/ogg"),
    "opus": ("opus", "libopus", "audio/ogg"),
    "mp3": ("mp3", "libmp3lame", "audio/mpeg"),
}
PLUGIN_TYPES = {".vst3": "VST3", ".vst": "VST2", ".dll": "VST2 candidate",
                ".component": "Audio Unit", ".clap": "CLAP", ".lv2": "LV2"}
BITRATES = {64, 96, 128, 160, 192, 224, 256, 320}
METADATA = {"title", "artist", "album", "comment", "genre", "track", "date", "bpm"}


def plugin_roots():
    home = Path.home()
    if os.name == "nt":
        common = Path(os.environ.get("CommonProgramFiles", r"C:\Program Files\Common Files"))
        program = Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
        roots = [common / name for name in ("VST3", "VST2", "CLAP")]
        roots.extend([program / "VstPlugins", program / "Steinberg" / "VstPlugins"])
        local = os.environ.get("LOCALAPPDATA")
        if local:
            roots.append(Path(local) / "Programs" / "Common" / "VST3")
        return roots
    if os.uname().sysname == "Darwin":
        base = [Path("/Library/Audio/Plug-Ins"), home / "Library/Audio/Plug-Ins"]
        return [root / plugin for root in base for plugin in ("VST3", "VST", "Components", "CLAP")]
    return [home / name for name in (".vst", ".vst3", ".clap", ".lv2")] + [
        Path(prefix) / name for prefix in ("/usr/lib", "/usr/local/lib")
        for name in ("vst", "vst3", "clap", "lv2")
    ]


def scan_plugins(roots=None):
    results = {}
    for root in plugin_roots() if roots is None else roots:
        if not root.is_dir():
            continue
        for base, dirs, files in os.walk(root, followlinks=False):
            relative = Path(base).relative_to(root)
            folders = list(dirs)
            if len(relative.parts) >= 8:
                dirs.clear()
            for name in folders + files:
                item = Path(base) / name
                kind = PLUGIN_TYPES.get(item.suffix.lower())
                if not kind:
                    continue
                if name in dirs:
                    dirs.remove(name)
                resolved = str(item.resolve())
                entry = {"name": item.stem, "kind": kind, "path": resolved}
                if kind == "VST3" and item.is_dir():
                    module = item / "Contents" / "Resources" / "moduleinfo.json"
                    try:
                        if module.stat().st_size <= 512 * 1024:
                            meta = json.loads(module.read_text(encoding="utf-8-sig"))
                            result_name = meta.get("Name")
                            if isinstance(result_name, str) and result_name.strip():
                                entry["name"] = result_name[:150]
                            vendor = meta.get("Factory Info", {}).get("Vendor")
                            if isinstance(vendor, str):
                                entry["vendor"] = vendor[:150]
                    except (OSError, ValueError, AttributeError):
                        pass
                results[resolved] = entry
                if len(results) >= 5000:
                    return sorted(results.values(), key=lambda e: e["name"].casefold())
    return sorted(results.values(), key=lambda e: e["name"].casefold())


@lru_cache(maxsize=1)
def codecs():
    path = shutil.which("ffmpeg")
    if not path:
        return None, []
    try:
        result = subprocess.run([path, "-hide_banner", "-encoders"], capture_output=True,
                                check=True, text=True, timeout=8)
    except (OSError, subprocess.SubprocessError):
        return None, []
    encoders = set(re.findall(r"^\s+A\S{5}\s+(\S+)", result.stdout, re.MULTILINE))
    return path, [name for name, (_, code, _) in FORMATS.items() if not code or code in encoders]


def options(params):
    form = params.get("format", "wav")
    if form not in FORMATS or form not in codecs()[1]:
        raise ValueError("This format requires an FFmpeg build with the matching encoder.")
    bits = int(params.get("bits", 24))
    rate = int(params.get("rate", 48000))
    bitrate = int(params.get("bitrate", 192))
    if bits not in (16, 24, 32) or rate not in (44100, 48000, 88200, 96000, 176400, 192000):
        raise ValueError("Unsupported bit depth or sample rate.")
    if bitrate not in BITRATES:
        raise ValueError("Unsupported bitrate.")
    if form == "opus":
        rate = 48000
    if form == "mp3" and rate > 48000:
        raise ValueError("MP3 supports up to 48 kHz in this exporter.")
    if form == "m4a" and rate > 96000:
        raise ValueError("AAC M4A supports up to 96 kHz in this exporter.")
    mux, encoder, mimetype = FORMATS[form]
    if form in {"wav", "aiff", "caf"}:
        endian = "be" if form == "aiff" else "le"
        encoder = f"pcm_f32{endian}" if bits == 32 else f"pcm_s{bits}{endian}"
    switches = ["-ar", str(rate), "-c:a", encoder]
    if form in {"flac", "alac"}:
        if bits == 32:
            raise ValueError("Choose 16- or 24-bit for this format.")
        if form == "flac":
            switches += ["-sample_fmt", "s16" if bits == 16 else "s32"]
        else:
            switches += ["-sample_fmt", "s16p" if bits == 16 else "s32p"]
    if form in {"mp3", "ogg"} and params.get("vbr") == "1":
        tiers = {64: 9, 96: 7, 128: 5, 160: 4, 192: 3, 224: 2, 256: 1, 320: 0}
        quality = tiers[bitrate] if form == "mp3" else 9 - tiers[bitrate]
        switches += ["-q:a", str(quality)]
    elif form in {"mp3", "ogg", "opus", "m4a"}:
        switches += ["-b:a", f"{bitrate}k"]
        if form == "opus":
            switches += ["-vbr", "on" if params.get("vbr") == "1" else "off"]
    switches += ["-f", mux]
    for key in METADATA:
        if value := params.get(key, "").strip():
            switches += ["-metadata", f"{key}={value[:200]}"]
    return form, switches, mimetype


def run_ffmpeg(exe, arguments):
    result = subprocess.run([exe, "-nostdin", "-hide_banner", *arguments],
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=180,
                            text=True, encoding="utf-8", errors="replace")
    if result.returncode:
        details = result.stderr.strip().splitlines()
        raise ValueError(details[-1][:250] if details else "Local audio conversion failed.")
    return result.stderr


def analyze_loudness(exe, src, target, ceiling):
    output = run_ffmpeg(exe, ["-i", str(src), "-af",
        f"loudnorm=I={target}:TP={ceiling}:LRA=50:print_format=json", "-f", "null", "-"])
    match = re.search(r'\{\s*"input_i".*?\}', output, re.DOTALL)
    if not match:
        raise ValueError("The encoder did not return a loudness reading.")
    levels = json.loads(match[0])
    measured = float(levels["input_i"])
    true_peak = float(levels["input_tp"])
    if not math.isfinite(measured) or not math.isfinite(true_peak):
        return 0
    return min(target - measured, ceiling - true_peak)


def transcode(audio, params):
    exe, _ = codecs()
    form, switches, mimetype = options(params)
    filters = []
    with tempfile.TemporaryDirectory(prefix="soundweave-audio-") as directory:
        src = Path(directory) / "source.wav"
        dst = Path(directory) / ("output." + ("m4a" if form == "alac" else form))
        src.write_bytes(audio)
        if params.get("loudness") == "1":
            target, ceiling = float(params["lufs"]), float(params["ceiling"])
            if not -36 <= target <= -5 or not -9 <= ceiling <= 0:
                raise ValueError("Loudness or true-peak target is outside its supported range.")
            gain = analyze_loudness(exe, src, target, ceiling)
            filters.append(f"volume={gain:.6f}dB")
        integer_pcm = int(params.get("bits", 24)) in (16, 24) and form in {"wav", "aiff", "caf", "flac", "alac"}
        if params.get("dither") == "1" and integer_pcm:
            bits = int(params.get("bits", 24))
            fmt = "s16" if bits == 16 else "s32"
            filters.append(f"aresample=osf={fmt}:output_sample_bits={bits}:dither_method=triangular")
        apply_filters = ["-af", ",".join(filters)] if filters else []
        run_ffmpeg(exe, ["-v", "error", "-i", str(src), "-map", "0:a:0", *apply_filters, *switches, str(dst)])
        return dst.read_bytes(), mimetype
