param([Parameter(Mandatory = $true)][string] $Setup)

$ErrorActionPreference = 'Stop'
# This test drives only the first three wizard pages; it never installs files.
# It must run in an isolated Windows CI session, not on a developer machine.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:OS -ne 'Windows_NT' -or -not $env:RUNNER_TEMP) {
    throw 'The setup UI check requires an isolated GitHub-hosted Windows runner.'
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$setupPath = (Resolve-Path -LiteralPath $Setup).Path
$testRoot = Join-Path $env:RUNNER_TEMP ('md-split-ui-' + [Guid]::NewGuid().ToString('N'))
$installPath = Join-Path $testRoot 'Application'
if (Test-Path -LiteralPath $testRoot) { throw 'The isolated UI test path already exists.' }

# Keep this file ASCII so Windows PowerShell 5.1 cannot reinterpret UTF-8 as
# the runner's ANSI code page. The assertions still compare actual Unicode.
function UnicodeText([string] $Value) { return [regex]::Unescape($Value) }
$welcome = UnicodeText '\u3053\u306eexe\u306b\u30a2\u30d7\u30ea\u3068\u5b9f\u884c\u74b0\u5883\u304c\u3059\u3079\u3066\u542b\u307e\u308c\u3066\u3044\u307e\u3059'
$license = UnicodeText '\u540c\u68b1\u3059\u308bMicrosoft Edge WebView2 Runtime'
$componentHeader = UnicodeText '\u69cb\u6210\u8981\u7d20\u306e\u9078\u629e'
$componentHelp = UnicodeText 'Windows\u3078\u306e\u767b\u9332\u3092\u9078\u3093\u3067\u304f\u3060\u3055\u3044'
$component = UnicodeText '\u30b9\u30bf\u30fc\u30c8\u30e1\u30cb\u30e5\u30fc\u306b\u767b\u9332'
$defaultAppHelp = UnicodeText '\u65e2\u5b9a\u30a2\u30d7\u30ea\u306f\u30a4\u30f3\u30b9\u30c8\u30fc\u30eb\u5f8c\u3001\u8a2d\u5b9a\u304b\u3089\u9078\u3079\u307e\u3059\u3002'
$obsoleteAssociation = UnicodeText '.md\u30fb.markdown\u3092\u958b\u304f\u30a2\u30d7\u30ea\u306e\u5019\u88dc\u306b\u767b\u9332'
$next = UnicodeText '\u6b21\u3078'

function Get-Dialog([int] $ProcessId) {
    $property = [System.Windows.Automation.AutomationElement]::ProcessIdProperty
    $condition = New-Object System.Windows.Automation.PropertyCondition($property, $ProcessId)
    return [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
        [System.Windows.Automation.TreeScope]::Children, $condition)
}
function Get-Elements($Dialog) {
    return $Dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition)
}
function Wait-Text([int] $ProcessId, [string] $Expected, [string] $Page) {
    $until = [DateTime]::UtcNow.AddSeconds(45)
    do {
        $dialog = Get-Dialog $ProcessId
        if ($null -ne $dialog) {
            try {
                foreach ($element in (Get-Elements $dialog)) {
                    if (($element.Current.Name -as [string]).Contains($Expected)) { return $dialog }
                }
            } catch [System.Windows.Automation.ElementNotAvailableException] { }
        }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $until)
    throw "Setup UI text was not available or was incorrect on the $Page page. Ensure the CI runner has an interactive UI session."
}
function Invoke-Next($Dialog) {
    foreach ($element in (Get-Elements $Dialog)) {
        if ($element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
            ($element.Current.Name -as [string]).Contains($next) -and $element.Current.IsEnabled) {
            $pattern = $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
            $pattern.Invoke()
            return
        }
    }
    throw 'The enabled Next button was not exposed by UI Automation.'
}
function Accept-License($Dialog) {
    foreach ($element in (Get-Elements $Dialog)) {
        if ($element.Current.ControlType -eq [System.Windows.Automation.ControlType]::CheckBox -and $element.Current.IsEnabled) {
            $pattern = $element.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
            if ($pattern.Current.ToggleState -ne [System.Windows.Automation.ToggleState]::On) { $pattern.Toggle() }
            return
        }
    }
    throw 'The license acceptance checkbox was not exposed by UI Automation.'
}

$process = $null
try {
    # /D must be the final argument. No page beyond components is visited.
    $process = Start-Process -FilePath $setupPath -ArgumentList "/D=$installPath" -PassThru
    $dialog = Wait-Text $process.Id $welcome 'welcome'
    Write-Output 'PASS: the product-specific Japanese welcome text is readable.'
    Invoke-Next $dialog
    $dialog = Wait-Text $process.Id $license 'license'
    Accept-License $dialog
    Invoke-Next $dialog
    $dialog = Wait-Text $process.Id $componentHeader 'components'
    $null = Wait-Text $process.Id $componentHelp 'components help'
    $null = Wait-Text $process.Id $component 'component list'
    $null = Wait-Text $process.Id $defaultAppHelp 'default app guidance'
    foreach ($element in (Get-Elements $dialog)) {
        if (($element.Current.Name -as [string]).Contains($obsoleteAssociation)) {
            throw 'The obsolete association checkbox must not be shown on the components page.'
        }
    }
    Write-Output 'PASS: the product-specific Japanese components text and option are readable.'
    Write-Output 'PASS: default-app selection is explained without an association checkbox.'
} finally {
    if ($null -ne $process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        $null = $process.WaitForExit(10000)
    }
    if (Test-Path -LiteralPath $testRoot) { throw 'The setup UI check unexpectedly created the install directory.' }
}
