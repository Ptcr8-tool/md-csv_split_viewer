param([Parameter(Mandatory=$true)][string] $Application,
      [Parameter(Mandatory=$true)][string] $TestRoot,
      [Parameter(Mandatory=$true)][string] $ProbeSource)

$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:OS -ne 'Windows_NT' -or -not $env:RUNNER_TEMP) {
    throw 'This Shell context test requires an isolated GitHub-hosted Windows runner.'
}
if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne [Threading.ApartmentState]::STA) { throw 'Run the Shell test in an STA thread.' }
if (Get-Process -Name 'MD-Split' -ErrorAction SilentlyContinue) { throw 'A pre-existing editor process was found; refusing the test.' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Path $ProbeSource

$resolvedExe = (Resolve-Path -LiteralPath $Application).Path
$resolvedRoot = (Resolve-Path -LiteralPath $TestRoot).Path
if (-not $resolvedRoot.StartsWith((Resolve-Path -LiteralPath $env:RUNNER_TEMP).Path, [StringComparison]::OrdinalIgnoreCase)) { throw 'TestRoot is outside runner temp.' }
$runtime = Join-Path (Split-Path -Parent $resolvedExe) 'WebView2Runtime\msedgewebview2.exe'
if (-not (Test-Path -LiteralPath $runtime -PathType Leaf)) { throw 'The complete fixed WebView2 runtime is required for this UI test.' }
$settingsPath = Join-Path (Join-Path (Split-Path -Parent $resolvedExe) 'Data') 'settings.json'
$settingsPresent = Test-Path -LiteralPath $settingsPath -PathType Leaf
$settingsOriginal = if ($settingsPresent) { [IO.File]::ReadAllBytes($settingsPath) } else { $null }
$verb = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes\Directory\Background\shell\MD.Split.New')
if ($null -eq $verb) { throw 'The folder-background verb is not registered.' }
try { $title = [string]$verb.GetValue('MUIVerb') } finally { $verb.Dispose() }
if (-not $title) { throw 'Background verb title is empty.' }

function Find-ProcessElement([int] $ProcessId, [string[]] $Names, [System.Windows.Automation.ControlType] $Type, [string] $AutomationId = '') {
    $pidCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ProcessId)
    $typeCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $Type)
    # WebView2 content belongs to a child process. Restrict top-level windows
    # by the editor PID, but do not require descendants to have that PID.
    $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $pidCondition)
    foreach ($window in $windows) {
        try { $found = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $typeCondition) }
        catch [System.Windows.Automation.ElementNotAvailableException] { continue }
        foreach ($item in $found) {
            try {
                if ($item.Current.IsOffscreen -or -not $item.Current.IsEnabled) { continue }
                if ($AutomationId -and $item.Current.AutomationId -ne $AutomationId) { continue }
                if ($Names.Count -gt 0 -and $Names -notcontains $item.Current.Name) { continue }
                return $item
            } catch [System.Windows.Automation.ElementNotAvailableException] { }
        }
    }
    return $null
}
function Wait-ProcessElement([int] $ProcessId, [string[]] $Names, [System.Windows.Automation.ControlType] $Type, [string] $AutomationId = '') {
    $until = [DateTime]::UtcNow.AddSeconds(90)
    do { $item=Find-ProcessElement $ProcessId $Names $Type $AutomationId; if ($null -ne $item) { return $item }; Start-Sleep -Milliseconds 250 } while ([DateTime]::UtcNow -lt $until)
    $pidCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ProcessId)
    $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $pidCondition)
    $seen = @()
    foreach ($window in $windows) {
        try {
            $seen += 'Window: ' + $window.Current.Name
            $items=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
            foreach ($item in $items) { try { if ($item.Current.Name) { $seen += $item.Current.ControlType.ProgrammaticName + ': ' + $item.Current.Name } } catch [System.Windows.Automation.ElementNotAvailableException] {} }
        } catch [System.Windows.Automation.ElementNotAvailableException] {}
    }
    throw ('The expected application control was not found: ' + ($Names -join '|') + ' ' + $AutomationId + '. Visible UI: ' + (($seen | Select-Object -First 50) -join '; '))
}
function Wait-ShellTitle([string] $Folder, [string] $Expected) {
    $until = [DateTime]::UtcNow.AddSeconds(20)
    do {
        $titles = [ShellBackgroundProbe]::GetTitles($Folder)
        if ($titles -like ('*' + $Expected + '*')) { return }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $until)
    throw 'The Windows Shell did not include the registered background command.'
}
function Get-ProcessUiSnapshot([int] $ProcessId) {
    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ProcessId)
    $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
    $seen = @()
    foreach ($window in $windows) {
        try {
            $seen += 'Window: ' + $window.Current.Name
            $items=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
            foreach ($item in $items) {
                try {
                    if (-not $item.Current.IsOffscreen -and $item.Current.Name) {
                        $seen += $item.Current.ControlType.ProgrammaticName + ' [' + $item.Current.AutomationId + ']: ' + $item.Current.Name
                    }
                } catch [System.Windows.Automation.ElementNotAvailableException] { }
            }
        } catch [System.Windows.Automation.ElementNotAvailableException] { }
    }
    return (($seen | Select-Object -First 100) -join '; ')
}

