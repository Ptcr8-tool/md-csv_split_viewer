param([Parameter(Mandatory = $true)][string] $Payload)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:OS -ne 'Windows_NT' -or -not $env:RUNNER_TEMP) { throw 'An isolated GitHub-hosted Windows runner is required.' }
if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne [Threading.ApartmentState]::STA) { throw 'This test requires Windows PowerShell STA.' }
if ((Get-Process -Name 'MD-Split' -ErrorAction SilentlyContinue) -or (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'MD Split'))) { throw 'Existing application or data found; refusing the test.' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class EolSmokeMouse {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
}
'@
$payloadPath = (Resolve-Path -LiteralPath $Payload).Path
if (-not (Test-Path -LiteralPath (Join-Path $payloadPath 'MD-Split.exe') -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $payloadPath 'WebView2Runtime\msedgewebview2.exe') -PathType Leaf)) { throw 'A complete Windows payload is required.' }
$testRoot = Join-Path $env:RUNNER_TEMP ('mdsplit-eol-' + [Guid]::NewGuid().ToString('N'))
$application = Join-Path $testRoot 'Application'
[void][IO.Directory]::CreateDirectory($testRoot)
$process = $null; $verified = $false
try {
    Copy-Item -LiteralPath $payloadPath -Destination $application -Recurse
    foreach ($sid in @('*S-1-15-2-2:(OI)(CI)(RX)', '*S-1-15-2-1:(OI)(CI)(RX)')) {
        & (Join-Path $env:WINDIR 'System32\icacls.exe') (Join-Path $application 'WebView2Runtime') /grant $sid /T /Q | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not grant runtime read access.' }
    }
    $data = Join-Path $application 'Data'
    [void][IO.Directory]::CreateDirectory($data)
    [IO.File]::WriteAllText((Join-Path $data 'settings.json'), '{"welcomeShown":true,"updateCheckDays":-1,"sessionPolicy":"clear"}', [Text.UTF8Encoding]::new($false))
    $file = Join-Path $testRoot 'mixed.txt'
    $original = "one`r`ntwo`nthree`rfour"
    $converted = "one`ntwo`nthree`rfour"
    [IO.File]::WriteAllText($file, $original, [Text.UTF8Encoding]::new($false))
    function Start-Editor {
        return Start-Process -FilePath (Join-Path $application 'MD-Split.exe') -ArgumentList ('"' + $file + '"') -PassThru
    }
    function Window {
        $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id)
        return [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
    }
    function Wait-Element([string] $Name) {
        $until = [DateTime]::UtcNow.AddSeconds(90)
        do {
            if ($process.HasExited) { throw 'The application exited unexpectedly.' }
            try {
                $window = Window
                if ($null -ne $window) {
                    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $Name)
                    $element = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
                    if ($null -ne $element -and $element.Current.IsEnabled -and -not $element.Current.IsOffscreen) { return $element }
                }
            } catch [System.Windows.Automation.ElementNotAvailableException] { }
            Start-Sleep -Milliseconds 250
        } while ([DateTime]::UtcNow -lt $until)
        # When this fails, capture the visible automation names to distinguish
        # a blocked action from an unrecognized dialog or an off-screen window.
        try {
            $window = Window
            if ($null -ne $window) {
                $items = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
                $names = @($items | Where-Object { -not $_.Current.IsOffscreen -and $_.Current.Name } | Select-Object -First 60 | ForEach-Object { $_.Current.Name })
                Write-Output ('Visible UI names: ' + ($names -join ', '))
            }
        } catch { Write-Output ('Could not inspect UI names: ' + $_.Exception.Message) }
        throw "Expected UI element was not exposed: $Name"
    }
    function Click-Element($Element) {
        $window = Window
        if ($null -eq $window) { throw 'Window unavailable.' }
        [void][EolSmokeMouse]::SetForegroundWindow([IntPtr]$window.Current.NativeWindowHandle)
        # Use the accessibility action when available: physical coordinates at
        # the bottom of a hosted runner can otherwise fall under the taskbar.
        $pattern = $null
        if ($Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
            $pattern.Invoke()
            Start-Sleep -Milliseconds 300
            return
        }
        $point = $Element.GetClickablePoint()
        if (-not [EolSmokeMouse]::SetCursorPos([int]$point.X, [int]$point.Y)) { throw 'Could not position the pointer.' }
        [EolSmokeMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
        [EolSmokeMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 300
    }
    function Wait-File([string] $Expected) {
        $until = [DateTime]::UtcNow.AddSeconds(20)
        do {
            try { if ([IO.File]::ReadAllText($file) -ceq $Expected) { return } } catch [IO.IOException] { }
            Start-Sleep -Milliseconds 200
        } while ([DateTime]::UtcNow -lt $until)
        throw 'Saved file bytes did not contain the expected mixed line endings.'
    }
    function Close-Editor {
        if (-not $process.CloseMainWindow()) { throw 'Could not close the window.' }
        if (-not $process.WaitForExit(45000) -or $process.ExitCode -ne 0) { throw 'Window did not close cleanly.' }
    }
    $buttonName = -join @([char]0x6539,[char]0x884c,[char]0x30b3,[char]0x30fc,[char]0x30c9)
    $applyName = -join @([char]0x9069,[char]0x7528)
    $process = Start-Editor
    $null = Wait-Element 'mixed.txt'
    # The tab label can be exposed before the WebView's event handlers have
    # finished startup. Wait for the application to settle before clicking.
    Start-Sleep -Seconds 3
    Click-Element (Wait-Element $buttonName)
    # CRLF is the initial target, and LF is the initial replacement.
    Click-Element (Wait-Element $applyName)
    [Windows.Forms.SendKeys]::SendWait('^s')
    Wait-File $converted
    Write-Output 'PASS: CRLF-to-LF conversion was saved while existing LF and CR were retained.'
    [Windows.Forms.SendKeys]::SendWait('^z')
    [Windows.Forms.SendKeys]::SendWait('^s')
    Wait-File $original
    Write-Output 'PASS: undo restored the original mixed line endings on disk.'
    Close-Editor
    $process = Start-Editor
    $null = Wait-Element 'mixed.txt'
    [Windows.Forms.SendKeys]::SendWait('^s')
    Wait-File $original
    Close-Editor
    Write-Output 'PASS: reopening and saving did not normalize mixed line endings.'
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
