param(
    [Parameter(Mandatory=$true)][string]$NormalPayload,
    [Parameter(Mandatory=$true)][string]$ReadyToRunPayload,
    [Parameter(Mandatory=$true)][string]$Runtime,
    [Parameter(Mandatory=$true)][string]$ReportPath,
    [ValidateRange(3,10)][int]$Samples = 5
)
$ErrorActionPreference = 'Stop'
# Never run this benchmark against a user's machine or installation.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:OS -ne 'Windows_NT' -or -not $env:RUNNER_TEMP) { throw 'An isolated GitHub-hosted Windows runner is required.' }
if ((Get-Process -Name 'MD-Split' -ErrorAction SilentlyContinue) -or (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'MD Split')) -or (Test-Path -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MD Split')) { throw 'Existing application or installation found; refusing the benchmark.' }
$payloads = @{
    normal = (Resolve-Path -LiteralPath $NormalPayload).Path
    r2r = (Resolve-Path -LiteralPath $ReadyToRunPayload).Path
}
$runtimePath = (Resolve-Path -LiteralPath $Runtime).Path
foreach ($payload in @($payloads.normal, $payloads.r2r)) {
    if (-not (Test-Path -LiteralPath (Join-Path $payload 'MD-Split.exe') -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $payload 'wwwroot/index.html') -PathType Leaf)) { throw 'A complete published payload is required.' }
    if ((Test-Path -LiteralPath (Join-Path $payload 'Data')) -or (Test-Path -LiteralPath (Join-Path $payload 'WebView2Runtime'))) { throw 'Payload must not contain a profile or runtime.' }
}
if (-not (Test-Path -LiteralPath (Join-Path $runtimePath 'msedgewebview2.exe') -PathType Leaf)) { throw 'A complete fixed WebView2 runtime is required.' }

