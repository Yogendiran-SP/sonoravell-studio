# Sonoravell Studio Offline Desktop Alpha candidate

**Version 0.1.0-alpha-candidate · Windows x64 · Acceptance pending**

This is the frozen offline create-to-export scope from PR #36, with
release-blocking fixes and packaging tests. Native editing, built-in
instruments, manual mixer controls, and master/track inserts belong to the
candidate. Subsequent milestones have their own integration gates.

## Install and launch

1. Download the Windows artifact and extract the inner candidate ZIP to a
   new local folder.
2. Check **BUILD-INFO.txt** for the full source commit and source tree.
   The adjacent **.sha256** file records the archive digest. Use
   **Get-FileHash** in PowerShell to compute the copy's SHA-256.
   **SHA256SUMS.txt** inside the ZIP covers the installed files.
3. Start **SonoravellStudio.exe**. **Commands → About this build** displays
   its version and commit. If Windows policy blocks an unsigned build,
   record the result in the acceptance report and follow local policy.
4. Choose an endpoint through **Devices**. The factory output is WinMM.
   See the [acceptance checklist](ALPHA_RELEASE_CHECKLIST.md) for the
   offline workflow and [hardware protocol](HARDWARE_QUALIFICATION.md)
   for measured device behavior.

The candidate statically links the MSVC runtime and includes the native
application, render CLI, and hardware qualification CLI. Hands-on offline
launch remains pending until tested on a representative machine.

## Rebuild and verify

Use a clean checkout of the full **Source commit** in BUILD-INFO.txt.
Use the recorded CMake, Visual Studio generator, MSVC compiler, and Windows
SDK, plus Python 3.10 or newer for ZIP packaging. Use fresh build, package,
and candidate directories.

~~~powershell
$commit = git rev-parse HEAD
cmake -S . -B build -A x64 -DCMAKE_BUILD_TYPE=Release "-DSONORAVELL_SOURCE_COMMIT=$commit"
cmake --build build --config Release
ctest --test-dir build -C Release --output-on-failure
cmake --install build --config Release --prefix package
python scripts/package_alpha_candidate.py --commit $commit --stage package --output candidate
~~~

The packager fixes ZIP entry order and timestamps for identical staged
inputs. Match the recorded toolchain for rebuild comparisons; other
toolchains can emit different binaries. CI verifies the archive and launches
both the workspace smoke and render CLI from extracted files. To verify a
downloaded candidate, run the packager with **--commit** and **--verify**.

## Compatibility and rollback

- The candidate reads .sonora v1 through v4 and writes v4. Use a new
  filename to migrate older Sessions. Keep their original files for
  rollback. The PR #36 build can open compatible v4 Sessions.
- Unpack an older build alongside the candidate and launch it from its own
  folder. Preserve both binaries and all Session copies. Workspace settings
  and recording recovery live in the Windows user profile independently
  of the extracted build.
- Rollback baseline
  [201dc12](https://github.com/Yogendiran-SP/sonoravell-studio/commit/201dc128895769874486f81dc3dd5349127df5f3)
  and [Windows artifact](https://github.com/Yogendiran-SP/sonoravell-studio/actions/runs/45614472691/artifacts/15022660479).
  The older build uses the dynamic MSVC runtime.

Use the [release notes](ALPHA_RELEASE_NOTES.md),
[alpha acceptance report](ALPHA_ACCEPTANCE_REPORT.md),
[candidate hardware status](ALPHA_HARDWARE_REPORT.md), and
[bug report template](ALPHA_BUG_REPORT.md) with each acceptance run.
