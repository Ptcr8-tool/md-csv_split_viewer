param([Parameter(Mandatory = $true)][string] $Payload)

$ErrorActionPreference = 'Stop'
# Never drive a user's desktop: this test uses a disposable Windows CI runner.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:OS -ne 'Windows_NT' -or -not $env:RUNNER_TEMP) { throw 'An isolated GitHub-hosted Windows runner is required.' }
if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne [Threading.ApartmentState]::STA) { throw 'This test requires Windows PowerShell STA.' }
if ((Get-Process -Name 'MD-Split' -ErrorAction SilentlyContinue) -or (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'MD Split'))) { throw 'Existing application or data found; refusing the test.' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PrintSmokeMouse {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
}
'@
$payloadPath = (Resolve-Path -LiteralPath $Payload).Path
if (-not (Test-Path -LiteralPath (Join-Path $payloadPath 'MD-Split.exe') -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $payloadPath 'WebView2Runtime\msedgewebview2.exe') -PathType Leaf)) { throw 'A complete fixed-runtime Windows payload is required.' }
$testRoot = Join-Path $env:RUNNER_TEMP ('mdsplit-print-' + [Guid]::NewGuid().ToString('N'))
$application = Join-Path $testRoot 'Application'
[void][IO.Directory]::CreateDirectory($testRoot)
$process = $null
$verified = $false
try {
    Copy-Item -LiteralPath $payloadPath -Destination $application -Recurse
    $runtime = Join-Path $application 'WebView2Runtime'
    foreach ($sid in @('*S-1-15-2-2:(OI)(CI)(RX)', '*S-1-15-2-1:(OI)(CI)(RX)')) {
        & (Join-Path $env:WINDIR 'System32\icacls.exe') $runtime /grant $sid /T /Q | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not grant temporary runtime read access.' }
    }
    $data = Join-Path $application 'Data'
    [void][IO.Directory]::CreateDirectory($data)
    [IO.File]::WriteAllText((Join-Path $data 'settings.json'), '{"welcomeShown":true,"updateCheckDays":-1}', [Text.UTF8Encoding]::new($false))
    $md = Join-Path $testRoot 'fixture.md'
    [IO.File]::WriteAllText($md, "# Print fixture`n`nText for the print preview.", [Text.UTF8Encoding]::new($false))
    $process = Start-Process -FilePath (Join-Path $application 'MD-Split.exe') -ArgumentList ('"' + $md + '"') -PassThru

    function Get-AppWindow([int] $ProcessId) {
        $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ProcessId)
        return [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
    }
    function Wait-AppElement([string] $Name) {
        $until = [DateTime]::UtcNow.AddSeconds(90)
        do {
            if ($process.HasExited) { throw 'Application exited while waiting for a print control.' }
            $window = Get-AppWindow $process.Id
            if ($null -ne $window) {
                try {
                    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $Name)
                    $element = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
                    if ($null -ne $element -and $element.Current.IsEnabled -and -not $element.Current.IsOffscreen) { return $element }
                } catch [System.Windows.Automation.ElementNotAvailableException] { }
            }
            Start-Sleep -Milliseconds 250
        } while ([DateTime]::UtcNow -lt $until)
        throw "Print control was not exposed: $Name"
    }
    function Click-Element($Element) {
        $point = $Element.GetClickablePoint()
        if (-not [PrintSmokeMouse]::SetCursorPos([int]$point.X, [int]$point.Y)) { throw 'Could not position the pointer.' }
        [PrintSmokeMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
        [PrintSmokeMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 300
    }
    function Wait-PrintUi {
        $until = [DateTime]::UtcNow.AddSeconds(45)
        # Chromium's print dialog is separate WebView UI. Its destination or
        # printer setting must be visible; detecting our own app dialog is not sufficient.
        $names = @('Destination', 'Printer', '送信先', 'プリンター')
        do {
            if ($process.HasExited) { throw 'Application exited before showing print UI.' }
            foreach ($name in $names) {
                try {
                    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)
                    $items = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
                    foreach ($item in $items) { if (-not $item.Current.IsOffscreen) { return } }
                } catch [System.Windows.Automation.ElementNotAvailableException] { }
            }
            Start-Sleep -Milliseconds 500
        } while ([DateTime]::UtcNow -lt $until)
        throw 'The WebView2 printer destination control did not appear.'
    }
    foreach ($label in @('原文を印刷・PDF出力', '展開表示を印刷・PDF出力')) {
        $button = Wait-AppElement $label
        $window = Get-AppWindow $process.Id
        [void][PrintSmokeMouse]::SetForegroundWindow([IntPtr]$window.Current.NativeWindowHandle)
        Click-Element $button
        Click-Element (Wait-AppElement '適用')
        Wait-PrintUi
        Write-Output "PASS: WebView2 displayed the print UI for $label."
        [Windows.Forms.SendKeys]::SendWait('{ESC}')
        Start-Sleep -Seconds 2
    }
    $verified = $true
} finally {
    if ($null -ne $process -and -not $process.HasExited) {
        try { $null = $process.CloseMainWindow() } catch { }
        if (-not $process.WaitForExit(3000)) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue; $null = $process.WaitForExit(10000) }
    }
    if ($verified -and (Test-Path -LiteralPath $testRoot)) {
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        while ((Test-Path -LiteralPath $testRoot) -and [DateTime]::UtcNow -lt $deadline) {
            try { Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction Stop } catch { Start-Sleep -Milliseconds 500 }
        }
    }
}
