"""Package or verify staged candidate files without timestamps from the host filesystem."""
import argparse
import hashlib
from pathlib import Path, PurePosixPath
import re
import zipfile


REQUIRED = {
    "BUILD-INFO.txt",
    "LICENSE",
    "SonoravellStudio.exe",
    "sonoravell-render.exe",
    "sonoravell-qualify.exe",
    "docs/ALPHA_CANDIDATE.md",
    "docs/ALPHA_ACCEPTANCE_REPORT.md",
    "docs/HARDWARE_QUALIFICATION_REPORT.md",
}
SHA256_LIST = "SHA256SUMS.txt"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def build_info(data, commit):
    fields = dict(entry.split("=", 1) for entry in data.decode("utf-8").splitlines())
    require(re.fullmatch(r"[0-9a-f]{40}", commit) and fields["Source commit"] == commit,
            "The staged source commit differs from the requested commit.")
    require(re.fullmatch(r"[0-9a-f]{40}", fields["Source tree"]),
            "A candidate requires a verified source tree.")
    require(re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+-alpha-candidate", fields["Version"]),
            "The candidate version is invalid.")
    require(fields["Status"] == "Candidate - acceptance pending", "The bundle must remain an acceptance candidate.")
    return fields["Version"]


def checksum_list(files):
    return "".join(f"{digest(data)}  {name}\n" for name, data in sorted(files.items())).encode("utf-8")


def verify(path, commit):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)), "Duplicate archive members.")
        for name in names:
            require(name == PurePosixPath(name).as_posix() and not name.startswith("/") and
                    ".." not in PurePosixPath(name).parts and "\\" not in name and ":" not in name,
                    "Unsafe archive member.")
        require(REQUIRED <= set(names) and SHA256_LIST in names, "Incomplete candidate archive.")
        version = build_info(archive.read("BUILD-INFO.txt"), commit)
        files = {name: archive.read(name) for name in names if name != SHA256_LIST}
        require(archive.read(SHA256_LIST) == checksum_list(files), "Candidate checksums do not match.")
        return version


def stage(source, output, commit):
    require(source.is_dir(), "The staged package directory is unavailable.")
    require(not output.resolve().is_relative_to(source.resolve()), "Choose an output directory outside of staging.")
    files = {}
    for path in source.rglob("*"):
        require(not path.is_symlink(), "Candidate staging may only contain regular files and directories.")
        if path.is_file():
            files[path.relative_to(source).as_posix()] = path.read_bytes()
    require(REQUIRED <= files.keys() and SHA256_LIST not in files, "Incomplete or previously sealed candidate staging.")
    version = build_info(files["BUILD-INFO.txt"], commit)
    files[SHA256_LIST] = checksum_list(files)
    output.mkdir(parents=True, exist_ok=True)
    path = output / f"Sonoravell-Studio-{version}-{commit[:7]}-Windows-x64.zip"
    with zipfile.ZipFile(path, mode="x") as archive:
        for name, data in sorted(files.items()):
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    verify(path, commit)
    (output / f"{path.name}.sha256").write_bytes(f"{digest(path.read_bytes())}  {path.name}\n".encode("ascii"))
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--verify", type=Path)
    parser.add_argument("--stage", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        if args.verify and not args.stage and not args.output:
            print(f"Verified {verify(args.verify, args.commit)} package {args.verify}")
        elif args.stage and args.output and not args.verify:
            print(stage(args.stage, args.output, args.commit))
        else:
            parser.error("Use --verify ZIP or --stage DIRECTORY --output DIRECTORY.")
    except (KeyError, OSError, ValueError, zipfile.BadZipFile) as error:
        parser.exit(1, f"Candidate package failed: {error}\n")


if __name__ == "__main__":
    main()
