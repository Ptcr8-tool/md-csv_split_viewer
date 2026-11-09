# Upgrade validation against the verified, published v1.0.2 installer.
param(
    [Parameter(Mandatory = $true)][string] $OldSetup,
    [Parameter(Mandatory = $true)][string] $NewSetup
)

$ErrorActionPreference = 'Stop'
# Installing and uninstalling modifies per-user registration and shortcuts.
# This check must never touch a real user's computer or a self-hosted runner.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:OS -ne 'Windows_NT' -or -not $env:RUNNER_TEMP -or -not [Environment]::Is64BitOperatingSystem) {
    throw 'This check requires an isolated 64-bit GitHub-hosted Windows runner.'
}
if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne [Threading.ApartmentState]::STA) { throw 'Run this check with Windows PowerShell in an STA thread.' }

$old = (Resolve-Path -LiteralPath $OldSetup).Path
$new = (Resolve-Path -LiteralPath $NewSetup).Path
$expectedOldSha = 'd48c52d9292e479fca431674a68af1b9f80978694bc8b32ac8aaed19a2609a8d'
if ((Get-FileHash -LiteralPath $old -Algorithm SHA256).Hash -ine $expectedOldSha) { throw 'The v1.0.2 setup does not match the published release SHA-256.' }
$versionText = [Diagnostics.FileVersionInfo]::GetVersionInfo($new).ProductVersion
if ($versionText -notmatch '^(\d+\.\d+\.\d+)(?:\.\d+)?$') { throw 'Could not determine the new setup version.' }
$expectedNewVersion = [version]$Matches[1]
if ($expectedNewVersion -le [version]'1.0.2') { throw 'The new setup must be newer than v1.0.2.' }

