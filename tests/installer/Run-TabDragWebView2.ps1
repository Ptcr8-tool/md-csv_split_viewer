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
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; public POINT(int x,int y) { X=x; Y=y; } }
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr handle, uint flags);
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
                $button = Element $window $expand
                if ($null -ne $button) {
                    # Use the actual screen control. WebView2's UIA Invoke can
                    # return without expanding a button that moves to a new DOM
                    # parent when clicked; a mouse click follows the user path.
                    $rect = $button.Current.BoundingRectangle
                    if (-not $rect.IsEmpty -and $rect.Width -gt 4 -and $rect.Height -gt 4) {
                        [void][DragTestNative]::SetCursorPos([int]($rect.Left+$rect.Width/2),[int]($rect.Top+$rect.Height/2))
                        [DragTestNative]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
                        [DragTestNative]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
                        Start-Sleep -Milliseconds 500
                    }
                }
            } catch [System.Windows.Automation.ElementNotAvailableException] { }
            Start-Sleep -Milliseconds 250
        } while ([DateTime]::UtcNow -lt $until)
        throw "Expected tab was not found: $name"
    }
    function Foreground($window, [int] $x, [int] $y, [int] $height = 600) {
        $handle = [IntPtr]::new($window.Current.NativeWindowHandle)
        if (-not [DragTestNative]::MoveWindow($handle,$x,$y,800,$height,$true)) { throw 'Could not position test window.' }
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
    function RootAt([int] $x, [int] $y) {
        $point = New-Object DragTestNative+POINT
        $point.X = $x; $point.Y = $y
        return [DragTestNative]::GetAncestor([DragTestNative]::WindowFromPoint($point),2)
    }
    function Drag($element, [int] $toX, [int] $toY, [bool] $escape) {
        $rect = $element.Current.BoundingRectangle
        if ($rect.IsEmpty -or $rect.Width -le 4 -or $rect.Height -le 4) { throw 'Tab has no usable screen bounds.' }
        $x = [int]($rect.Left + $rect.Width / 2); $y = [int]($rect.Top + $rect.Height / 2)
        [void][DragTestNative]::SetCursorPos($x,$y); Start-Sleep -Milliseconds 200
        [DragTestNative]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
        try {
            for ($i=1; $i -le 20; $i++) { [void][DragTestNative]::SetCursorPos([int]($x+($toX-$x)*$i/20),[int]($y+($toY-$y)*$i/20)); Start-Sleep -Milliseconds 35 }
            # Allow WebView2 to receive dragover at the final target before the
            # release, as a real user settling the pointer over a small control.
            Start-Sleep -Milliseconds 700
            Write-Output ("DIAGNOSTIC drag: start={0},{1}; end={2},{3}; rootAtEnd={4}" -f $x,$y,$toX,$toY,(RootAt $toX $toY))
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
    # Keep the source's single-tab strip folded and drop on its compact handle,
    # which is the target available to users by default. The source sits low
    # enough that the foreground detached window does not cover that handle.
    Foreground $source $screen.Left $screen.Top
    $until = [DateTime]::UtcNow.AddSeconds(30); $sourceHandle = $null
    do {
        try { $sourceHandle = Element $source $expand } catch [System.Windows.Automation.ElementNotAvailableException] { }
        if ($null -eq $sourceHandle) { Start-Sleep -Milliseconds 250 }
    } while ($null -eq $sourceHandle -and [DateTime]::UtcNow -lt $until)
    if ($null -eq $sourceHandle) { throw 'The folded source tab drop target was not visible.' }
    $destination = $sourceHandle.Current.BoundingRectangle
    $sourceRect = $source.Current.BoundingRectangle
    $targetY = [int]($sourceRect.Top + ($screen.Bottom-25) - ($destination.Top+$destination.Height/2))
    Foreground $source $screen.Left $targetY
    $sourceHandle = Element $source $expand
    if ($null -eq $sourceHandle) { throw 'The folded source tab drop target disappeared.' }
    $destination = $sourceHandle.Current.BoundingRectangle
    if ($destination.IsEmpty -or $destination.Top -lt $screen.Top -or $destination.Bottom -gt $screen.Bottom) { throw 'The folded source tab target is outside the working area.' }
    Foreground $detached 190 $screen.Top 560
    $detachedTab = Wait-Tab $detached 'first.md'
    $detachedRect = $detached.Current.BoundingRectangle
    if ($destination.Top -lt $detachedRect.Bottom -and $destination.Bottom -gt $detachedRect.Top -and $destination.Right -gt $detachedRect.Left -and $destination.Left -lt $detachedRect.Right) { throw 'The detached window covers the folded source drop target.' }
    $targetX = [int]($destination.Left+$destination.Width/2); $targetY = [int]($destination.Top+$destination.Height/2)
    $underTarget = RootAt $targetX $targetY
    $sourceRoot = [IntPtr]::new($source.Current.NativeWindowHandle)
    Write-Output ("DIAGNOSTIC drop target: rect={0}; sourceBounds={1}; detachedBounds={2}; hitRoot={3}; expectedRoot={4}" -f $destination,$source.Current.BoundingRectangle,$detachedRect,$underTarget,$sourceRoot)
    if ($underTarget -ne $sourceRoot) { throw 'The intended drop point is not over the source window.' }
    Drag $detachedTab $targetX $targetY $false
    $until = [DateTime]::UtcNow.AddSeconds(90)
    do { $count=@(Windows).Count; if ($count -eq 1) { break }; Start-Sleep -Milliseconds 250 } while ([DateTime]::UtcNow -lt $until)
    if ($count -ne 1) {
        foreach ($window in @(Windows)) {
            try {
                Write-Output ("DIAGNOSTIC window: title={0}; bounds={1}" -f $window.Current.Name,$window.Current.BoundingRectangle)
                $all = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
                foreach ($item in $all) {
                    $name = $item.Current.Name
                    if (-not [string]::IsNullOrWhiteSpace($name) -and -not $item.Current.IsOffscreen) {
                        Write-Output ("DIAGNOSTIC UIA: type={0}; name={1}" -f $item.Current.ControlType.ProgrammaticName,$name)
                    }
                }
            } catch [System.Windows.Automation.ElementNotAvailableException] { Write-Output 'DIAGNOSTIC window disappeared.' }
        }
        $errorLog = Join-Path $data 'errors.log'
        if (Test-Path -LiteralPath $errorLog) { Write-Output 'DIAGNOSTIC native error log:'; Get-Content -LiteralPath $errorLog -Encoding UTF8 | Select-Object -Last 50 }
        throw 'The detached tab was not joined back into one window.'
    }
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