$createdProcess = $null
$mappedDrive = $null
try {
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $settingsPath))
    [IO.File]::WriteAllText($settingsPath, '{"language":"en","welcomeShown":true,"updateCheckDays":-1}', [Text.UTF8Encoding]::new($false))
    # Query the virtual desktop, not just the filesystem Desktop directory;
    # this merges DesktopBackground verbs used by the actual desktop menu.
    Wait-ShellTitle 'shell:Desktop' $title
    # Includes whitespace, '%' and Japanese characters: the target must arrive
    # unchanged when the Shell expands the actual registered folder verb.
    $unicode = [string][char]0x65e5 + [char]0x672c
    $folders = @((Join-Path $resolvedRoot ('context 100% ' + $unicode + ' one')), (Join-Path $resolvedRoot ('context 100% ' + $unicode + ' two')), (Join-Path $resolvedRoot ('context 100% ' + $unicode + ' root')))
    foreach ($folder in $folders) { [void][IO.Directory]::CreateDirectory($folder) }
    $letter = @('Z','Y','X','W','V','U','T','S','R','Q') | Where-Object { -not (Test-Path -LiteralPath ($_.ToString() + ':\')) } | Select-Object -First 1
    if (-not $letter) { throw 'No free drive letter is available for the isolated root-path test.' }
    $mappedDrive = $letter + ':'
    & (Join-Path $env:WINDIR 'System32\subst.exe') $mappedDrive $folders[2]
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the isolated drive mapping.' }
    $targets = @($folders[0],$folders[1],($mappedDrive + '\'))
    $nameCreate = 'Create'
    $japaneseCreate = [string][char]0x4f5c + [char]0x6210
    foreach ($index in @(0,1,2)) {
        $folder = $targets[$index]
        $verb = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes\Directory\Background\shell\MD.Split.New')
        if ($null -eq $verb) { throw 'The folder-background command disappeared.' }
        try { $title = [string]$verb.GetValue('MUIVerb') } finally { $verb.Dispose() }
        Wait-ShellTitle $folder $title
        [ShellBackgroundProbe]::InvokeTitle($folder, $title)
        $until = [DateTime]::UtcNow.AddSeconds(90)
        do {
            $candidate = Get-Process -Name 'MD-Split' -ErrorAction SilentlyContinue | Where-Object { try { [string]::Equals($_.Path, $resolvedExe, [StringComparison]::OrdinalIgnoreCase) } catch { $false } } | Select-Object -First 1
            if ($null -ne $candidate) { $createdProcess = $candidate; break }
            Start-Sleep -Milliseconds 250
        } while ([DateTime]::UtcNow -lt $until)
        if ($null -eq $createdProcess) { throw 'The background command did not start the editor.' }
        $create = Wait-ProcessElement $createdProcess.Id @($nameCreate,$japaneseCreate) ([System.Windows.Automation.ControlType]::Button)
        $pattern = $create.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $pattern.Invoke()
        # Common Win32 SaveFileDialog uses control id 1001 for its file name.
        $filename = Wait-ProcessElement $createdProcess.Id @() ([System.Windows.Automation.ControlType]::Edit) '1001'
        $value = $filename.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        $baseName = 'shell-context-test-' + $index + '.md'
        $value.SetValue($baseName)
        if ($value.Current.Value -ne $baseName) { throw 'Save dialog did not accept the synthetic file name.' }
        $beforeSaveUi = Get-ProcessUiSnapshot $createdProcess.Id
        $japaneseSave = [string][char]0x4fdd + [char]0x5b58
        $save = Wait-ProcessElement $createdProcess.Id @('Save', $japaneseSave, ($japaneseSave + '(&S)'), ($japaneseSave + '(S)')) ([System.Windows.Automation.ControlType]::Button)
        $save.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
        $expected = Join-Path $folder $baseName
        Write-Output ('Checking Shell-created file ' + $index + ': ' + $expected)
        $until = [DateTime]::UtcNow.AddSeconds(30)
        do { if (Test-Path -LiteralPath $expected -PathType Leaf) { break }; Start-Sleep -Milliseconds 250 } while ([DateTime]::UtcNow -lt $until)
        if (-not (Test-Path -LiteralPath $expected -PathType Leaf)) {
            $nearby = @(Get-ChildItem -LiteralPath $resolvedRoot -Recurse -File -Filter ('shell-context-test-' + $index + '*') -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
            $afterSaveUi = Get-ProcessUiSnapshot $createdProcess.Id
            throw ('New file was not created at the selected background path: ' + $expected + '. Matching files under fixture: ' + ($nearby -join ', ') + '. UI before save: ' + $beforeSaveUi + '. UI after save: ' + $afterSaveUi)
        }
    }
    Write-Output 'PASS: Windows Shell exposes the desktop verb and invokes the folder-background verb for Unicode folders and a drive root, cold and already running.'
} finally {
    if ($null -ne $createdProcess -and -not $createdProcess.HasExited) {
        $createdProcess.CloseMainWindow() | Out-Null
        if (-not $createdProcess.WaitForExit(10000)) { Stop-Process -Id $createdProcess.Id -Force -ErrorAction SilentlyContinue }
    }
    if ($settingsPresent) { [IO.File]::WriteAllBytes($settingsPath,$settingsOriginal) }
    elseif (Test-Path -LiteralPath $settingsPath) { Remove-Item -LiteralPath $settingsPath -Force }
    if ($mappedDrive) { & (Join-Path $env:WINDIR 'System32\subst.exe') $mappedDrive /D | Out-Null }
}
