param([Parameter(Mandatory = $true)][string] $Payload)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:OS -ne 'Windows_NT' -or -not $env:RUNNER_TEMP) { throw 'An isolated GitHub-hosted Windows runner is required.' }
if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne [Threading.ApartmentState]::STA) { throw 'Windows PowerShell STA is required.' }
if ((Get-Process -Name 'MD-Split' -ErrorAction SilentlyContinue) -or (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'MD Split'))) { throw 'Existing application or data found; refusing the test.' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DragTestNative {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra);
    [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h,int x,int y,int width,int height,bool repaint);
}
'@
$payloadPath = (Resolve-Path -LiteralPath $Payload).Path
if (-not (Test-Path -LiteralPath (Join-Path $payloadPath 'MD-Split.exe') -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $payloadPath 'WebView2Runtime\msedgewebview2.exe') -PathType Leaf)) { throw 'A complete fixed-runtime Windows payload is required.' }
$testRoot = Join-Path $env:RUNNER_TEMP ('mdsplit-tab-drag-' + [Guid]::NewGuid().ToString('N'))
$application = Join-Path $testRoot 'Application'
[void][IO.Directory]::CreateDirectory($testRoot)
$process = $null
try {
    Copy-Item -LiteralPath $payloadPath -Destination $application -Recurse
    foreach ($sid in @('*S-1-15-2-2:(OI)(CI)(RX)', '*S-1-15-2-1:(OI)(CI)(RX)')) {
        & (Join-Path $env:WINDIR 'System32\icacls.exe') (Join-Path $application 'WebView2Runtime') /grant $sid /T /Q | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not grant temporary runtime read access.' }
    }
    $data = Join-Path $application 'Data'; [void][IO.Directory]::CreateDirectory($data)
    [IO.File]::WriteAllText((Join-Path $data 'settings.json'), '{"welcomeShown":true,"updateCheckDays":-1,"sessionPolicy":"clear","openPolicy":"tabs"}', [Text.UTF8Encoding]::new($false))
    $a = Join-Path $testRoot 'first.md'; $b = Join-Path $testRoot 'second.md'
    [IO.File]::WriteAllText($a, '# First fixture', [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($b, '# Second fixture', [Text.UTF8Encoding]::new($false))
    $process = Start-Process -FilePath (Join-Path $application 'MD-Split.exe') -ArgumentList @('"' + $a + '"','"' + $b + '"') -PassThru
    $expand = -join @([char]0x30bf,[char]0x30d6,[char]0x3092,[char]0x5c55,[char]0x958b)
    function Windows {
        $pc = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id)
        $items = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $pc)
        return @($items | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window -and $_.Current.Name -like '*MD-CSV Split Editor*' })
    }
    function Element($window, [string] $name) {
        $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)
        foreach ($item in $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)) {
            if (-not $item.Current.IsOffscreen) { return $item }
        }
        return $null
    }
    function Wait-Window([string] $name) {
        $until = [DateTime]::UtcNow.AddSeconds(90)
        do {
            if ($process.HasExited) { throw 'Editor exited unexpectedly.' }
            try { foreach ($w in (Windows)) { if ($w.Current.Name -like "*$name*") { return $w } } } catch [System.Windows.Automation.ElementNotAvailableException] { }
            Start-Sleep -Milliseconds 250
        } while ([DateTime]::UtcNow -lt $until)
        throw "Expected editor window was not found: $name"
    }
    function Wait-Tab($window, [string] $name) {
        $until = [DateTime]::UtcNow.AddSeconds(90)
        do {
            try {
                $tab = Element $window $name
                if ($null -eq $tab) { $tab = Element $window (([string][char]0x25cf)+' '+$name) }
                if ($null -ne $tab -and -not $tab.Current.IsOffscreen) { return $tab }
                $button = Element $window $expand; $invoke = $null
                if ($null -ne $button -and -not $button.Current.IsOffscreen -and $button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) { $invoke.Invoke() }
            } catch [System.Windows.Automation.ElementNotAvailableException] { }
            Start-Sleep -Milliseconds 250
        } while ([DateTime]::UtcNow -lt $until)
        throw "Expected tab was not found: $name"
    }
    function Foreground($window, [int] $x, [int] $y) {
        $handle = [IntPtr]::new($window.Current.NativeWindowHandle)
        if (-not [DragTestNative]::MoveWindow($handle,$x,$y,800,600,$true)) { throw 'Could not position test window.' }
        [void][DragTestNative]::SetForegroundWindow($handle); Start-Sleep -Milliseconds 500
    }
    function Wait-Content($window, [string] $expected) {
        $until = [DateTime]::UtcNow.AddSeconds(60)
        do {
            try {
                $items = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
                foreach ($item in $items) {
                    if ($item.Current.IsOffscreen) { continue }
                    if ($item.Current.Name -and $item.Current.Name.Contains($expected)) { return }
                    $pattern = $null
                    if ($item.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
                        $text = $pattern.DocumentRange.GetText(-1); if ($text -and $text.Contains($expected)) { return }
                    }
                    $pattern = $null
                    if ($item.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
                        $text = $pattern.Current.Value; if ($text -and $text.Contains($expected)) { return }
                    }
                }
            } catch [System.Windows.Automation.ElementNotAvailableException] { }
            Start-Sleep -Milliseconds 250
        } while ([DateTime]::UtcNow -lt $until)
        throw "Expected unsaved fixture text was not visible: $expected"
    }
    function Focus-Editor($window, [string] $expected) {
        $until = [DateTime]::UtcNow.AddSeconds(30)
        do {
            try {
                $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
                foreach ($candidate in $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)) {
                    if ($candidate.Current.IsOffscreen -or -not $candidate.Current.IsKeyboardFocusable) { continue }
                    $content = $candidate.Current.Name
                    $pattern = $null
                    if ($candidate.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) { $content += $pattern.DocumentRange.GetText(-1) }
                    $pattern = $null
                    if ($candidate.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) { $content += $pattern.Current.Value }
                    if ($content -and $content.Contains($expected)) { $candidate.SetFocus(); return }
                }
            } catch [System.Windows.Automation.ElementNotAvailableException] { }
            Start-Sleep -Milliseconds 250
        } while ([DateTime]::UtcNow -lt $until)
        throw "Could not locate the editable Markdown source containing: $expected"
    }
    function Wait-DetachedWindows {
        $until = [DateTime]::UtcNow.AddSeconds(90)
        do {
            if ($process.HasExited) { throw 'Editor exited during detachment.' }
            try {
                $items = @(Windows)
                $detached = $items | Where-Object { $_.Current.Name -like '*first.md*' } | Select-Object -First 1
                $source = $items | Where-Object { $_.Current.Name -like '*second.md*' } | Select-Object -First 1
                if ($null -ne $detached -and $null -ne $source -and $detached.Current.NativeWindowHandle -ne $source.Current.NativeWindowHandle) {
                    return @($detached, $source)
                }
            } catch [System.Windows.Automation.ElementNotAvailableException] { }
            Start-Sleep -Milliseconds 250
        } while ([DateTime]::UtcNow -lt $until)
        throw 'Expected two distinct editor windows after detachment.'
    }
    function Drag($element, [int] $toX, [int] $toY, [bool] $escape) {
        $rect = $element.Current.BoundingRectangle
        if ($rect.IsEmpty -or $rect.Width -le 4 -or $rect.Height -le 4) { throw 'Tab has no usable screen bounds.' }
        $x = [int]($rect.Left + $rect.Width / 2); $y = [int]($rect.Top + $rect.Height / 2)
        [void][DragTestNative]::SetCursorPos($x,$y); Start-Sleep -Milliseconds 200
        [DragTestNative]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
        try {
            for ($i=1; $i -le 20; $i++) { [void][DragTestNative]::SetCursorPos([int]($x+($toX-$x)*$i/20),[int]($y+($toY-$y)*$i/20)); Start-Sleep -Milliseconds 35 }
            if ($escape) { [DragTestNative]::keybd_event(0x1b,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 200; [DragTestNative]::keybd_event(0x1b,0,2,[UIntPtr]::Zero); Start-Sleep -Milliseconds 300 }
        } finally { [DragTestNative]::mouse_event(4,0,0,0,[UIntPtr]::Zero) }
    }
    $initial = Wait-Window 'second.md'; Foreground $initial 10 20
    $first = Wait-Tab $initial 'first.md'; [void](Wait-Tab $initial 'second.md')
    $invoke = $null
    if (-not $first.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) { throw 'Could not select the first tab.' }
    $invoke.Invoke()
    # Select the source editor by its actual content. Fixed screen coordinates
    # can hit the preview or toolbar and silently leave the document unchanged.
    Focus-Editor $initial 'First fixture'
    [Windows.Forms.SendKeys]::SendWait('^{END}'); [Windows.Forms.SendKeys]::SendWait(' UNSAVED_MARKER')
    Wait-Content $initial 'UNSAVED_MARKER'; $first = Wait-Tab $initial 'first.md'
    $screen = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    if ($screen.Width -lt 900 -or $screen.Height -lt 650) { throw 'The runner screen is too small for reliable drag testing.' }
    Drag $first ($screen.Right-10) 100 $false
    $windowsAfterDetach = @(Wait-DetachedWindows)
    $detached = $windowsAfterDetach[0]; $source = $windowsAfterDetach[1]
    Wait-Content $detached 'UNSAVED_MARKER'
    Write-Output 'PASS: dragging a tab outside creates a separate editor window.'
    Foreground $source 10 20; $sourceTab = Wait-Tab $source 'second.md'; $destination = $sourceTab.Current.BoundingRectangle
    Foreground $detached 190 30; $detachedTab = Wait-Tab $detached 'first.md'
    Drag $detachedTab ([int]($destination.Left+$destination.Width/2)) ([int]($destination.Top+$destination.Height/2)) $false
    $until = [DateTime]::UtcNow.AddSeconds(90)
    do { $count=@(Windows).Count; if ($count -eq 1) { break }; Start-Sleep -Milliseconds 250 } while ([DateTime]::UtcNow -lt $until)
    if ($count -ne 1) { throw 'The detached tab was not joined back into one window.' }
    $joined = @(Windows)[0]; $first = Wait-Tab $joined 'first.md'; [void](Wait-Tab $joined 'second.md'); Wait-Content $joined 'UNSAVED_MARKER'
    Write-Output 'PASS: dragging the detached tab into another editor joins its tab strip.'
    Foreground $joined 10 20; $first = Wait-Tab $joined 'first.md'
    Drag $first ($screen.Right-10) 100 $true
    Start-Sleep -Seconds 3
    if (@(Windows).Count -ne 1) { throw 'Escape unexpectedly created another window.' }
    $joined = @(Windows)[0]; [void](Wait-Tab $joined 'first.md'); [void](Wait-Tab $joined 'second.md')
    Wait-Content $joined 'UNSAVED_MARKER'
    Write-Output 'PASS: Escape cancels a tab drag without losing either document.'
} finally {
    if ($null -ne $process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue; $process.WaitForExit(10000) | Out-Null }
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