$root = Join-Path $env:RUNNER_TEMP ('mdsplit-native-compare-' + [Guid]::NewGuid().ToString('N'))
$app = Join-Path $root 'Application'
$data = Join-Path $app 'Data'
$report = [IO.Path]::GetFullPath($ReportPath)
$process = $null
$completed = $false
[void][IO.Directory]::CreateDirectory($root)
try {
    # Determine exactly which published bytes differ. Keep runtime and profile in
    # one fixed location, and replace only build differences after clean shutdown.
    $inventories = @{}
    foreach ($variant in @('normal','r2r')) {
        $base = $payloads[$variant]
        $map = @{}
        foreach ($file in @(Get-ChildItem -LiteralPath $base -File -Recurse)) {
            $relative = [IO.Path]::GetRelativePath($base, $file.FullName)
            $map[$relative] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        }
        $inventories[$variant] = $map
    }
    $different = @((@($inventories.normal.Keys) + @($inventories.r2r.Keys)) | Sort-Object -Unique | Where-Object {
        -not $inventories.normal.ContainsKey($_) -or -not $inventories.r2r.ContainsKey($_) -or $inventories.normal[$_] -ne $inventories.r2r[$_]
    })
    if ($different.Count -eq 0) { throw 'The two published payloads are identical; no comparison is possible.' }
    if (@($different | Where-Object { $_ -match '^wwwroot[\\/]' }).Count -gt 0) { throw 'The web assets differ between variants.' }

    Copy-Item -LiteralPath $payloads.normal -Destination $app -Recurse
    Copy-Item -LiteralPath $runtimePath -Destination (Join-Path $app 'WebView2Runtime') -Recurse
    foreach ($sid in @('*S-1-15-2-2:(OI)(CI)(RX)', '*S-1-15-2-1:(OI)(CI)(RX)')) {
        & (Join-Path $env:WINDIR 'System32/icacls.exe') (Join-Path $app 'WebView2Runtime') /grant $sid /T /Q | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not grant runtime read access.' }
    }
    [void][IO.Directory]::CreateDirectory($data)
    [IO.File]::WriteAllText((Join-Path $data 'settings.json'), '{"welcomeShown":true,"updateCheckDays":-1,"sessionPolicy":"clear","openPolicy":"tabs"}', [Text.UTF8Encoding]::new($false))

    $active = 'normal'
    function Select-Variant([string]$Variant) {
        if ($script:active -eq $Variant) { return }
        if (Get-Process -Name 'MD-Split' -ErrorAction SilentlyContinue) { throw 'Editor is still running before variant switch.' }
        foreach ($relative in $different) {
            $source = Join-Path $payloads[$Variant] $relative
            $destination = Join-Path $app $relative
            if (Test-Path -LiteralPath $source -PathType Leaf) {
                [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination))
                Copy-Item -LiteralPath $source -Destination $destination -Force
                if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $inventories[$Variant][$relative]) { throw 'Variant file copy did not match its published hash.' }
            } elseif (Test-Path -LiteralPath $destination -PathType Leaf) { Remove-Item -LiteralPath $destination -Force }
        }
        $script:active = $Variant
    }
    function Wait-WebViewExit {
        $prefix = (Join-Path $app 'WebView2Runtime') + [IO.Path]::DirectorySeparatorChar
        $deadline = [DateTime]::UtcNow.AddSeconds(45)
        do {
            $remaining = @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { -not $_.ExecutablePath -or $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) })
            if ($remaining.Count -eq 0) { return }
            Start-Sleep -Milliseconds 200
        } while ([DateTime]::UtcNow -lt $deadline)
        throw 'Fixed WebView2 runtime did not exit after closing the editor.'
    }
    function Measure-One([string]$Variant, [string]$Format, [string]$File, [bool]$Warmup, [int]$Round) {
        if (Get-Process -Name 'MD-Split' -ErrorAction SilentlyContinue) { throw 'Editor was not fully stopped before measurement.' }
        Select-Variant $Variant
        # The root is unique to this disposable hosted-runner test.
        Get-ChildItem -LiteralPath $data -Filter 'startup-trace-*.json' -File | Remove-Item -Force
        $clock = [Diagnostics.Stopwatch]::StartNew()
        $script:process = Start-Process -FilePath (Join-Path $app 'MD-Split.exe') -ArgumentList @('--startup-trace', ('"' + $File + '"')) -PassThru
        $deadline = [DateTime]::UtcNow.AddSeconds(90)
        $trace = $null
        $observed = $null
        do {
            $process.Refresh()
            if ($process.HasExited) { throw 'Editor exited before the trace was written.' }
            $traces = @(Get-ChildItem -LiteralPath $data -Filter 'startup-trace-*.json' -File)
            if ($traces.Count -gt 1) { throw 'Expected exactly one trace for the new process.' }
            if ($traces.Count -eq 1) {
                try {
                    $candidate = [IO.File]::ReadAllText($traces[0].FullName) | ConvertFrom-Json
                    if ($null -ne $candidate.elapsedFromMainMs.EditorRendered) { $trace = $candidate; $observed = [Math]::Round($clock.Elapsed.TotalMilliseconds,2); break }
                } catch [IO.IOException] { }
            }
            Start-Sleep -Milliseconds 50
        } while ([DateTime]::UtcNow -lt $deadline)
        if (-not $trace) { throw 'Editor did not render within the timeout.' }
        if ($trace.schemaVersion -ne 1 -or $trace.windowScope -ne 'first-created' -or $null -eq $trace.processToMainMs -or $trace.processToMainMs -lt 0 -or $trace.elapsedFromMainMs.PSObject.Properties['SecondaryInstance'] -or $trace.elapsedFromMainMs.PSObject.Properties['RestoredWindowPresent'] -or -not $trace.elapsedFromMainMs.PSObject.Properties['SingleCommandFile'] -or -not $trace.elapsedFromMainMs.PSObject.Properties['CommandFileInTracedWindow']) { throw 'Trace does not describe the requested cold-process single-file window.' }
        foreach ($stage in @('MainEntry','FileReadStart','FileReadComplete','WindowCreated','WindowShown','WebEnvironmentStart','WebEnvironmentReady','WebControllerReady','NavigationStart','BootstrapReady','EditorRendered')) {
            $entry = $trace.elapsedFromMainMs.PSObject.Properties[$stage]
            if (-not $entry -or $entry.Value -isnot [ValueType] -or [double]::IsNaN([double]$entry.Value) -or [double]::IsInfinity([double]$entry.Value) -or $entry.Value -lt 0) { throw "Invalid or missing trace stage: $stage" }
        }
        # Rendered is a two-frame signal, not proof of actual input latency.
        # Verify the visible native window and responsiveness separately.
        $responsive = $false
        $uiDeadline = [DateTime]::UtcNow.AddSeconds(10)
        do {
            $process.Refresh()
            if ($process.HasExited) { throw 'Editor exited after rendering.' }
            if ($process.MainWindowHandle -ne [IntPtr]::Zero -and $process.MainWindowTitle.Contains([IO.Path]::GetFileName($File)) -and $process.Responding) { $responsive = $true; break }
            Start-Sleep -Milliseconds 100
        } while ([DateTime]::UtcNow -lt $uiDeadline)
        if (-not $responsive) { throw 'Editor window was absent, unresponsive or did not display the requested file.' }
        $result = [ordered]@{ variant=$Variant; format=$Format; warmup=$Warmup; round=$Round; processToMainMs=$trace.processToMainMs; editorRenderedFromMainMs=$trace.elapsedFromMainMs.EditorRendered; estimatedProcessToRenderedMs=[Math]::Round($trace.processToMainMs + $trace.elapsedFromMainMs.EditorRendered,2); observedLaunchToTraceMs=$observed; stages=$trace.elapsedFromMainMs }
        Write-Host ('STARTUP_SAMPLE ' + ($result | ConvertTo-Json -Depth 8 -Compress))
        if (-not $process.CloseMainWindow() -or -not $process.WaitForExit(45000) -or $process.ExitCode -ne 0) { throw 'Editor did not close normally.' }
        $script:process = $null
        if (Get-Process -Name 'MD-Split' -ErrorAction SilentlyContinue) { throw 'Editor process remains after close.' }
        Wait-WebViewExit
        return $result
    }

    $results = [Collections.Generic.List[object]]::new()
    foreach ($format in @('txt','log','py','md')) {
        $file = Join-Path $root ("startup.$format")
        [IO.File]::WriteAllText($file, "Example startup document`r`nSecond line`r`n", [Text.UTF8Encoding]::new($false))
        # One excluded warmup per variant and format; alternate order each round.
        for ($round = 0; $round -le $Samples; $round++) {
            $order = if ($round % 2 -eq 0) { @('normal','r2r') } else { @('r2r','normal') }
            foreach ($variant in $order) {
                $entry = Measure-One $variant $format $file ($round -eq 0) $round
                $results.Add($entry)
            }
        }
    }
    $summaries = foreach ($format in @('txt','log','py','md')) {
        foreach ($variant in @('normal','r2r')) {
            $values = @($results | Where-Object { $_.format -eq $format -and $_.variant -eq $variant -and -not $_.warmup } | ForEach-Object { $_.estimatedProcessToRenderedMs } | Sort-Object)
            if ($values.Count -ne $Samples) { throw 'Incorrect number of benchmark samples.' }
            $middle = [int][Math]::Floor($values.Count / 2)
            $median = if ($values.Count % 2 -eq 1) { $values[$middle] } else { ($values[$middle - 1] + $values[$middle]) / 2 }
            [ordered]@{ format=$format; variant=$variant; medianMs=[Math]::Round($median,2); samplesMs=$values }
        }
    }
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($report))
    [IO.File]::WriteAllText($report, ([ordered]@{ schemaVersion=1; measurement='processToMainMs + EditorRendered'; processToMainIsWallClockEstimate=$true; launchToTraceIncludesPollingAndTraceWrite=$true; inputReadinessNotMeasured=$true; warmupRunsPerVariantAndFormat=1; samplesPerVariantAndFormat=$Samples; order='alternating'; summaries=@($summaries); results=$results.ToArray() } | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
    foreach ($summary in $summaries) { Write-Output ('STARTUP_SUMMARY ' + ($summary | ConvertTo-Json -Compress)) }
    $completed = $true
} finally {
    if ($process -and -not $process.HasExited) { try { $null = $process.CloseMainWindow() } catch { }; if (-not $process.WaitForExit(3000)) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue; $null = $process.WaitForExit(10000) } }
    if ($completed -and (Test-Path -LiteralPath $root)) {
        $deadline = [DateTime]::UtcNow.AddSeconds(45)
        do { try { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction Stop } catch { Start-Sleep -Milliseconds 500 } } while ((Test-Path -LiteralPath $root) -and [DateTime]::UtcNow -lt $deadline)
    }
}
