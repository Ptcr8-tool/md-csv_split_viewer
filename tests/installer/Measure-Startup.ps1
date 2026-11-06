param([Parameter(Mandatory=$true)][string]$BaselineSetup, [Parameter(Mandatory=$true)][string]$CandidateWeb)
$ErrorActionPreference = 'Stop'
# This test installs and removes the product; never run it on a user's PC.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:OS -ne 'Windows_NT' -or -not $env:RUNNER_TEMP) { throw 'An isolated GitHub-hosted Windows runner is required.' }
if ((Get-Process -Name 'MD-Split' -ErrorAction SilentlyContinue) -or (Test-Path -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MD Split') -or (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'MD Split'))) { throw 'Existing installation or data found; refusing the benchmark.' }
$setup = (Resolve-Path -LiteralPath $BaselineSetup).Path
$candidate = (Resolve-Path -LiteralPath $CandidateWeb).Path
if (-not (Test-Path -LiteralPath (Join-Path $candidate 'index.html'))) { throw 'Candidate web bundle is missing.' }
$root = Join-Path $env:RUNNER_TEMP ('mdsplit-startup-' + [Guid]::NewGuid().ToString('N'))
$app = Join-Path $root 'Application'
$current = Join-Path $app 'wwwroot'
$before = Join-Path $app 'wwwroot-before'
$after = Join-Path $app 'wwwroot-after'
$process = $null
[void][IO.Directory]::CreateDirectory($root)
try {
    $installer = Start-Process -FilePath $setup -ArgumentList @('/S', "/D=$app") -PassThru
    if (-not $installer.WaitForExit(900000) -or $installer.ExitCode -ne 0) { throw 'Baseline installer failed.' }
    if (-not (Test-Path -LiteralPath (Join-Path $app 'MD-Split.exe'))) { throw 'Installed baseline missing.' }
    $data = Join-Path $app 'Data'; [void][IO.Directory]::CreateDirectory($data)
    [IO.File]::WriteAllText((Join-Path $data 'settings.json'), '{"welcomeShown":true,"updateCheckDays":-1,"sessionPolicy":"clear","openPolicy":"tabs"}', [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $current -Destination $before
    Copy-Item -LiteralPath $candidate -Destination $after -Recurse
    $active = $null
    function Select-Ui([string]$Variant) {
        if ($active -eq $Variant) { return }
        if ($active) { Move-Item -LiteralPath $current -Destination $(if ($active -eq 'before') { $before } else { $after }) }
        Move-Item -LiteralPath $(if ($Variant -eq 'before') { $before } else { $after }) -Destination $current
        $script:active = $Variant
    }
    function Measure-File([string]$File) {
        # The filename reaches the window title after the document is rendered.
        # This measures process launch to that signal, not a simulated keystroke.
        $clock = [Diagnostics.Stopwatch]::StartNew()
        $script:process = Start-Process -FilePath (Join-Path $app 'MD-Split.exe') -ArgumentList ('"' + $File + '"') -PassThru
        $name = [IO.Path]::GetFileName($File)
        do {
            $process.Refresh()
            if ($process.HasExited) { throw 'Application exited before showing the file.' }
            if ($process.MainWindowHandle -ne [IntPtr]::Zero -and $process.MainWindowTitle.Contains($name)) { break }
            Start-Sleep -Milliseconds 20
        } while ($clock.Elapsed.TotalSeconds -lt 60)
        if (-not $process.MainWindowTitle.Contains($name)) { throw "File title did not appear: $name" }
        $ms = [Math]::Round($clock.Elapsed.TotalMilliseconds)
        if (-not $process.CloseMainWindow() -or -not $process.WaitForExit(45000) -or $process.ExitCode -ne 0) { throw 'Application did not close cleanly.' }
        $script:process = $null
        return $ms
    }
    $measurements = @{}
    foreach ($ext in @('txt','log','py','md')) {
        $file = Join-Path $root ("startup.$ext")
        [IO.File]::WriteAllText($file, "Example startup document`r`nSecond line`r`n", [Text.UTF8Encoding]::new($false))
        $measurements[$ext] = @{before=@();after=@()}
        # Alternating variants share the same executable, runtime and profile.
        # The first run of each variant warms its assets; report the rest.
        for ($i=0; $i -lt 4; $i++) {
            $order = if ($i % 2 -eq 0) { @('before','after') } else { @('after','before') }
            foreach ($variant in $order) {
                Select-Ui $variant
                $elapsed = Measure-File $file
                if ($i -gt 0) { $measurements[$ext][$variant] += $elapsed }
                Write-Output "STARTUP_SAMPLE format=$ext variant=$variant warmup=$($i -eq 0) milliseconds=$elapsed"
            }
        }
        $old = @($measurements[$ext].before | Sort-Object); $new = @($measurements[$ext].after | Sort-Object)
        Write-Output "STARTUP_MEDIAN format=$ext before_ms=$($old[1]) after_ms=$($new[1])"
    }
} finally {
    if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue; $null=$process.WaitForExit(10000) }
    $uninstall = Join-Path $app 'Uninstall.exe'
    if (Test-Path -LiteralPath $uninstall) {
        $uninstaller = Start-Process -FilePath $uninstall -ArgumentList '/S' -PassThru
        if (-not $uninstaller.WaitForExit(180000)) { throw 'Benchmark uninstall timed out.' }
        # NSIS may hand off deletion to a temporary child process.
        $deadline = [DateTime]::UtcNow.AddMinutes(3)
        while ((Test-Path -LiteralPath $app) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Seconds 1 }
        if (Test-Path -LiteralPath $app) { throw 'Benchmark uninstall did not remove the application.' }
    }
}
