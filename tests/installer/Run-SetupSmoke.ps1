param([Parameter(Mandatory)][string] $Setup)

$ErrorActionPreference = 'Stop'
# Product installation writes per-user registry and shortcuts. Never run this
# destructive smoke test on a developer machine or on a self-hosted runner.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:OS -ne 'Windows_NT') {
    throw 'The setup smoke test requires an ephemeral GitHub-hosted Windows runner.'
}
if (-not [Environment]::Is64BitOperatingSystem -or -not $env:RUNNER_TEMP) { throw 'A 64-bit Windows runner with RUNNER_TEMP is required.' }
$setupPath = (Resolve-Path -LiteralPath $Setup).Path
$testRoot = Join-Path $env:RUNNER_TEMP ('md-split-setup-smoke-' + [Guid]::NewGuid().ToString('N'))
$installPath = Join-Path $testRoot 'Application'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MD Split'
$progIdKey = 'HKCU:\Software\Classes\MD.Split.Markdown'
$capabilities = 'HKCU:\Software\MD Split\Capabilities'
$registered = 'HKCU:\Software\RegisteredApplications'
$startLink = Join-Path ([Environment]::GetFolderPath('Programs')) 'MD-CSV Split Editor.lnk'
$desktopLink = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'MD-CSV Split Editor.lnk'
$legacyStartLink = Join-Path ([Environment]::GetFolderPath('Programs')) 'MD Split.lnk'
$legacyDesktopLink = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'MD Split.lnk'
$legacyData = Join-Path $env:LOCALAPPDATA 'MD Split'

# Refuse to overwrite or remove an existing installation, registration or data.
if ((Get-Process -Name 'MD-Split' -ErrorAction SilentlyContinue) -or
    (Test-Path -LiteralPath $uninstallKey) -or (Test-Path -LiteralPath $progIdKey) -or
    (Test-Path -LiteralPath $capabilities) -or (Test-Path -LiteralPath $legacyData) -or
    (Test-Path -LiteralPath $startLink) -or (Test-Path -LiteralPath $desktopLink) -or
    (Test-Path -LiteralPath $legacyStartLink) -or (Test-Path -LiteralPath $legacyDesktopLink) -or
    (Get-ItemProperty -LiteralPath $registered -Name 'MD Split' -ErrorAction SilentlyContinue)) {
    throw 'Existing MD Split data or registration was found; refusing the smoke test.'
}
# Derive the exact supported extension set from the same native list used by
# registration. Fail if parsing ever stops matching the canonical list.
$typesSource = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\..\native\TextFileTypes.cs'))
$extensions = @([regex]::Matches($typesSource, 'new\("[^"\r\n]+",\s*\[([^\]]+)\]') | ForEach-Object {
    [regex]::Matches($_.Groups[1].Value, '"([a-z][a-z0-9]*)"') | ForEach-Object { '.' + $_.Groups[1].Value }
} | Select-Object -Unique)
if ($extensions.Count -lt 10 -or -not ($extensions -contains '.md') -or -not ($extensions -contains '.csv') -or -not ($extensions -contains '.html') -or -not ($extensions -contains '.txt')) {
    throw 'Could not derive the supported extension list from TextFileTypes.'
}
function UserChoiceSnapshot([string] $Extension) {
    $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$Extension\UserChoice"
    if (-not (Test-Path -LiteralPath $key)) { return '<absent>' }
    $value = Get-ItemProperty -LiteralPath $key -ErrorAction Stop
    return ([string]$value.ProgId + "`n" + [string]$value.Hash)
}
$initialUserChoices = @{}
foreach ($extension in $extensions) {
    $openWith = "HKCU:\Software\Classes\$extension\OpenWithProgids"
    if (Get-ItemProperty -LiteralPath $openWith -Name 'MD.Split.Markdown' -ErrorAction SilentlyContinue) {
        throw 'An existing file association was found; refusing the smoke test.'
    }
    $initialUserChoices[$extension] = UserChoiceSnapshot $extension
}
if (Test-Path -LiteralPath $testRoot) { throw 'The isolated test directory already exists.' }
[void][IO.Directory]::CreateDirectory($testRoot)

function Invoke-CheckedProcess([string] $File, [string[]] $ProcessArguments, [int] $TimeoutSeconds = 900) {
    $process = Start-Process -FilePath $File -ArgumentList $ProcessArguments -PassThru
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        throw 'A setup process timed out.'
    }
    if ($process.ExitCode -ne 0) { throw "A setup process failed with exit code $($process.ExitCode)." }
}
function Assert-File([string] $Path, [string] $Description) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing: $Description" }
}

