param(
    [Parameter(Mandatory = $true)][string] $OldSetup,
    [Parameter(Mandatory = $true)][string] $CandidateSetup,
    [Parameter(Mandatory = $true)][string] $CandidateProof,
    [Parameter(Mandatory = $true)][string] $CandidateVersion,
    [ValidateSet('1.0.3', '1.1.0')][string] $OldVersion = '1.0.3',
    [switch] $AssumeOlderForTest
)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:OS -ne 'Windows_NT' -or -not $env:RUNNER_TEMP) { throw 'An isolated GitHub-hosted Windows runner is required.' }
$old = (Resolve-Path -LiteralPath $OldSetup).Path
$candidate = (Resolve-Path -LiteralPath $CandidateSetup).Path
$proof = (Resolve-Path -LiteralPath $CandidateProof).Path
$expectedOldSha = @{
    '1.0.3' = '172cf4a064cbdd3016241403d64762ad6ea3a420560c85ad5df639873a5aa24a'
    '1.1.0' = '882eb35b0d7bf89d59c45eeac7cccc0e5a31199d9015b6acd6617ddc3c90da30'
}[$OldVersion]
if ((Get-FileHash -LiteralPath $old -Algorithm SHA256).Hash.ToLowerInvariant() -cne $expectedOldSha) { throw "The old setup does not match published v$OldVersion." }
if ($CandidateVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid candidate version.' }
$root = Join-Path $env:RUNNER_TEMP ('md-split-legacy-updater-' + [guid]::NewGuid().ToString('N'))
$app = Join-Path $root 'Application'
[void][IO.Directory]::CreateDirectory($root)
$setup = Start-Process -FilePath $old -ArgumentList @('/S', "/D=$app") -PassThru
if (-not $setup.WaitForExit(900000) -or $setup.ExitCode -ne 0) { throw "Could not install the verified v$OldVersion setup." }
if (-not (Test-Path -LiteralPath (Join-Path $app 'MD-Split.dll') -PathType Leaf)) { throw 'The old application DLL is missing.' }
& dotnet publish tests/legacy-updater/LegacyUpdaterProbe.csproj -c Release -o $app
if ($LASTEXITCODE -ne 0) { throw 'Could not build the updater compatibility probe.' }
$override = if ($AssumeOlderForTest) { '0.0.0' } else { '-' }
& dotnet (Join-Path $app 'LegacyUpdaterProbe.dll') $candidate $proof $CandidateVersion (Join-Path $root 'Updates') $override $OldVersion
if ($LASTEXITCODE -ne 0) { throw "The shipped v$OldVersion updater rejected the candidate or its provenance." }
