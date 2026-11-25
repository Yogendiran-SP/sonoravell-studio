"""Exercise the archive format with controlled stage bytes and no Windows tools."""
import importlib.util
from pathlib import Path
import tempfile
import zipfile


spec = importlib.util.spec_from_file_location(
    "package_alpha_candidate", Path(__file__).resolve().parents[1] / "scripts" / "package_alpha_candidate.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def rejects(operation):
    try:
        operation()
    except ValueError:
        return
    raise AssertionError("A broken archive or stage was accepted.")


with tempfile.TemporaryDirectory(prefix="sonoravell-candidate-") as directory:
    root = Path(directory)
    source = root / "stage"
    for name in module.REQUIRED:
        path = source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(name.encode("ascii"))
    commit = "a" * 40
    (source / "BUILD-INFO.txt").write_bytes(
        f"Version=0.1.0-alpha-candidate\nStatus=Candidate - acceptance pending\n"
        f"Source commit={commit}\nSource tree={'b' * 40}\n".encode("ascii"))
    first = module.stage(source, root / "first", commit)
    second = module.stage(source, root / "second", commit)
    assert first.read_bytes() == second.read_bytes()
    assert module.verify(first, commit) == "0.1.0-alpha-candidate"
    rejects(lambda: module.verify(first, "c" * 40))

    tampered = root / "tampered.zip"
    with zipfile.ZipFile(first) as source_zip, zipfile.ZipFile(tampered, "w") as bad:
        for entry in source_zip.namelist():
            bad.writestr(entry, b"changed" if entry == "SonoravellStudio.exe" else source_zip.read(entry))
    rejects(lambda: module.verify(tampered, commit))

    (source / "SonoravellStudio.exe").unlink()
    rejects(lambda: module.stage(source, root / "incomplete", commit))
