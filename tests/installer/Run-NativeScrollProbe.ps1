param([Parameter(Mandatory=$true)][string] $Setup)
$ErrorActionPreference='Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:OS -ne 'Windows_NT' -or -not $env:RUNNER_TEMP) { throw 'Hosted Windows runner required.' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ScrollProbeWin {
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
'@
$root=Join-Path $env:RUNNER_TEMP ('native-scroll-'+[guid]::NewGuid().ToString('N'))
$app=Join-Path $root 'Application'
New-Item -ItemType Directory -Path $root -Force|Out-Null
$setupPath=(Resolve-Path -LiteralPath $Setup).Path
$setupProcess=Start-Process -FilePath $setupPath -ArgumentList @('/S',"/D=$app") -PassThru
if(-not $setupProcess.WaitForExit(900000) -or $setupProcess.ExitCode -ne 0){throw 'Installation failed.'}
$index=Join-Path $app 'wwwroot\index.html'
if(-not (Test-Path -LiteralPath $index)){throw 'Published HTML missing.'}
$html=[IO.File]::ReadAllText($index)
if(-not $html.Contains('</body>')){throw 'Body missing.'}
$html=$html.Replace('</body>','<script src="/native-scroll-probe.js"></script></body>')
[IO.File]::WriteAllText($index,$html,[Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath 'tests/installer/native-scroll-probe.js' -Destination (Join-Path $app 'wwwroot\native-scroll-probe.js')
$data=Join-Path $app 'Data'
New-Item -ItemType Directory -Path $data -Force|Out-Null
[IO.File]::WriteAllText((Join-Path $data 'settings.json'),'{"language":"ja","welcomeShown":true,"updateCheckDays":-1,"sessionPolicy":"clear","sync":true}',[Text.UTF8Encoding]::new($false))
$file=Join-Path $root 'fixture.md'
Copy-Item -LiteralPath 'examples/Welcome.md' -Destination $file
$process=Start-Process -FilePath (Join-Path $app 'MD-Split.exe') -ArgumentList ('"'+$file+'"') -PassThru
try{
 $until=[DateTime]::UtcNow.AddSeconds(100);$element=$null;$window=$null
 do{
  if($process.HasExited){throw 'App exited.'}
  try{
   $process.Refresh()
   if($process.MainWindowHandle -ne [IntPtr]::Zero){
    $window=[System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
    $condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'scroll telemetry')
    $element=$window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)
    if($element){$pattern=$element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern);if($pattern.Current.Value -eq 'ready'){break}}
   }
  }catch [System.Windows.Automation.ElementNotAvailableException]{}
  Start-Sleep -Milliseconds 250
 }while([DateTime]::UtcNow -lt $until)
 if(-not $element){throw 'Probe did not initialize.'}
 function Invoke-Probe([string]$name){
   $cond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,('probe '+$name))
   $button=$window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$cond)
   if(-not $button){throw "Missing probe button $name"}
   $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
 }
 function Test-Phase([string]$sync,[string]$name){
   Invoke-Probe $name
   $until=[DateTime]::UtcNow.AddSeconds(40)
   do{$initial=$pattern.Current.Value;if($initial.StartsWith($name+',')){break};if($initial.StartsWith('notfound:') -or $initial.StartsWith('lost:')){throw "Target line $initial"};Start-Sleep -Milliseconds 250}while([DateTime]::UtcNow -lt $until)
   if(-not $initial.StartsWith($name+',')){throw "Could not prepare $name; $initial"}
   [void][ScrollProbeWin]::SetForegroundWindow($process.MainWindowHandle)
   for($i=0;$i -lt 5;$i++){[Windows.Forms.SendKeys]::SendWait('{ENTER}a');Start-Sleep -Milliseconds 350}
   Start-Sleep -Seconds 2
   $final=$pattern.Current.Value
   Write-Output "TRACE sync=$sync phase=$name initial=$initial final=$final"
   $fields=$final.Split(',')
   if($fields.Count -ne 10 -or [int]$fields[8] -lt 5 -or [int]$fields[9] -lt 5){throw "Input events not delivered: $final"}
   $delta=[Math]::Abs([double]$fields[2]-[double]$fields[1])
   if($delta -ge 100){throw "Preview moved by $delta pixels: $final"}
 }
 Test-Phase 'on' 'list'
 Test-Phase 'on' 'plain'
 Invoke-Probe 'toggle'
 Test-Phase 'off' 'list'
 Test-Phase 'off' 'plain'
}finally{if($process -and -not $process.HasExited){$process.Kill();$process.WaitForExit()}}
