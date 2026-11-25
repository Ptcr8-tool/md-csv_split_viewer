param([Parameter(Mandatory=$true)][string] $Payload)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or -not $env:RUNNER_TEMP) { throw 'A disposable Windows runner is required.' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CsvBenchmarkMouse {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, int data, UIntPtr extra);
}
'@

$root = Join-Path $env:RUNNER_TEMP ('mdsplit-csv-perf-' + [Guid]::NewGuid().ToString('N'))
$null = [IO.Directory]::CreateDirectory($root)
$app = Join-Path $root Application
Copy-Item -LiteralPath (Resolve-Path -LiteralPath $Payload).Path -Destination $app -Recurse
foreach ($sid in @('*S-1-15-2-2:(OI)(CI)(RX)', '*S-1-15-2-1:(OI)(CI)(RX)')) {
    & (Join-Path $env:WINDIR 'System32\icacls.exe') (Join-Path $app WebView2Runtime) /grant $sid /T /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not grant temporary runtime access.' }
}
$data = Join-Path $app Data
$null = [IO.Directory]::CreateDirectory($data)
[IO.File]::WriteAllText((Join-Path $data settings.json), '{"language":"ja","welcomeShown":true,"updateCheckDays":-1,"openPolicy":"tabs","sessionPolicy":"clear"}', [Text.UTF8Encoding]::new($false))
$exe = Join-Path $app MD-Split.exe
$counts = @(100,500,1000,5000,10000)
$trials = 3
$fixtures = @{}
function Create-Csv([int]$Rows,[string]$Name) {
    $path = Join-Path $root $Name
    $text = [Text.StringBuilder]::new()
    $null = $text.AppendLine('ID,Name,Group,Status,Date,Note')
    for ($i = 1; $i -lt $Rows; $i++) {
        $id = '{0:D5}' -f $i
        $group = ($i - 1) % 20 + 1
        $status = if ($i % 2) { 'Pending' } else { 'Active' }
        $null = $text.AppendLine("$id,Record $id,Group $group,$status,2026-11-25,Synthetic data with a short note")
    }
    [IO.File]::WriteAllText($path,$text.ToString(),[Text.UTF8Encoding]::new($false))
    return $path
}
$warm = Create-Csv 5 'warm-up.csv'
foreach ($count in $counts) {
    $modes = if ($count -gt 1000) { 'paged','all' } else { 'paged' }
    foreach ($mode in $modes) {
        for ($trial=1; $trial -le $trials; $trial++) {
            $key = "$count-$mode-$trial"
            $fixtures[$key] = Create-Csv $count ($key + '.csv')
        }
    }
}
$process = Start-Process -FilePath $exe -ArgumentList ('"' + $warm + '"') -PassThru
function Get-Window {
    $cond = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty,$process.Id)
    return [Windows.Automation.AutomationElement]::RootElement.FindFirst([Windows.Automation.TreeScope]::Children,$cond)
}
function Find-Visible([string]$Name) {
    $window = Get-Window
    if ($null -eq $window) { return }
    try {
        $cond = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty,$Name)
        $element = $window.FindFirst([Windows.Automation.TreeScope]::Descendants,$cond)
        if ($null -ne $element -and $element.Current.IsEnabled -and -not $element.Current.IsOffscreen) { return $element }
    } catch [Windows.Automation.ElementNotAvailableException] { }
}
function Wait-Visible([string]$Name,[int]$Seconds = 45) {
    $end = [DateTime]::UtcNow.AddSeconds($Seconds)
    do {
        if ($process.HasExited) { throw 'MD-Split exited during the benchmark.' }
        $element = Find-Visible $Name
        if ($null -ne $element) { return $element }
        Start-Sleep -Milliseconds 20
    } while ([DateTime]::UtcNow -lt $end)
    throw "Expected UI element did not appear: $Name"
}
function Move-To($Element) {
    $window = Get-Window
    [void][CsvBenchmarkMouse]::SetForegroundWindow([IntPtr]$window.Current.NativeWindowHandle)
    $point = $Element.GetClickablePoint()
    if (-not [CsvBenchmarkMouse]::SetCursorPos([int]$point.X,[int]$point.Y)) { throw 'Could not position the wheel test pointer.' }
}
function Click($Element) {
    Move-To $Element
    [CsvBenchmarkMouse]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
    [CsvBenchmarkMouse]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
}
function Wheel([int]$Delta) {
    [CsvBenchmarkMouse]::mouse_event(2048,0,0,$Delta,[UIntPtr]::Zero)
    Start-Sleep -Milliseconds 90
}
function Wait-Absent([string]$Name) {
    $end = [DateTime]::UtcNow.AddSeconds(20)
    while ($null -ne (Find-Visible $Name)) {
        if ([DateTime]::UtcNow -ge $end) { throw "Unexpected UI element remained visible: $Name" }
        Start-Sleep -Milliseconds 25
    }
}
function Cell-Name([int]$Row) { return "$Row" + '行 1列を編集' }
function Verify-Scroll([int]$Records,[string]$Mode) {
    $startCell = Wait-Visible (Cell-Name 3)
    Move-To $startCell
    Wheel (-600)
    if ($null -ne (Find-Visible (Cell-Name 3))) { Wheel (-1200) }
    if ($null -ne (Find-Visible (Cell-Name 3))) { throw 'The table did not scroll away from its initial rows.' }
    $wheelDelta = if ($Mode -eq 'all') { -24000 } else { -9600 }
    $bound = [Math]::Ceiling($Records / 50) + 40
    $gestures = 1
    while ($null -eq (Find-Visible (Cell-Name $Records))) {
        if (++$gestures -gt $bound) { throw "The table did not scroll to row $Records in $Mode mode." }
        Wheel $wheelDelta
    }
    Wheel 1200
    if ($null -ne (Find-Visible (Cell-Name $Records))) { Wheel 2400 }
    if ($null -ne (Find-Visible (Cell-Name $Records))) { throw "The table did not move back up from row $Records." }
    return @{gestures=$gestures; lastRecord=$Records; up=$true}
}
function Report($Value) { Write-Output ('CSV_NATIVE ' + (ConvertTo-Json -InputObject $Value -Compress -Depth 6)) }

