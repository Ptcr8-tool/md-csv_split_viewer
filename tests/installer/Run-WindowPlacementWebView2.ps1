param([Parameter(Mandatory = $true)][string] $Payload)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:OS -ne 'Windows_NT' -or -not $env:RUNNER_TEMP) { throw 'An isolated GitHub-hosted Windows runner is required.' }
if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne [Threading.ApartmentState]::STA) { throw 'Run this test with Windows PowerShell STA.' }
if ((Get-Process -Name 'MD-Split' -ErrorAction SilentlyContinue) -or (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'MD Split'))) { throw 'Existing application or data found; refusing the test.' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PlacementTestWin32 {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hgt, bool repaint);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int command);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
}
'@
$payloadPath = (Resolve-Path -LiteralPath $Payload).Path
if (-not (Test-Path -LiteralPath (Join-Path $payloadPath 'MD-Split.exe') -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $payloadPath 'WebView2Runtime\msedgewebview2.exe') -PathType Leaf)) { throw 'A complete fixed-runtime payload is required.' }
$testRoot = Join-Path $env:RUNNER_TEMP ('mdsplit-placement-' + [Guid]::NewGuid().ToString('N'))
$application = Join-Path $testRoot 'Application'
[void][IO.Directory]::CreateDirectory($testRoot)
$process = $null
$verified = $false
try {
    Copy-Item -LiteralPath $payloadPath -Destination $application -Recurse
    foreach ($sid in @('*S-1-15-2-2:(OI)(CI)(RX)', '*S-1-15-2-1:(OI)(CI)(RX)')) {
        & (Join-Path $env:WINDIR 'System32\icacls.exe') (Join-Path $application 'WebView2Runtime') /grant $sid /T /Q | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not grant runtime read access.' }
    }
    $data = Join-Path $application 'Data'
    [void][IO.Directory]::CreateDirectory($data)
    [IO.File]::WriteAllText((Join-Path $data 'settings.json'), '{"welcomeShown":true,"updateCheckDays":-1,"sessionPolicy":"clear","openPolicy":"tabs"}', [Text.UTF8Encoding]::new($false))
    $first = Join-Path $testRoot 'first.md'; $second = Join-Path $testRoot 'second.md'
    [IO.File]::WriteAllText($first, '# First', [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($second, '# Second', [Text.UTF8Encoding]::new($false))
    $stateFile = Join-Path $data 'window-placement.json'
    function Start-Editor {
        $script:process = Start-Process -FilePath (Join-Path $application 'MD-Split.exe') -ArgumentList @('"' + $first + '"','"' + $second + '"') -PassThru
        Wait-Name 'second.md' 90 | Out-Null
        $process.Refresh()
        if ($process.MainWindowHandle -eq [IntPtr]::Zero) { throw 'Editor window handle is unavailable.' }
    }
    function Wait-Name([string] $Name, [int] $Timeout) {
        $until = [DateTime]::UtcNow.AddSeconds($Timeout)
        do {
            $process.Refresh()
            if ($process.HasExited) { throw 'Application exited unexpectedly.' }
            try {
                $pc = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id)
                $window = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $pc)
                if ($null -ne $window) {
                    $nc = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $Name)
                    $matches = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $nc)
                    foreach ($item in $matches) { if (-not $item.Current.IsOffscreen) { return $item } }
                }
            } catch [System.Windows.Automation.ElementNotAvailableException] { }
            Start-Sleep -Milliseconds 250
        } while ([DateTime]::UtcNow -lt $until)
        throw "Expected control was not exposed: $Name"
    }
    function Get-Bounds {
        $rect = New-Object PlacementTestWin32+RECT
        if (-not [PlacementTestWin32]::GetWindowRect($process.MainWindowHandle, [ref]$rect)) { throw 'Could not read the window rectangle.' }
        return $rect
    }
    function Close-Editor {
        if (-not $process.CloseMainWindow() -or -not $process.WaitForExit(45000) -or $process.ExitCode -ne 0) { throw 'Application did not close normally.' }
    }
    Start-Editor
    $area = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $width = [Math]::Max(800, [Math]::Min(940, $area.Width))
    $height = [Math]::Max(560, [Math]::Min(680, $area.Height))
    if (-not [PlacementTestWin32]::MoveWindow($process.MainWindowHandle, $area.Left, $area.Top, $width, $height, $true)) { throw 'Could not resize the editor.' }
    Start-Sleep -Milliseconds 500
    $original = Get-Bounds
    Close-Editor
    $saved = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    if ([Math]::Abs($saved.width - ($original.Right-$original.Left)) -gt 8 -or [Math]::Abs($saved.height - ($original.Bottom-$original.Top)) -gt 8 -or $saved.maximized) { throw 'Normal window size was not saved.' }
    Start-Editor
    $restored = Get-Bounds
    if ([Math]::Abs(($restored.Right-$restored.Left)-$saved.width) -gt 8 -or [Math]::Abs(($restored.Bottom-$restored.Top)-$saved.height) -gt 8) { throw 'Normal window size did not survive restart.' }
    Write-Output 'PASS: normal window size survives actual close and restart.'

    # Modify an open document, cancel the close and ensure the last saved placement remains intact.
    $before = (Get-FileHash -LiteralPath $stateFile -Algorithm SHA256).Hash
    [void][PlacementTestWin32]::MoveWindow($process.MainWindowHandle, $area.Left, $area.Top, [Math]::Max(800,$width-80), [Math]::Max(560,$height-60), $true)
    $rect = Get-Bounds
    [void][PlacementTestWin32]::SetForegroundWindow($process.MainWindowHandle)
    [void][PlacementTestWin32]::SetCursorPos($rect.Left+280, $rect.Top+250)
    [PlacementTestWin32]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
    [PlacementTestWin32]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
    [Windows.Forms.SendKeys]::SendWait('x')
    Start-Sleep -Milliseconds 500
    if (-not $process.CloseMainWindow()) { throw 'Could not request a close.' }
    $cancel = Wait-Name 'キャンセル' 20
    $cancel.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
    Start-Sleep -Milliseconds 500
    if ($process.HasExited -or (Get-FileHash -LiteralPath $stateFile -Algorithm SHA256).Hash -ne $before) { throw 'Canceled close changed saved placement or closed the application.' }
    if (-not $process.CloseMainWindow()) { throw 'Could not request close after cancellation.' }
    $discard = Wait-Name '保存せずに閉じる' 20
    $discard.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
    if (-not $process.WaitForExit(45000) -or $process.ExitCode -ne 0) { throw 'Application did not close after discard.' }
    Write-Output 'PASS: canceling a close leaves the saved window placement unchanged.'

    Start-Editor
    [void][PlacementTestWin32]::ShowWindow($process.MainWindowHandle, 3)
    $until = [DateTime]::UtcNow.AddSeconds(15)
    while (-not [PlacementTestWin32]::IsZoomed($process.MainWindowHandle) -and [DateTime]::UtcNow -lt $until) { Start-Sleep -Milliseconds 200 }
    if (-not [PlacementTestWin32]::IsZoomed($process.MainWindowHandle)) { throw 'Could not maximize the editor.' }
    Close-Editor
    $saved = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    if (-not $saved.maximized) { throw 'Maximized state was not saved.' }
    Start-Editor
    if (-not [PlacementTestWin32]::IsZoomed($process.MainWindowHandle)) { throw 'Maximized state did not survive restart.' }
    Close-Editor
    Write-Output 'PASS: maximized window state survives actual close and restart.'
    $verified = $true
} finally {
    if ($null -ne $process -and -not $process.HasExited) {
        try { $null = $process.CloseMainWindow() } catch { }
        if (-not $process.WaitForExit(3000)) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue; $null = $process.WaitForExit(10000) }
    }
    if ($verified -and (Test-Path -LiteralPath $testRoot)) { Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
