# Windows installer directory checks

The harness includes the production `installer/DirectoryValidation.nsh`; it
calls the same `CheckInstallDirectory` function as the installer. It contains
no app payload and performs no registry, network, or shell operations.

On Windows with NSIS installed, run from PowerShell:

```powershell
powershell -NoProfile -File tests/installer/Run-DirectoryChecks.ps1 -MakeNsis "C:\Program Files (x86)\NSIS\makensis.exe"
```

The runner compiles and executes a temporary harness, prints its case results,
then removes its unique build directory. A nonzero harness exit causes the
runner to fail. `-Amd64` additionally selects an amd64 Unicode harness; the
default matches the installer's x86 Unicode stub on 64-bit Windows.

The 30 checks cover nonexistent parents/leaves, empty/nonempty/hidden/dot-file
directories, file targets/ancestors, owned/legacy installs, protected locations,
UNC/device/relative paths, `..`, trailing separators, and Unicode plus spaces.
Validation of protected paths is read-only. Fixture writes and cleanup are
limited to a fresh directory generated below the Windows temporary directory.
The log contains case labels and error codes, never paths or usernames.

Compiling on another OS checks NSIS syntax only. It does **not** establish that
these Windows runtime checks passed. Junction/access-denied/long-path cases and
the full installer UI still require separate Windows verification.