$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MD Split'
$progIdKey = 'HKCU:\Software\Classes\MD.Split.Markdown'
$capabilities = 'HKCU:\Software\MD Split\Capabilities'
$registered = 'HKCU:\Software\RegisteredApplications'
$startLink = Join-Path ([Environment]::GetFolderPath('Programs')) 'MD-CSV Split Editor.lnk'
$desktopLink = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'MD-CSV Split Editor.lnk'
$legacyStartLink = Join-Path ([Environment]::GetFolderPath('Programs')) 'MD Split.lnk'
$legacyDesktopLink = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'MD Split.lnk'
$legacyData = Join-Path $env:LOCALAPPDATA 'MD Split'
if ((Get-Process -Name 'MD-Split' -ErrorAction SilentlyContinue) -or
    (Test-Path -LiteralPath $uninstallKey) -or (Test-Path -LiteralPath $progIdKey) -or
    (Test-Path -LiteralPath $capabilities) -or (Test-Path -LiteralPath $legacyData) -or
    (Test-Path -LiteralPath $startLink) -or (Test-Path -LiteralPath $desktopLink) -or
    (Test-Path -LiteralPath $legacyStartLink) -or (Test-Path -LiteralPath $legacyDesktopLink) -or
    (Get-ItemProperty -LiteralPath $registered -Name 'MD Split' -ErrorAction SilentlyContinue)) {
    throw 'Existing MD Split processes, data, registration or shortcuts were found; refusing the test.'
}
$typesSource = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\..\native\TextFileTypes.cs'))
$extensions = @([regex]::Matches($typesSource, 'new\("[^"\r\n]+",\s*\[([^\]]+)\]') | ForEach-Object {
    [regex]::Matches($_.Groups[1].Value, '"([a-z][a-z0-9]*)"') | ForEach-Object { '.' + $_.Groups[1].Value }
} | Select-Object -Unique)
if ($extensions.Count -lt 10 -or $extensions -notcontains '.md' -or $extensions -notcontains '.txt' -or $extensions -notcontains '.csv' -or $extensions -notcontains '.bat' -or $extensions -notcontains '.cmd') { throw 'Could not derive the supported file extensions.' }
function UserChoiceSnapshot([string] $Extension) {
    $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$Extension\UserChoice"
    if (-not (Test-Path -LiteralPath $key)) { return '<absent>' }
    $value = Get-ItemProperty -LiteralPath $key -ErrorAction Stop
    return ([string]$value.ProgId + "`n" + [string]$value.Hash)
}
function BatchClassDefaultSnapshot {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes\.bat')
    if ($null -eq $key) { return '<absent>' }
    try {
        $value = $key.GetValue('')
        if ($null -eq $value) { return '<absent>' }
        return [string]$value
    } finally { $key.Dispose() }
}
$initialBatchClassDefault = BatchClassDefaultSnapshot
$initialUserChoices = @{}
foreach ($extension in $extensions) {
    $openWith = "HKCU:\Software\Classes\$extension\OpenWithProgids"
    $newProgId = 'MD.Split.File.' + $extension.TrimStart('.').ToLowerInvariant()
    if ((Get-ItemProperty -LiteralPath $openWith -Name 'MD.Split.Markdown' -ErrorAction SilentlyContinue) -or
        (Get-ItemProperty -LiteralPath $openWith -Name $newProgId -ErrorAction SilentlyContinue) -or
        (Test-Path -LiteralPath ("HKCU:\Software\Classes\" + $newProgId))) { throw 'Existing file association found; refusing the test.' }
    $initialUserChoices[$extension] = UserChoiceSnapshot $extension
}

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = Join-Path $env:RUNNER_TEMP ('mdsplit-upgrade-' + [Guid]::NewGuid().ToString('N'))
$app = Join-Path $root 'Application'
$data = Join-Path $app 'Data'
$sessions = Join-Path $data 'Sessions'
$settings = Join-Path $data 'settings.json'
$process = $null
$verified = $false
$batchOpenWith = 'HKCU:\Software\Classes\.bat\OpenWithProgids'
$batchOpenWithNative = 'Software\Classes\.bat\OpenWithProgids'
$batchOtherProgId = 'MdSplit.Upgrade.Other.' + [Guid]::NewGuid().ToString('N')
if (Test-Path -LiteralPath $root) { throw 'The isolated test directory already exists.' }
[void][IO.Directory]::CreateDirectory($root)

function Invoke-Setup([string] $Path) {
    # NSIS requires /D= to be the last argument and accepts spaces in the path.
    $setup = Start-Process -FilePath $Path -ArgumentList @('/S', "/D=$app") -PassThru
    if (-not $setup.WaitForExit(900000)) { Stop-Process -Id $setup.Id -Force -ErrorAction SilentlyContinue; throw 'Setup timed out.' }
    if ($setup.ExitCode -ne 0) { throw "Setup failed with exit code $($setup.ExitCode)." }
}
function InstalledVersion {
    $dll = Join-Path $app 'MD-Split.dll'
    if (-not (Test-Path -LiteralPath $dll -PathType Leaf)) { throw 'Installed application DLL is missing.' }
    $value = [Diagnostics.FileVersionInfo]::GetVersionInfo($dll).FileVersion
    if ($value -notmatch '^(\d+\.\d+\.\d+)(?:\.\d+)?$') { throw 'Could not determine installed application version.' }
    return [version]$Matches[1]
}
function Window {
    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id)
    return [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
}
function Wait-Tab([string] $Name) {
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    do {
        $process.Refresh(); if ($process.HasExited) { throw 'The editor exited before the expected tab appeared.' }
        try {
            $window = Window
            if ($null -ne $window) {
                $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $Name)
                $item = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
                if ($null -ne $item -and -not $item.Current.IsOffscreen) { return }
            }
        } catch [System.Windows.Automation.ElementNotAvailableException] { }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "The expected tab was not exposed: $Name"
}
function Wait-Content([string] $Expected) {
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    do {
        $process.Refresh(); if ($process.HasExited) { throw 'The editor exited before the expected content appeared.' }
        try {
            $window = Window
            if ($null -ne $window) {
                $elements = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
                foreach ($item in $elements) {
                    if ($item.Current.IsOffscreen) { continue }
                    if ($item.Current.Name -and $item.Current.Name.Contains($Expected)) { return }
                    $pattern = $null
                    if ($item.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
                        $text = $pattern.DocumentRange.GetText(-1)
                        if ($text -and $text.Contains($Expected)) { return }
                    }
                    $pattern = $null
                    if ($item.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
                        $text = $pattern.Current.Value
                        if ($text -and $text.Contains($Expected)) { return }
                    }
                }
            }
        } catch [System.Windows.Automation.ElementNotAvailableException] { }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'The expected synthetic document content was not visible through UI Automation.'
}
function Close-Editor {
    $process.Refresh()
    if ($process.HasExited -or -not $process.CloseMainWindow() -or -not $process.WaitForExit(45000) -or $process.ExitCode -ne 0) { throw 'The editor did not close normally.' }
    $script:process = $null
}
function Wait-WebViewExit {
    $prefix = (Join-Path $app 'WebView2Runtime') + [IO.Path]::DirectorySeparatorChar
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    do {
        $remaining = @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { -not $_.ExecutablePath -or $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) })
        if ($remaining.Count -eq 0) { return }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'WebView2 did not exit after the editor closed.'
}
function Saved-Session {
    $files = @(Get-ChildItem -LiteralPath $sessions -Filter '*.json' -File)
    if ($files.Count -ne 1) { throw "Expected one saved session; found $($files.Count)." }
    return $files[0]
}
function Check-Session($File, [string] $First, [string] $Second) {
    $session = [IO.File]::ReadAllText($File.FullName) | ConvertFrom-Json
    if (@($session.documents).Count -ne 2 -or @($session.documents.path) -notcontains $First -or @($session.documents.path) -notcontains $Second) { throw 'The two saved tabs were not present in the session.' }
}
function Assert-UserChoices {
    foreach ($extension in $extensions) {
        if ((UserChoiceSnapshot $extension) -ne $initialUserChoices[$extension]) { throw "The default app changed for $extension." }
    }
    if ((BatchClassDefaultSnapshot) -ne $initialBatchClassDefault) { throw 'The per-user .bat class default changed.' }
}
function Assert-BatchExecution([string] $BatchPath, [string] $MarkerPath) {
    if (Test-Path -LiteralPath $MarkerPath) { Remove-Item -LiteralPath $MarkerPath -Force }
    # This controlled script is generated only within the disposable test root.
    # ShellExecute exercises the actual .bat association, not an explicit cmd /c.
    Start-Process -FilePath $BatchPath -WorkingDirectory $root | Out-Null
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while (-not (Test-Path -LiteralPath $MarkerPath -PathType Leaf) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 200 }
    if (-not (Test-Path -LiteralPath $MarkerPath -PathType Leaf) -or [IO.File]::ReadAllText($MarkerPath).Trim() -ne 'MD_SPLIT_UPGRADE_BATCH_FIXTURE') { throw 'The synthetic batch file did not execute through its Windows association.' }
}

try {
    $batchFixture = Join-Path $root 'synthetic-upgrade.bat'
    $batchMarker = Join-Path $root 'synthetic-upgrade-result.txt'
    [IO.File]::WriteAllText($batchFixture, "@echo off`r`necho MD_SPLIT_UPGRADE_BATCH_FIXTURE>`"%~dp0synthetic-upgrade-result.txt`"`r`n", [Text.Encoding]::ASCII)
    Assert-BatchExecution $batchFixture $batchMarker
    Invoke-Setup $old
    if ((InstalledVersion) -ne [version]'1.0.2') { throw 'The old setup did not install v1.0.2.' }
    if (-not [string]::Equals((Get-ItemProperty -LiteralPath $uninstallKey -Name InstallLocation).InstallLocation, $app, [StringComparison]::OrdinalIgnoreCase)) { throw 'Old setup registered an unexpected install directory.' }
    Assert-UserChoices
    $associations = Join-Path $capabilities 'FileAssociations'
    if ((Get-ItemProperty -LiteralPath $batchOpenWith -Name 'MD.Split.Markdown' -ErrorAction SilentlyContinue) -or (Get-ItemProperty -LiteralPath $associations -Name '.bat' -ErrorAction SilentlyContinue)) { throw 'v1.0.2 unexpectedly registered the bat editor candidate.' }
    $otherKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($batchOpenWithNative)
    try { $otherKey.SetValue($batchOtherProgId, '') } finally { $otherKey.Dispose() }
    [IO.File]::WriteAllText($settings, '{"welcomeShown":true,"updateCheckDays":-1,"sessionPolicy":"all","openPolicy":"tabs","theme":"dark","fontSize":17}', [Text.UTF8Encoding]::new($false))
    $first = Join-Path $root 'first.txt'; $second = Join-Path $root 'second.txt'
    [IO.File]::WriteAllText($first, 'UPGRADE_FIXTURE_ALPHA_73', [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($second, 'UPGRADE_FIXTURE_BETA_91', [Text.UTF8Encoding]::new($false))
    $firstHash = (Get-FileHash -LiteralPath $first -Algorithm SHA256).Hash
    $secondHash = (Get-FileHash -LiteralPath $second -Algorithm SHA256).Hash
    $process = Start-Process -FilePath (Join-Path $app 'MD-Split.exe') -ArgumentList @(('"' + $first + '"'), ('"' + $second + '"')) -PassThru
    Wait-Tab 'first.txt'; Wait-Tab 'second.txt'; Wait-Content 'UPGRADE_FIXTURE_BETA_91'; Close-Editor; Wait-WebViewExit
    $oldSession = Saved-Session
    Check-Session $oldSession $first $second
    $oldSettings = [IO.File]::ReadAllText($settings) | ConvertFrom-Json
    if ($oldSettings.sessionPolicy -ne 'all' -or $oldSettings.theme -ne 'dark' -or $oldSettings.fontSize -ne 17) { throw 'The old settings fixture was not retained.' }
    [void][IO.Directory]::CreateDirectory((Join-Path $data 'Recovery'))
    $sentinel = Join-Path $data 'Recovery\upgrade-preserve-fixture.txt'
    [IO.File]::WriteAllText($sentinel, 'preserve recovery data during upgrade', [Text.UTF8Encoding]::new($false))
    $preserve = @($settings, $oldSession.FullName, $sentinel)
    $hashes = @{}
    foreach ($file in $preserve) { $hashes[$file] = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash }

    Invoke-Setup $new
    if ((InstalledVersion) -ne $expectedNewVersion) { throw 'The new setup did not install the expected newer version.' }
    foreach ($name in @('gh.exe','trusted_root.jsonl','LICENSE.txt','THIRD_PARTY_LICENSES.txt')) {
        if (-not (Test-Path -LiteralPath (Join-Path $app "update-verifier\$name") -PathType Leaf)) { throw "The update verifier file is missing after upgrade: $name" }
    }
    $registeredVersion = (Get-ItemProperty -LiteralPath $uninstallKey -Name DisplayVersion).DisplayVersion
    if ([version]$registeredVersion -ne $expectedNewVersion) { throw 'The registered version did not update.' }
    if ((Get-ItemProperty -LiteralPath $batchOpenWith -Name 'MD.Split.Markdown' -ErrorAction SilentlyContinue) -or (Get-ItemProperty -LiteralPath $batchOpenWith -Name 'MD.Split.File.bat' -ErrorAction SilentlyContinue) -or (Test-Path -LiteralPath 'HKCU:\Software\Classes\MD.Split.File.bat') -or (Get-ItemProperty -LiteralPath $associations -Name '.bat' -ErrorAction SilentlyContinue)) { throw 'Upgrade retained or added a bat editor association.' }
    if (-not (Get-ItemProperty -LiteralPath $batchOpenWith -Name $batchOtherProgId -ErrorAction SilentlyContinue)) { throw 'Upgrade removed another bat app candidate.' }
    if (-not (Get-ItemProperty -LiteralPath 'HKCU:\Software\Classes\.cmd\OpenWithProgids' -Name 'MD.Split.File.cmd' -ErrorAction SilentlyContinue) -or (Get-ItemProperty -LiteralPath $associations -Name '.cmd' -ErrorAction Stop).PSObject.Properties['.cmd'].Value -ne 'MD.Split.File.cmd') { throw 'Upgrade lost cmd registration.' }
    foreach ($file in $preserve) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $hashes[$file]) { throw 'Upgrade changed or removed a settings, session or recovery fixture.' }
    }
    if ((Get-FileHash -LiteralPath $first -Algorithm SHA256).Hash -ne $firstHash -or (Get-FileHash -LiteralPath $second -Algorithm SHA256).Hash -ne $secondHash) { throw 'Upgrade changed a synthetic user document.' }
    Assert-UserChoices
    Assert-BatchExecution $batchFixture $batchMarker
    Write-Output 'PASS: upgrade preserves other apps, defaults, cmd and bat execution.'
    Write-Output 'PASS: v1.0.2 upgraded in place, preserving settings, session, recovery fixture, user documents and Windows default-app choices.'

    $process = Start-Process -FilePath (Join-Path $app 'MD-Split.exe') -PassThru
    Wait-Tab 'first.txt'; Wait-Tab 'second.txt'; Wait-Content 'UPGRADE_FIXTURE_BETA_91'; Close-Editor; Wait-WebViewExit
    $newSession = Saved-Session
    Check-Session $newSession $first $second
    $newSettings = [IO.File]::ReadAllText($settings) | ConvertFrom-Json
    if ($newSettings.sessionPolicy -ne 'all' -or $newSettings.theme -ne 'dark' -or $newSettings.fontSize -ne 17) { throw 'Settings did not survive the first new-version session.' }
    if ((Get-FileHash -LiteralPath $first -Algorithm SHA256).Hash -ne $firstHash -or (Get-FileHash -LiteralPath $second -Algorithm SHA256).Hash -ne $secondHash) { throw 'Starting the new editor changed a synthetic user document.' }
    Write-Output 'PASS: the new editor restored the old session and visible document content and retained settings.'

    $uninstall = Join-Path $app 'Uninstall.exe'
    $uninstaller = Start-Process -FilePath $uninstall -ArgumentList '/S' -PassThru
    if (-not $uninstaller.WaitForExit(180000) -or $uninstaller.ExitCode -ne 0) { throw 'Uninstall failed.' }
    $deadline = [DateTime]::UtcNow.AddMinutes(3)
    while ((Test-Path -LiteralPath $app) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Seconds 1 }
    if ((Test-Path -LiteralPath $app) -or (Test-Path -LiteralPath $uninstallKey) -or (Test-Path -LiteralPath $progIdKey)) { throw 'Uninstall left the test installation or registration behind.' }
    Assert-UserChoices
    if ((Get-FileHash -LiteralPath $first -Algorithm SHA256).Hash -ne $firstHash -or (Get-FileHash -LiteralPath $second -Algorithm SHA256).Hash -ne $secondHash) { throw 'Uninstall changed a synthetic user document.' }
    $verified = $true
    Write-Output 'PASS: uninstall removed only the dedicated test installation and kept documents and default-app choices.'
} finally {
    $otherKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($batchOpenWithNative, $true)
    if ($null -ne $otherKey) { try { $otherKey.DeleteValue($batchOtherProgId, $false) } finally { $otherKey.Dispose() } }
    if ($process -and -not $process.HasExited) {
        try { $null = $process.CloseMainWindow() } catch { }
        if (-not $process.WaitForExit(3000)) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue; $null = $process.WaitForExit(10000) }
    }
    # Failed fixtures stay on this disposable runner for diagnostics. Never
    # remove unrelated paths or attempt cleanup on a non-hosted machine.
    if ($verified -and (Test-Path -LiteralPath $root)) { Remove-Item -LiteralPath $root -Recurse -Force }
}


