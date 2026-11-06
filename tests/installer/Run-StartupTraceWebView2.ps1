param([Parameter(Mandatory=$true)][string]$Payload)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:OS -ne 'Windows_NT' -or -not $env:RUNNER_TEMP) { throw 'An isolated GitHub-hosted Windows runner is required.' }
if ((Get-Process -Name 'MD-Split' -ErrorAction SilentlyContinue) -or (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'MD Split'))) { throw 'Existing application or data found; refusing the test.' }
$payloadPath = (Resolve-Path -LiteralPath $Payload).Path
if (-not (Test-Path -LiteralPath (Join-Path $payloadPath 'MD-Split.exe') -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $payloadPath 'WebView2Runtime\msedgewebview2.exe') -PathType Leaf)) { throw 'A complete fixed-runtime Windows payload is required.' }
$root = Join-Path $env:RUNNER_TEMP ('mdsplit-trace-' + [Guid]::NewGuid().ToString('N'))
$app = Join-Path $root 'Application'
$process = $null
$verified = $false
[void][IO.Directory]::CreateDirectory($root)
try {
    Copy-Item -LiteralPath $payloadPath -Destination $app -Recurse
    foreach ($sid in @('*S-1-15-2-2:(OI)(CI)(RX)', '*S-1-15-2-1:(OI)(CI)(RX)')) {
        & (Join-Path $env:WINDIR 'System32\icacls.exe') (Join-Path $app 'WebView2Runtime') /grant $sid /T /Q | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not grant runtime read access.' }
    }
    $data = Join-Path $app 'Data'; [void][IO.Directory]::CreateDirectory($data)
    [IO.File]::WriteAllText((Join-Path $data 'settings.json'), '{"welcomeShown":true,"updateCheckDays":-1,"sessionPolicy":"clear","openPolicy":"tabs"}', [Text.UTF8Encoding]::new($false))
    $file = Join-Path $root 'private-startup-fixture.txt'
    $content = 'PRIVATE STARTUP DOCUMENT CONTENT'
    [IO.File]::WriteAllText($file, $content, [Text.UTF8Encoding]::new($false))
    function Start-Editor([bool]$Trace, [string]$Path = $file) {
        $argsForApp = @(); if ($Trace) { $argsForApp += '--startup-trace' }; $argsForApp += ('"' + $Path + '"')
        return Start-Process -FilePath (Join-Path $app 'MD-Split.exe') -ArgumentList $argsForApp -PassThru
    }
    function Wait-Title {
        $deadline = [DateTime]::UtcNow.AddSeconds(90)
        do {
            $process.Refresh()
            if ($process.HasExited) { throw 'Editor exited before the file was shown.' }
            if ($process.MainWindowTitle.Contains([IO.Path]::GetFileName($file))) { return }
            Start-Sleep -Milliseconds 100
        } while ([DateTime]::UtcNow -lt $deadline)
        throw 'The test file was not shown.'
    }
    function Close-Editor {
        if (-not $process.CloseMainWindow() -or -not $process.WaitForExit(45000) -or $process.ExitCode -ne 0) { throw 'Editor did not close normally.' }
    }
    function Assert-WindowTrace($Trace) {
        $stages = @('WindowCreated','WindowIconStart','WindowIconComplete','WindowControlsAddStart','WindowControlsAddComplete','WindowConstructorComplete','WindowShowStart','WindowShowComplete')
        $previous = 0.0
        foreach ($stage in $stages) {
            $prop = $Trace.elapsedFromMainMs.PSObject.Properties[$stage]
            if ($null -eq $prop -or $prop.Value -isnot [ValueType] -or [double]::IsNaN([double]$prop.Value) -or [double]::IsInfinity([double]$prop.Value) -or $prop.Value -lt $previous) { throw "Missing, invalid, or out-of-order window stage: $stage" }
            $previous = [double]$prop.Value
        }
        $shown = $Trace.elapsedFromMainMs.PSObject.Properties['WindowShown']
        $rendered = $Trace.elapsedFromMainMs.PSObject.Properties['EditorRendered']
        if ($null -eq $shown -or $null -eq $rendered -or $shown.Value -lt $Trace.elapsedFromMainMs.WindowShowStart -or $rendered.Value -lt $shown.Value -or $rendered.Value -lt $previous) { throw 'Window show and render timing is out of order.' }
    }
    $process = Start-Editor $false
    Wait-Title; Close-Editor
    if (@(Get-ChildItem -LiteralPath $data -Filter 'startup-trace-*.json' -File).Count -ne 0) { throw 'Ordinary startup unexpectedly produced a trace.' }
    $process = Start-Editor $true
    $deadline = [DateTime]::UtcNow.AddSeconds(90); $traceFile = $null
    do {
        $process.Refresh(); if ($process.HasExited) { throw 'Editor exited before the trace was written.' }
        $candidates = @(Get-ChildItem -LiteralPath $data -Filter 'startup-trace-*.json' -File)
        if ($candidates.Count -gt 1) { throw 'Expected one trace per launch.' }
        if ($candidates.Count -eq 1) {
            try {
                $text = [IO.File]::ReadAllText($candidates[0].FullName)
                $trace = $text | ConvertFrom-Json
                if ($null -ne $trace.elapsedFromMainMs.EditorRendered) { $traceFile = $candidates[0]; break }
            } catch [IO.IOException] { }
        }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    if (-not $traceFile) { throw 'Editor-rendered startup trace was not written.' }
    $required = @('MainEntry','StorageReady','ContextStart','SessionsScanned','RecoveriesScanned','SessionsRestored','SingleCommandFile','FileReadStart','FileReadComplete','WindowCreated','CommandFileInTracedWindow','WindowShown','WebEnvironmentStart','WebEnvironmentReady','WebControllerReady','NavigationStart','BootstrapStart','BootstrapReady','EditorRendered')
    if ($trace.schemaVersion -ne 1 -or $trace.windowScope -ne 'first-created') { throw 'Unexpected startup trace schema or window scope.' }
    foreach ($stage in $required) {
        $prop = $trace.elapsedFromMainMs.PSObject.Properties[$stage]
        if ($null -eq $prop -or $prop.Value -isnot [ValueType] -or [double]::IsNaN([double]$prop.Value) -or [double]::IsInfinity([double]$prop.Value) -or $prop.Value -lt 0) { throw "Missing or invalid startup stage: $stage" }
    }
    Assert-WindowTrace $trace
    if ($text.Contains($root) -or $text.Contains($root.Replace('\','\\')) -or $text.Contains([IO.Path]::GetFileName($file)) -or $text.Contains($content)) { throw 'Trace exposed a local path, filename or document content.' }
    # Even if a command file is routed to the traced window, a restored window
    # can initially render another active tab. This isolated fixture starts
    # without recovery or session windows; other traces must report that scope.
    if ($trace.elapsedFromMainMs.PSObject.Properties['RestoredWindowPresent'] -or $trace.elapsedFromMainMs.PSObject.Properties['CommandFileInOtherWindow']) { throw 'Unexpected restored or other window in isolated fixture.' }
    if ($trace.elapsedFromMainMs.PSObject.Properties['FirstInput']) { throw 'Trace falsely reported user input.' }
    Close-Editor
    Write-Output 'PASS: ordinary startup writes no trace; opt-in startup records rendered milestones without document content or paths.'

    # Seed a saved session only after the editor has rendered, so a normal
    # close can capture its state. The fixture contains no personal data.
    [IO.File]::WriteAllText((Join-Path $data 'settings.json'), '{"welcomeShown":true,"updateCheckDays":-1,"sessionPolicy":"all","openPolicy":"tabs"}', [Text.UTF8Encoding]::new($false))
    $knownTraces = @($traceFile.Name)
    $process = Start-Editor $true
    $deadline = [DateTime]::UtcNow.AddSeconds(90); $seedTrace = $null
    do {
        $process.Refresh(); if ($process.HasExited) { throw 'Editor exited before the session fixture was ready.' }
        $candidates = @(Get-ChildItem -LiteralPath $data -Filter 'startup-trace-*.json' -File | Where-Object { $knownTraces -notcontains $_.Name })
        if ($candidates.Count -gt 1) { throw 'Expected one trace for session seeding.' }
        if ($candidates.Count -eq 1) {
            try {
                $seed = [IO.File]::ReadAllText($candidates[0].FullName) | ConvertFrom-Json
                if ($null -ne $seed.elapsedFromMainMs.EditorRendered) { $seedTrace = $candidates[0]; break }
            } catch [IO.IOException] { }
        }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    if (-not $seedTrace) { throw 'Session fixture did not render.' }
    Close-Editor

    $secondFile = Join-Path $root 'different-startup-fixture.txt'
    $secondContent = 'SECOND PRIVATE DOCUMENT CONTENT'
    [IO.File]::WriteAllText($secondFile, $secondContent, [Text.UTF8Encoding]::new($false))
    $knownTraces += $seedTrace.Name
    $process = Start-Editor $true $secondFile
    $deadline = [DateTime]::UtcNow.AddSeconds(90); $restoredTrace = $null
    do {
        $process.Refresh(); if ($process.HasExited) { throw 'Editor exited before the restored session was ready.' }
        $candidates = @(Get-ChildItem -LiteralPath $data -Filter 'startup-trace-*.json' -File | Where-Object { $knownTraces -notcontains $_.Name })
        if ($candidates.Count -gt 1) { throw 'Expected one trace for restored session.' }
        if ($candidates.Count -eq 1) {
            try {
                $restoredText = [IO.File]::ReadAllText($candidates[0].FullName)
                $restored = $restoredText | ConvertFrom-Json
                if ($null -ne $restored.elapsedFromMainMs.EditorRendered) { $restoredTrace = $candidates[0]; break }
            } catch [IO.IOException] { }
        }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    if (-not $restoredTrace) { throw 'Restored session did not render.' }
    if ($restored.windowScope -ne 'first-created' -or -not $restored.elapsedFromMainMs.PSObject.Properties['SingleCommandFile'] -or -not $restored.elapsedFromMainMs.PSObject.Properties['RestoredWindowPresent'] -or -not $restored.elapsedFromMainMs.PSObject.Properties['CommandFileInTracedWindow'] -or $restored.elapsedFromMainMs.PSObject.Properties['CommandFileInOtherWindow']) { throw 'Restored-session scope was not recorded correctly.' }
    Assert-WindowTrace $restored
    if ($restoredText.Contains($root) -or $restoredText.Contains($root.Replace('\','\\')) -or $restoredText.Contains([IO.Path]::GetFileName($file)) -or $restoredText.Contains([IO.Path]::GetFileName($secondFile)) -or $restoredText.Contains($content) -or $restoredText.Contains($secondContent)) { throw 'Restored trace exposed a path, filename or document content.' }
    # A restored window may render a different active tab even when the new
    # command file is in that window. EditorRendered is not target-file proof.
    Close-Editor
    Write-Output 'PASS: restored-session scope is recorded without identifying files; render timing does not claim target-file readiness.'
    $verified = $true
} finally {
    if ($process -and -not $process.HasExited) { try { $null = $process.CloseMainWindow() } catch { }; if (-not $process.WaitForExit(3000)) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } }
    if ($verified -and (Test-Path -LiteralPath $root)) {
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        do { try { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction Stop } catch { Start-Sleep -Milliseconds 500 } } while ((Test-Path -LiteralPath $root) -and [DateTime]::UtcNow -lt $deadline)
    }
}
