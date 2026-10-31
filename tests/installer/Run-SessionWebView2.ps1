param([Parameter(Mandatory = $true)][string] $Payload)
$ErrorActionPreference = 'Stop'
# Desktop UI automation and application data are restricted to disposable runners.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:OS -ne 'Windows_NT' -or -not $env:RUNNER_TEMP) { throw 'An isolated GitHub-hosted Windows runner is required.' }
if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne [Threading.ApartmentState]::STA) { throw 'This test requires Windows PowerShell STA.' }
if ((Get-Process -Name 'MD-Split' -ErrorAction SilentlyContinue) -or (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'MD Split'))) { throw 'Existing application or data found; refusing the test.' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
$payloadPath = (Resolve-Path -LiteralPath $Payload).Path
if (-not (Test-Path -LiteralPath (Join-Path $payloadPath 'MD-Split.exe') -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $payloadPath 'WebView2Runtime\msedgewebview2.exe') -PathType Leaf)) { throw 'A complete fixed-runtime Windows payload is required.' }
$testRoot = Join-Path $env:RUNNER_TEMP ('mdsplit-session-' + [Guid]::NewGuid().ToString('N'))
$application = Join-Path $testRoot 'Application'
[void][IO.Directory]::CreateDirectory($testRoot)
$process = $null
$verified = $false
try {
    Copy-Item -LiteralPath $payloadPath -Destination $application -Recurse
    foreach ($sid in @('*S-1-15-2-2:(OI)(CI)(RX)', '*S-1-15-2-1:(OI)(CI)(RX)')) {
        & (Join-Path $env:WINDIR 'System32\icacls.exe') (Join-Path $application 'WebView2Runtime') /grant $sid /T /Q | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not grant temporary runtime read access.' }
    }
    $data = Join-Path $application 'Data'
    $sessions = Join-Path $data 'Sessions'
    [void][IO.Directory]::CreateDirectory($data)
    $a = Join-Path $testRoot 'first.md'; $b = Join-Path $testRoot 'second.csv'
    [IO.File]::WriteAllText($a, '# First', [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($b, "A,B`r`nx,y`r`n", [Text.UTF8Encoding]::new($false))
    function Set-TestSettings([string] $Policy) {
        $settings = @{welcomeShown=$true;updateCheckDays=-1;sessionPolicy=$Policy;startupFormat='csv';openPolicy='tabs'} | ConvertTo-Json -Compress
        [IO.File]::WriteAllText((Join-Path $data 'settings.json'), $settings, [Text.UTF8Encoding]::new($false))
    }
    function Start-Editor([bool] $WithFixtures) {
        $exe = Join-Path $application 'MD-Split.exe'
        if ($WithFixtures) { return Start-Process -FilePath $exe -ArgumentList @('"' + $a + '"','"' + $b + '"') -PassThru }
        return Start-Process -FilePath $exe -PassThru
    }
    function Wait-Tab([string] $Name) {
        $until = [DateTime]::UtcNow.AddSeconds(90)
        do {
            if ($process.HasExited) { throw 'Application exited before expected tab was shown.' }
            try {
                $pc = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id)
                $window = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $pc)
                if ($null -ne $window) {
                    $nc = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $Name)
                    $item = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $nc)
                    if ($null -ne $item -and -not $item.Current.IsOffscreen) { return }
                }
            } catch [System.Windows.Automation.ElementNotAvailableException] { }
            Start-Sleep -Milliseconds 250
        } while ([DateTime]::UtcNow -lt $until)
        throw "Expected tab was not exposed: $Name"
    }
    function Close-Editor {
        if ($process.HasExited) { throw 'Application unexpectedly exited before close.' }
        if (-not $process.CloseMainWindow()) { throw 'Could not request a normal window close.' }
        if (-not $process.WaitForExit(45000)) { throw 'Application did not finish normal close.' }
        if ($process.ExitCode -ne 0) { throw 'Application exited with an error.' }
    }
    function Read-SavedSession {
        $files = @(Get-ChildItem -LiteralPath $sessions -Filter '*.json' -File)
        if ($files.Count -ne 1) { throw "Expected one session file, found $($files.Count)." }
        return (Get-Content -LiteralPath $files[0].FullName -Raw | ConvertFrom-Json)
    }
    Set-TestSettings 'all'
    $process = Start-Editor $true
    Wait-Tab 'first.md'; Wait-Tab 'second.csv'; Close-Editor
    $saved = Read-SavedSession
    if (@($saved.documents).Count -ne 2 -or @($saved.documents.path) -notcontains $a -or @($saved.documents.path) -notcontains $b) { throw 'All-tabs exit did not save both fixture paths.' }
    $savedAllJson = $saved | ConvertTo-Json -Depth 10 -Compress
    $process = Start-Editor $false
    Wait-Tab 'first.md'; Wait-Tab 'second.csv'; Close-Editor
    $saved = Read-SavedSession
    if (@($saved.documents).Count -ne 2) { throw 'All-tabs session did not survive restart.' }
    Write-Output 'PASS: saved tabs reopened after a real WebView2 shutdown and restart.'

    Set-TestSettings 'active'
    $process = Start-Editor $false
    Wait-Tab 'first.md'; Wait-Tab 'second.csv'; Close-Editor
    $saved = Read-SavedSession
    if (@($saved.documents).Count -ne 1 -or $saved.documents[0].id -ne $saved.activeId) { throw 'Active-only exit did not preserve exactly the active tab.' }
    $onlyName = $saved.documents[0].name
    $process = Start-Editor $false
    Wait-Tab $onlyName; Close-Editor
    Write-Output 'PASS: active-only session reopened exactly one saved tab.'

    Set-TestSettings 'clear'
    $process = Start-Editor $false
    Wait-Tab $onlyName; Close-Editor
    $saved = Read-SavedSession
    if (@($saved.documents).Count -ne 0) { throw 'Clear exit unexpectedly retained tabs.' }
    $process = Start-Editor $false
    $untitledCsv = (-join @([char]0x7121,[char]0x984c)) + '.csv'
    Wait-Tab $untitledCsv; Close-Editor
    Write-Output 'PASS: clear exit opened a new CSV document on the next launch.'

    # Simulate a file removed while the application is closed. A native warning
    # should appear and the remaining file should still reopen.
    Set-TestSettings 'all'
    [IO.File]::WriteAllText((Join-Path $sessions ([Guid]::NewGuid().ToString('N') + '.json')), $savedAllJson, [Text.UTF8Encoding]::new($false))
    Remove-Item -LiteralPath $b
    $process = Start-Editor $false
    $warningSeen = $false; $deadline = [DateTime]::UtcNow.AddSeconds(90)
    do {
        if ($process.HasExited) { throw 'Application exited before missing-file warning.' }
        try {
            $pc = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id)
            $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $pc)
            foreach ($window in $windows) {
                $textCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text)
                $texts = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $textCond)
                foreach ($item in $texts) { if ($item.Current.Name -like '*second.csv*' -and -not $item.Current.IsOffscreen) { $warningSeen = $true } }
            }
        } catch [System.Windows.Automation.ElementNotAvailableException] { }
        if (-not $warningSeen) { Start-Sleep -Milliseconds 250 }
    } while (-not $warningSeen -and [DateTime]::UtcNow -lt $deadline)
    if (-not $warningSeen) { throw 'Missing-file warning was not displayed.' }
    [Windows.Forms.SendKeys]::SendWait('{ENTER}')
    Wait-Tab 'first.md'; Close-Editor
    $saved = Read-SavedSession
    if (@($saved.documents).Count -ne 1 -or $saved.documents[0].path -ne $a) { throw 'Remaining tab did not survive the missing-file warning.' }
    Write-Output 'PASS: a missing file warned and the remaining tab reopened.'
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
