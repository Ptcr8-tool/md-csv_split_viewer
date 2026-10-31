param(
    [string] $MakeNsis = "makensis.exe",
    [switch] $Amd64
)

$ErrorActionPreference = "Stop"
if ($env:OS -ne "Windows_NT") {
    throw "These checks require Windows; compilation alone does not run them."
}
if (-not [Environment]::Is64BitOperatingSystem) {
    throw "These checks require 64-bit Windows, matching the application."
}

$buildDirectory = Join-Path ([IO.Path]::GetTempPath()) ("md-split-directory-checks-" + [Guid]::NewGuid().ToString("N"))
[void][IO.Directory]::CreateDirectory($buildDirectory)
$executable = Join-Path $buildDirectory "DirectoryChecks.exe"
$log = Join-Path $buildDirectory "DirectoryChecks.log"
$source = Join-Path $PSScriptRoot "DirectoryChecks.nsi"
$compilerArguments = @("/V2", "/DOUTPUT=$executable")
if ($Amd64) { $compilerArguments += "/DHARNESS_AMD64" }
$compilerArguments += $source

try {
    # Suppress compiler diagnostics containing machine-local absolute paths.
    $compilerOutput = & $MakeNsis @compilerArguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "NSIS harness compilation failed. No Windows checks were run."
    }
    $process = Start-Process -FilePath $executable -ArgumentList "/S" -Wait -PassThru
    if (-not (Test-Path -LiteralPath $log -PathType Leaf)) {
        throw "The Windows harness did not produce its result log."
    }
    Get-Content -LiteralPath $log
    if ($process.ExitCode -ne 0) {
        throw "Directory validation checks failed (exit $($process.ExitCode))."
    }
} finally {
    # This unique build directory contains only this run's executable and log.
    Remove-Item -LiteralPath $buildDirectory -Recurse -Force
}