try {
    $null = Wait-Visible (Cell-Name 2) 90
    $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
    $machine = Get-CimInstance Win32_ComputerSystem
    $runtime = (Get-Item -LiteralPath (Join-Path $app 'WebView2Runtime\msedgewebview2.exe')).VersionInfo.ProductVersion
    Report @{environment=@{cpu=$cpu.Name; logicalCpus=$machine.NumberOfLogicalProcessors; ramBytes=$machine.TotalPhysicalMemory; runtime=$runtime; columns=6; trials=$trials}}
    foreach ($count in $counts) {
        $modes = if ($count -gt 1000) { 'paged','all' } else { 'paged' }
        foreach ($mode in $modes) {
            for ($trial=1; $trial -le $trials; $trial++) {
                $path = $fixtures["$count-$mode-$trial"]
                $name = [IO.Path]::GetFileName($path)
                $opening = [Diagnostics.Stopwatch]::StartNew()
                $opener = Start-Process -FilePath $exe -ArgumentList ('"' + $path + '"') -PassThru
                $promptMs = $null
                $renderMs = $null
                if ($count -gt 1000) {
                    $buttonName = if ($mode -eq 'all') { '⚠️ 無制限で表示' } else { '表示する' }
                    $button = Wait-Visible $buttonName
                    $promptMs = $opening.Elapsed.TotalMilliseconds
                    $render = [Diagnostics.Stopwatch]::StartNew()
                    Click $button
                    $null = Wait-Visible (Cell-Name 2)
                    $renderMs = $render.Elapsed.TotalMilliseconds
                    $openMs = $promptMs + $renderMs
                } else {
                    $null = Wait-Visible $name
                    $null = Wait-Visible (Cell-Name 2)
                    $openMs = $opening.Elapsed.TotalMilliseconds
                }
                if (-not $opener.WaitForExit(10000) -or $opener.ExitCode -ne 0) { throw 'The file-opening process failed.' }
                Report @{records=$count; mode=$mode; trial=$trial; byteSize=(Get-Item -LiteralPath $path).Length; openMs=$openMs; promptMs=$promptMs; renderMs=$renderMs}
                if ($trial -eq 1) { Report @{records=$count; mode=$mode; scroll=(Verify-Scroll $count $mode)} }
                $tabCloseName = $name + 'を閉じる'
                Click (Wait-Visible $tabCloseName)
                Wait-Absent $tabCloseName
                $null = Wait-Visible 'warm-up.csv'
            }
        }
    }
    Report @{complete=$true}
} finally {
    if ($process -and -not $process.HasExited) {
        try { $null = $process.CloseMainWindow() } catch { }
        if (-not $process.WaitForExit(8000)) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
    }
}
