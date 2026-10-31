param([Parameter(Mandatory = $true)][string] $Payload)

$ErrorActionPreference = 'Stop'
# This test opens a real desktop window and uses the OS clipboard. Restrict it
# to disposable hosted runners; never touch a developer's clipboard or app.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:OS -ne 'Windows_NT' -or -not $env:RUNNER_TEMP) {
    throw 'The CSV clipboard test requires an isolated GitHub-hosted Windows runner.'
}
if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne [Threading.ApartmentState]::STA) {
    throw 'Run this check with Windows PowerShell in an STA thread.'
}
if ((Get-Process -Name 'MD-Split' -ErrorAction SilentlyContinue) -or
    (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'MD Split'))) {
    throw 'Existing MD Split processes or data were found; refusing the test.'
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CsvSmokeMouse {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
}
'@

$payloadPath = (Resolve-Path -LiteralPath $Payload).Path
$exePath = Join-Path $payloadPath 'MD-Split.exe'
$runtimePath = Join-Path $payloadPath 'WebView2Runtime\msedgewebview2.exe'
if (-not (Test-Path -LiteralPath $exePath -PathType Leaf) -or -not (Test-Path -LiteralPath $runtimePath -PathType Leaf)) {
    throw 'A complete Windows payload with the fixed WebView2 runtime is required.'
}
$testRoot = Join-Path $env:RUNNER_TEMP ('mdsplit-csv-clipboard-' + [Guid]::NewGuid().ToString('N'))
$application = Join-Path $testRoot 'Application'
if (Test-Path -LiteralPath $testRoot) { throw 'The isolated test path already exists.' }
[void][IO.Directory]::CreateDirectory($testRoot)
$process = $null
$verified = $false
try {
    Copy-Item -LiteralPath $payloadPath -Destination $application -Recurse
    $runtime = Join-Path $application 'WebView2Runtime'
    foreach ($sid in @('*S-1-15-2-2:(OI)(CI)(RX)', '*S-1-15-2-1:(OI)(CI)(RX)')) {
        & (Join-Path $env:WINDIR 'System32\icacls.exe') $runtime /grant $sid /T /Q | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not grant the temporary WebView runtime its required read access.' }
    }
    $data = Join-Path $application 'Data'
    [void][IO.Directory]::CreateDirectory($data)
    [IO.File]::WriteAllText((Join-Path $data 'settings.json'), '{"welcomeShown":true,"updateCheckDays":-1}', [Text.UTF8Encoding]::new($false))
    $csv = Join-Path $testRoot 'fixture.csv'
    # Physical CRLF row separators with two distinct in-cell newline styles.
    $lfRow = "`"lf`nvalue`",lfTarget`r`n"
    $crRow = "`"cr`rvalue`",crTarget`r`n"
    $original = "head1,head2`r`nsource,dest`r`nalpha,beta`r`n" + $lfRow + $crRow
    [IO.File]::WriteAllText($csv, $original, [Text.UTF8Encoding]::new($false))
    [Windows.Forms.Clipboard]::SetText('clipboard-sentinel')
    # The input path is generated under RUNNER_TEMP, without shell evaluation.
    $process = Start-Process -FilePath (Join-Path $application 'MD-Split.exe') -ArgumentList ('"' + $csv + '"') -PassThru

    function Get-AppWindow([int] $ProcessId) {
        $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ProcessId)
        return [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
    }
    function Wait-Element([int] $ProcessId, [string] $Name) {
        $until = [DateTime]::UtcNow.AddSeconds(90)
        do {
            if ($process.HasExited) { throw 'The application exited before the CSV grid was ready.' }
            $window = Get-AppWindow $ProcessId
            if ($null -ne $window) {
                try {
                    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $Name)
                    $element = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
                    if ($null -ne $element -and $element.Current.IsEnabled -and -not $element.Current.IsOffscreen) { return $element }
                } catch [System.Windows.Automation.ElementNotAvailableException] { }
            }
            Start-Sleep -Milliseconds 250
        } while ([DateTime]::UtcNow -lt $until)
        throw 'The expected CSV cell was not exposed by Windows UI Automation.'
    }
    function Click-Cell($Element) {
        $window = Get-AppWindow $process.Id
        if ($null -eq $window) { throw 'The application window is unavailable.' }
        [void][CsvSmokeMouse]::SetForegroundWindow([IntPtr]$window.Current.NativeWindowHandle)
        $point = $Element.GetClickablePoint()
        if (-not [CsvSmokeMouse]::SetCursorPos([int]$point.X, [int]$point.Y)) { throw 'Could not position the test pointer.' }
        [CsvSmokeMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
        [CsvSmokeMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 300
    }
    function Wait-Clipboard([string] $Expected) {
        $until = [DateTime]::UtcNow.AddSeconds(15)
        do {
            try { if ([Windows.Forms.Clipboard]::GetText() -eq $Expected) { return } } catch [Runtime.InteropServices.ExternalException] { }
            Start-Sleep -Milliseconds 200
        } while ([DateTime]::UtcNow -lt $until)
        throw 'The expected copied cell did not reach the Windows clipboard.'
    }
    function Wait-File([string] $Expected) {
        $until = [DateTime]::UtcNow.AddSeconds(20)
        $actual = $null
        do {
            try { $actual = [IO.File]::ReadAllText($csv); if ($actual -eq $Expected) { return } } catch [IO.IOException] { }
            Start-Sleep -Milliseconds 200
        } while ([DateTime]::UtcNow -lt $until)
        # Both strings are fixed synthetic test fixtures; escape line endings so
        # a Windows clipboard conversion can be distinguished from other errors.
        $shownExpected = $Expected.Replace("`r", '\r').Replace("`n", '\n')
        $shownActual = if ($null -eq $actual) { '(unavailable)' } else { $actual.Replace("`r", '\r').Replace("`n", '\n') }
        throw "Saved fixture mismatch. Expected: $shownExpected Actual: $shownActual"
    }
    function CellLabel([int] $Row, [int] $Column) {
        return "$Row$([char]0x884c) $Column$([char]0x5217)$([char]0x3092)$([char]0x7de8)$([char]0x96c6)"
    }

    $source = Wait-Element $process.Id (CellLabel 2 1)
    Click-Cell $source
    [Windows.Forms.SendKeys]::SendWait('^c')
    Wait-Clipboard 'source'
    Write-Output 'PASS: real WebView2 CSV copy reached the Windows clipboard.'

    $destination = Wait-Element $process.Id (CellLabel 3 2)
    Click-Cell $destination
    [Windows.Forms.SendKeys]::SendWait('^v')
    [Windows.Forms.SendKeys]::SendWait('^s')
    Wait-File ("head1,head2`r`nsource,dest`r`nalpha,source`r`n" + $lfRow + $crRow)
    Write-Output 'PASS: real WebView2 pasted the clipboard into the target CSV cell and saved.'

    # Change the operating-system clipboard independently of the application.
    # A comma in the text verifies that the CSV output quotes a cell correctly.
    [Windows.Forms.Clipboard]::SetText('external, value')
    $destination = Wait-Element $process.Id (CellLabel 3 1)
    Click-Cell $destination
    [Windows.Forms.SendKeys]::SendWait('^v')
    [Windows.Forms.SendKeys]::SendWait('^s')
    Wait-File ("head1,head2`r`nsource,dest`r`n`"external, value`",source`r`n" + $lfRow + $crRow)
    Write-Output 'PASS: external Windows clipboard text was pasted and escaped as a CSV cell.'

    $rowLabel = '2' + [char]0x884c + [char]0x3092 + [char]0x9078 + [char]0x629e
    $row = Wait-Element $process.Id $rowLabel
    Click-Cell $row
    [Windows.Forms.SendKeys]::SendWait('^c')
    Wait-Clipboard "source`tdest"
    Write-Output 'PASS: a selected CSV row copied as tab-separated text.'

    # In-cell LF/CR are document data, not the TSV separator between rows.
    # OS clipboard text conversions must not silently change either value.
    $source = Wait-Element $process.Id (CellLabel 4 1)
    Click-Cell $source
    [Windows.Forms.SendKeys]::SendWait('^c')
    $destination = Wait-Element $process.Id (CellLabel 4 2)
    Click-Cell $destination
    [Windows.Forms.SendKeys]::SendWait('^v')
    [Windows.Forms.SendKeys]::SendWait('^s')
    $lfAfter = "`"lf`nvalue`",`"lf`nvalue`"`r`n"
    Wait-File ("head1,head2`r`nsource,dest`r`n`"external, value`",source`r`n" + $lfAfter + $crRow)
    Write-Output 'PASS: a copied cell retained an embedded LF.'

    $source = Wait-Element $process.Id (CellLabel 5 1)
    Click-Cell $source
    [Windows.Forms.SendKeys]::SendWait('^c')
    $destination = Wait-Element $process.Id (CellLabel 5 2)
    Click-Cell $destination
    [Windows.Forms.SendKeys]::SendWait('^v')
    [Windows.Forms.SendKeys]::SendWait('^s')
    $crAfter = "`"cr`rvalue`",`"cr`rvalue`"`r`n"
    Wait-File ("head1,head2`r`nsource,dest`r`n`"external, value`",source`r`n" + $lfAfter + $crAfter)
    Write-Output 'PASS: a copied cell retained an embedded CR.'

    # The context-menu command reads the OS clipboard via the native bridge.
    # WebView2 denies browser clipboard permissions, so a browser-only test is
    # insufficient for this path.
    [Windows.Forms.Clipboard]::SetText("q`tw`r`nr`ts")
    $destination = Wait-Element $process.Id (CellLabel 2 2)
    Click-Cell $destination
    $point = $destination.GetClickablePoint()
    [void][CsvSmokeMouse]::SetCursorPos([int]$point.X, [int]$point.Y)
    [CsvSmokeMouse]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero)
    [CsvSmokeMouse]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero)
    $transposeLabel = -join @([char]0x7e26,[char]0x6a2a,[char]0x3092,[char]0x5165,[char]0x308c,[char]0x66ff,[char]0x3048,[char]0x3066,[char]0x8cbc,[char]0x308a,[char]0x4ed8,[char]0x3051)
    $command = Wait-Element $process.Id $transposeLabel
    Click-Cell $command
    Start-Sleep -Milliseconds 500
    [Windows.Forms.SendKeys]::SendWait('^s')
    Wait-File ("head1,head2`r`nsource,q,r`r`n`"external, value`",w,s`r`n" + $lfAfter + $crAfter)
    Write-Output 'PASS: native clipboard text was transposed through the CSV context menu.'
    $verified = $true
} finally {
    if ($null -ne $process -and -not $process.HasExited) {
        try { $null = $process.CloseMainWindow() } catch { }
        if (-not $process.WaitForExit(3000)) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            $null = $process.WaitForExit(10000)
        }
    }
    # Preserve the disposable tree on failure for runner diagnostics. Hosted
    # runners are destroyed after the job. Do not remove any unrelated paths.
    if ($verified -and (Test-Path -LiteralPath $testRoot)) {
        # WebView2 may keep profile files open briefly after its host exits.
        # Retry only our unique temp folder; never stop unrelated processes.
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        while ((Test-Path -LiteralPath $testRoot) -and [DateTime]::UtcNow -lt $deadline) {
            try { Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction Stop }
            catch { Start-Sleep -Milliseconds 500 }
        }
        if (Test-Path -LiteralPath $testRoot) {
            Write-Warning 'Temporary WebView2 files remain locked; the disposable hosted runner will remove them.'
        }
    }
}
