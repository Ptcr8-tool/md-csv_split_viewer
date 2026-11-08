param([Parameter(Mandatory = $true)][string] $Payload)
$ErrorActionPreference = 'Stop'
# Only operate on a temporary copy and synthetic fixture on disposable runners.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:OS -ne 'Windows_NT' -or -not $env:RUNNER_TEMP) { throw 'An isolated GitHub-hosted Windows runner is required.' }
if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne [Threading.ApartmentState]::STA) { throw 'This test requires Windows PowerShell STA.' }
if ((Get-Process -Name 'MD-Split' -ErrorAction SilentlyContinue) -or (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'MD Split'))) { throw 'Existing application or data found; refusing the test.' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$payloadPath = (Resolve-Path -LiteralPath $Payload).Path
if (-not (Test-Path -LiteralPath (Join-Path $payloadPath 'MD-Split.exe') -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $payloadPath 'WebView2Runtime\msedgewebview2.exe') -PathType Leaf)) { throw 'A complete fixed-runtime Windows payload is required.' }
$root = Join-Path $env:RUNNER_TEMP ('mdsplit-binary-' + [Guid]::NewGuid().ToString('N'))
$app = Join-Path $root 'Application'
$fixture = Join-Path $root 'binary-fixture.mp4'
$process = $null
$viewer = $null
$verified = $false
[void][IO.Directory]::CreateDirectory($root)
try {
    Copy-Item -LiteralPath $payloadPath -Destination $app -Recurse
    foreach ($sid in @('*S-1-15-2-2:(OI)(CI)(RX)', '*S-1-15-2-1:(OI)(CI)(RX)')) {
        & (Join-Path $env:WINDIR 'System32\icacls.exe') (Join-Path $app 'WebView2Runtime') /grant $sid /T /Q | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not grant temporary runtime read access.' }
    }
    $data = Join-Path $app 'Data'; [void][IO.Directory]::CreateDirectory($data)
    [IO.File]::WriteAllText((Join-Path $data 'settings.json'), '{"welcomeShown":true,"updateCheckDays":-1,"sessionPolicy":"clear","openPolicy":"tabs"}', [Text.UTF8Encoding]::new($false))
    $stream = [IO.File]::Open($fixture, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    try {
        $stream.SetLength(3 * 65536 + 4)
        $stream.Position = 0; $header = [byte[]](0,0,0,24,0x66,0x74,0x79,0x70); $stream.Write($header,0,$header.Length)
        $stream.Position = 65536; $middle = [byte[]](0x12,0x34,0x56,0x78); $stream.Write($middle,0,$middle.Length)
        $marker = [Text.Encoding]::UTF8.GetBytes('SEARCH-MARK')
        $stream.Position = 65536 + 32; $stream.Write($marker,0,$marker.Length)
        $stream.Position = 2 * 65536 + 16; $stream.Write($marker,0,$marker.Length)
        $stream.Position = 3 * 65536; $tail = [byte[]](0xDE,0xAD,0xBE,0xEF); $stream.Write($tail,0,$tail.Length)
    } finally { $stream.Dispose() }
    $before = (Get-FileHash -LiteralPath $fixture -Algorithm SHA256).Hash
    $process = Start-Process -FilePath (Join-Path $app 'MD-Split.exe') -ArgumentList @('--startup-trace', ('"' + $fixture + '"')) -PassThru
    $processCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id)
    $windowCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    do {
        if ($process.HasExited) { throw 'Application exited before the binary viewer appeared.' }
        try {
            $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $processCondition)
            foreach ($item in $windows) {
                if ($item.Current.Name.StartsWith('binary-fixture.mp4')) { $viewer = $item; break }
                # Owned forms can appear beneath their owner in the UIA tree.
                $owned = $item.FindAll([System.Windows.Automation.TreeScope]::Descendants, $windowCondition)
                foreach ($child in $owned) { if ($child.Current.ProcessId -eq $process.Id -and $child.Current.Name.StartsWith('binary-fixture.mp4')) { $viewer = $child; break } }
                if ($null -ne $viewer) { break }
            }
        } catch [System.Windows.Automation.ElementNotAvailableException] { }
        if ($null -eq $viewer) { Start-Sleep -Milliseconds 200 }
    } while ($null -eq $viewer -and [DateTime]::UtcNow -lt $deadline)
    if ($null -eq $viewer) {
        foreach ($item in $windows) { Write-Output ('Application window: ' + $item.Current.Name) }
        $errorLog = Join-Path $data 'errors.log'
        if (Test-Path -LiteralPath $errorLog) { Write-Output ('Application errors: ' + ([IO.File]::ReadAllText($errorLog).Replace($root, '[fixture]'))) }
        throw 'Binary viewer was not shown.'
    }
    function Find-Control([string] $Id) {
        $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, $Id)
        return $viewer.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
    }
    function Wait-Content([string] $Expected) {
        $until = [DateTime]::UtcNow.AddSeconds(45)
        do {
            if ($process.HasExited) { throw 'Application exited while viewing the binary file.' }
            try {
                $item = Find-Control 'BinaryContent'
                if ($null -ne $item) {
                    $pattern = $item.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                    if ($pattern.Current.Value.StartsWith($Expected)) {
                        if (-not $pattern.Current.IsReadOnly) { throw 'Binary content must be read-only.' }
                        return
                    }
                }
            } catch [System.Windows.Automation.ElementNotAvailableException] { }
            Start-Sleep -Milliseconds 200
        } while ([DateTime]::UtcNow -lt $until)
        throw "Expected binary content did not appear: $Expected"
    }
    function Click-Control([string] $Id) {
        $until = [DateTime]::UtcNow.AddSeconds(15)
        do {
            $item = Find-Control $Id
            if ($null -ne $item -and $item.Current.IsEnabled) { break }
            Start-Sleep -Milliseconds 100
        } while ([DateTime]::UtcNow -lt $until)
        if ($null -eq $item -or -not $item.Current.IsEnabled) { throw "Navigation control not available: $Id" }
        $pattern = $item.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $pattern.Invoke()
    }
    Wait-Content '00000000  00 00 00 18 66 74 79 70'
    if ($null -ne (Find-Control 'BinaryPage')) { throw 'A paging control is still present.' }
    $scrollbar = Find-Control 'BinaryScroll'
    if ($null -eq $scrollbar) { throw 'Whole-file scrollbar not found.' }
    $range = $scrollbar.GetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern)
    $range.SetValue([Math]::Round($range.Current.Maximum / 2))
    $until = [DateTime]::UtcNow.AddSeconds(30)
    $scrolled = $false
    do {
        $content = Find-Control 'BinaryContent'
        $text = $content.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
        $match = [regex]::Match($text, '\A([0-9A-F]+)  ')
        if ($match.Success -and [Convert]::ToInt64($match.Groups[1].Value, 16) -ge 65536) { $scrolled = $true; break }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $until)
    if (-not $scrolled) { throw 'The scrollbar did not navigate beyond 64 KiB.' }
    Click-Control 'BinaryFirst'
    Wait-Content '00000000  00 00 00 18 66 74 79 70'
    $search = Find-Control 'BinarySearchText'
    if ($null -eq $search) { throw 'Whole-file search input not found.' }
    $search.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue('SEARCH-MARK')
    Click-Control 'BinarySearchNext'
    Wait-Content '00010020  53 45 41 52 43 48 2D 4D 41 52 4B'
    Click-Control 'BinarySearchNext'
    Wait-Content '00020010  53 45 41 52 43 48 2D 4D 41 52 4B'
    Click-Control 'BinarySearchPrevious'
    Wait-Content '00010020  53 45 41 52 43 48 2D 4D 41 52 4B'
    $input = Find-Control 'BinaryOffset'
    if ($null -eq $input) { throw 'Offset input not found.' }
    $valuePattern = $input.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    $valuePattern.SetValue('0x10000')
    Click-Control 'BinaryGoOffset'
    Wait-Content '00010000  12 34 56 78'
    Write-Output 'PASS: the scrollbar, whole-file search in both directions, and offset navigation reached beyond 64 KiB.'
    # The owned viewer can appear before the editor's WebView has completed
    # bootstrap. Wait for its trace before sending the normal close request.
    $until = [DateTime]::UtcNow.AddSeconds(90)
    $editorReady = $false
    do {
        foreach ($traceFile in @(Get-ChildItem -LiteralPath $data -Filter 'startup-trace-*.json' -File)) {
            try {
                $trace = [IO.File]::ReadAllText($traceFile.FullName) | ConvertFrom-Json
                if ($null -ne $trace.elapsedFromMainMs.EditorRendered) { $editorReady = $true; break }
            } catch [IO.IOException] { }
        }
        if (-not $editorReady) { Start-Sleep -Milliseconds 200 }
    } while (-not $editorReady -and [DateTime]::UtcNow -lt $until)
    if (-not $editorReady) { throw 'Owner editor did not finish starting.' }
    $closePattern = $viewer.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
    $closePattern.Close()
    $until = [DateTime]::UtcNow.AddSeconds(15)
    $ownerWindow = $null
    do {
        $process.Refresh()
        if ($process.HasExited) { throw 'Application exited after closing binary viewer.' }
        $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $processCondition)
        foreach ($item in $windows) {
            if ($item.Current.Name.EndsWith('MD-CSV Split Editor')) { $ownerWindow = $item; break }
        }
        if ($null -ne $ownerWindow) { break }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $until)
    if ($null -eq $ownerWindow) { throw 'Owner editor window was not found.' }
    # Use the same normal close method and timeout as the other WebView2 smoke
    # tests. UI Automation WindowPattern.Close did not deliver a close request
    # to the editor reliably on the hosted runner after closing its owned form.
    $process.Refresh()
    if (-not $process.CloseMainWindow()) { throw 'Could not request a normal editor close.' }
    if (-not $process.WaitForExit(45000) -or $process.ExitCode -ne 0) {
        $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $processCondition)
        foreach ($item in $windows) {
            Write-Output ('Remaining application window: ' + $item.Current.Name)
            $texts = $item.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
            $reported = 0
            foreach ($child in $texts) {
                if ($child.Current.Name -and -not $child.Current.IsOffscreen) {
                    $label = [string]$child.Current.Name
                    if ($label.Length -gt 150) { $label = $label.Substring(0, 150) }
                    Write-Output ('Visible control: ' + $label)
                    $reported++
                    if ($reported -ge 80) { break }
                }
            }
        }
        $errorLog = Join-Path $data 'errors.log'
        if (Test-Path -LiteralPath $errorLog) { Write-Output ('Application errors: ' + ([IO.File]::ReadAllText($errorLog).Replace($root, '[fixture]'))) }
        foreach ($traceFile in @(Get-ChildItem -LiteralPath $data -Filter 'startup-trace-*.json' -File)) {
            try {
                $trace = [IO.File]::ReadAllText($traceFile.FullName) | ConvertFrom-Json
                Write-Output ('Close stages: ' + (($trace.elapsedFromMainMs.PSObject.Properties.Name | Where-Object { $_ -like 'Close*' -or $_ -eq 'WindowClosed' }) -join ','))
            } catch [IO.IOException] { }
        }
        throw 'Editor did not close normally.'
    }
    if ((Get-FileHash -LiteralPath $fixture -Algorithm SHA256).Hash -ne $before) { throw 'Read-only viewer modified the binary fixture.' }
    Write-Output 'PASS: whole-file search and offset navigation are read-only, and the editor closes normally.'
    $verified = $true
} finally {
    if ($process -and -not $process.HasExited) {
        try { $null = $process.CloseMainWindow() } catch { }
        if (-not $process.WaitForExit(3000)) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue; $null = $process.WaitForExit(10000) }
    }
    if ($verified -and (Test-Path -LiteralPath $root)) {
        $until = [DateTime]::UtcNow.AddSeconds(30)
        while ((Test-Path -LiteralPath $root) -and [DateTime]::UtcNow -lt $until) {
            try { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction Stop } catch { Start-Sleep -Milliseconds 500 }
        }
    }
}