$cleaned = $false
try {
    # NSIS requires /D= to be the final argument and accepts spaces without
    # quoting its value. RUNNER_TEMP and the suffix contain no shell commands.
    Invoke-CheckedProcess $setupPath @('/S', "/D=$installPath")
    $app = Join-Path $installPath 'MD-Split.exe'
    $html = Join-Path $installPath 'wwwroot\index.html'
    $uninstaller = Join-Path $installPath 'Uninstall.exe'
    Assert-File $app 'application executable'
    Assert-File $html 'application UI'
    Assert-File $uninstaller 'uninstaller'
    Assert-File (Join-Path $installPath 'WebView2Runtime\msedgewebview2.exe') 'offline WebView runtime'
    Assert-File (Join-Path $installPath 'install.ini') 'ownership marker'
    $location = (Get-ItemProperty -LiteralPath $uninstallKey -Name InstallLocation).InstallLocation
    if (-not [string]::Equals($location, $installPath, [StringComparison]::OrdinalIgnoreCase)) { throw 'The registered install location does not match the test directory.' }
    if (-not (Test-Path -LiteralPath $progIdKey)) { throw 'The application association was not registered.' }
    $associations = Join-Path $capabilities 'FileAssociations'
    foreach ($extension in $extensions) {
        $openWith = "HKCU:\Software\Classes\$extension\OpenWithProgids"
        if (-not (Get-ItemProperty -LiteralPath $openWith -Name 'MD.Split.Markdown' -ErrorAction SilentlyContinue)) { throw "Open With candidate missing for $extension." }
        $value = Get-ItemProperty -LiteralPath $associations -Name $extension -ErrorAction Stop
        if ($value.PSObject.Properties[$extension].Value -ne 'MD.Split.Markdown') { throw "Default-app capability missing for $extension." }
        if ((UserChoiceSnapshot $extension) -ne $initialUserChoices[$extension]) { throw "Installation unexpectedly changed the default app for $extension." }
    }
    Write-Output 'PASS: silent install registered every supported type as a candidate without changing default apps.'

    $sentinel = Join-Path $installPath 'Data\smoke-preserved.txt'
    [IO.File]::WriteAllText($sentinel, 'preserve during repair')
    Remove-Item -LiteralPath $html -Force
    Invoke-CheckedProcess $setupPath @('/S', "/D=$installPath")
    Assert-File $html 'repaired application UI'
    if ([IO.File]::ReadAllText($sentinel) -ne 'preserve during repair') { throw 'Repair did not preserve application data.' }
    Write-Output 'PASS: same-version silent repair restored a missing file and preserved data.'

    Invoke-CheckedProcess $uninstaller @('/S')
    # NSIS uninstallers may continue in a temporary child process.
    $deadline = [DateTime]::UtcNow.AddMinutes(3)
    while ((Test-Path -LiteralPath $installPath) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Seconds 1 }
    if (Test-Path -LiteralPath $installPath) { throw 'Uninstall did not remove the installation directory.' }
    if ((Test-Path -LiteralPath $uninstallKey) -or (Test-Path -LiteralPath $progIdKey)) { throw 'Uninstall left product registration behind.' }
    foreach ($extension in $extensions) {
        $openWith = "HKCU:\Software\Classes\$extension\OpenWithProgids"
        if (Get-ItemProperty -LiteralPath $openWith -Name 'MD.Split.Markdown' -ErrorAction SilentlyContinue) { throw "Uninstall left an Open With candidate for $extension." }
        if ((UserChoiceSnapshot $extension) -ne $initialUserChoices[$extension]) { throw "Uninstall unexpectedly changed the default app for $extension." }
    }
    if (Test-Path -LiteralPath $startLink) { throw 'Uninstall left the start-menu shortcut behind.' }
    $cleaned = $true
    Write-Output 'PASS: silent uninstall removed the dedicated folder and product registration.'
} finally {
    # If a step fails, preserve the isolated directory for runner diagnostics;
    # the hosted runner is destroyed after the job. Never clean unrelated paths.
    if ($cleaned -and (Test-Path -LiteralPath $testRoot)) { Remove-Item -LiteralPath $testRoot -Force -Recurse }
}
