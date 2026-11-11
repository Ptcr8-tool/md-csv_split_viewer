param([Parameter(Mandatory=$true)][string] $Application,
      [Parameter(Mandatory=$true)][string] $TestRoot,
      [Parameter(Mandatory=$true)][string] $ProbeSource)

$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:OS -ne 'Windows_NT' -or -not $env:RUNNER_TEMP) {
    throw 'This Shell test requires an isolated GitHub-hosted Windows runner.'
}
if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne [Threading.ApartmentState]::STA) { throw 'Run this Shell test in an STA thread.' }
Add-Type -Path $ProbeSource
$app = (Resolve-Path -LiteralPath $Application).Path
$root = (Resolve-Path -LiteralPath $TestRoot).Path
if (-not $root.StartsWith((Resolve-Path -LiteralPath $env:RUNNER_TEMP).Path, [StringComparison]::OrdinalIgnoreCase)) { throw 'TestRoot is outside runner temp.' }
$choice = Join-Path (Split-Path -Parent $app) 'Data\context-menu-choice.txt'
$keys = @(
    'Software\Classes\*\shell\MD.Split.Open',
    'Software\Classes\Directory\Background\shell\MD.Split.New',
    'Software\Classes\Directory\shell\MD.Split.New',
    'Software\Classes\DesktopBackground\shell\MD.Split.New'
)
$commands = @(
    ('"' + $app + '" "%1"'),
    ('"' + $app + '" --new-in-directory "%V\."'),
    ('"' + $app + '" --new-in-directory "%1\."'),
    ('"' + $app + '" --new-in-desktop')
)
function Invoke-Registration([string] $Action) {
    $p = Start-Process -FilePath $app -ArgumentList $Action -WindowStyle Hidden -PassThru
    if (-not $p.WaitForExit(30000) -or $p.ExitCode -ne 0) { throw 'Context-menu registration command failed or timed out.' }
}
function Wait-ShellTitle([string] $Folder, [string] $Expected, [bool] $Present) {
    $until=[DateTime]::UtcNow.AddSeconds(20)
    do {
        $titles = [ShellBackgroundProbe]::GetTitles($Folder)
        $found = $titles -like ('*' + $Expected + '*')
        if ($found -eq $Present) { return $titles }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $until)
    throw "Windows Shell menu presence did not match expectations for $Folder."
}

try {
    for($i=0;$i -lt $keys.Count;$i++) {
        $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($keys[$i])
        if ($null -eq $key) { throw 'An enabled context-menu entry is missing.' }
        try {
            $title=[string]$key.GetValue('MUIVerb')
            if (-not $title -or [string]$key.GetValue('') -ne $title) { throw 'The menu entry requires matching default and MUIVerb labels.' }
            $multi=$key.GetValue('MultiSelectModel')
            if (($i -eq 1 -or $i -eq 3) -and $null -ne $multi) { throw 'A background entry should not have a single-item selection model.' }
        } finally { $key.Dispose() }
        $cmd=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($keys[$i] + '\command')
        if($null -eq $cmd) { throw 'Context-menu command is missing.' }
        try { if ([string]$cmd.GetValue('') -ne $commands[$i]) { throw 'Context-menu command is incorrect.' } } finally { $cmd.Dispose() }
    }
    $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($keys[1]); try { $title=[string]$key.GetValue('MUIVerb') } finally { $key.Dispose() }
    $folder=Join-Path $root ('special 100% ' + [char]0x65e5 + [char]0x672c)
    [void][IO.Directory]::CreateDirectory($folder)
    [void](Wait-ShellTitle $folder $title $true)
    $desktop = Wait-ShellTitle 'shell:Desktop' $title $true
    $count = @($desktop -split "`r?`n" | Where-Object { $_.Replace('&','') -eq $title.Replace('&','') }).Count
    if ($count -ne 1) { throw "Desktop context menu contains $count copies of the editor item." }
    Write-Output 'PASS: real Windows Shell background and desktop menus contain exactly one editor command.'

    Invoke-Registration '--context-menu-disable'
    if ([IO.File]::ReadAllText($choice).Trim() -ne '0') { throw 'Disabling was not saved.' }
    [void](Wait-ShellTitle $folder $title $false)
    [void](Wait-ShellTitle 'shell:Desktop' $title $false)
    Invoke-Registration '--context-menu-enable'
    if ([IO.File]::ReadAllText($choice).Trim() -ne '1') { throw 'Re-enabling was not saved.' }
    [void](Wait-ShellTitle $folder $title $true)
    Write-Output 'PASS: disabling removes the Shell entry and re-enabling restores it.'
} finally {
    # The workflow uses an ephemeral runner. Clean owned verbs even if a check
    # fails so subsequent independent tests start from a clean state.
    try { Invoke-Registration '--context-menu-disable' } catch { Write-Warning $_ }
}
