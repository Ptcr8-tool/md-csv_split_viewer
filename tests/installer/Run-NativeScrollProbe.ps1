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
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
}
'@
$root=Join-Path $env:RUNNER_TEMP ('native-scroll-'+[guid]::NewGuid().ToString('N'))
$app=Join-Path $root 'Application'
New-Item -ItemType Directory -Path $root -Force|Out-Null
$publishPath=(Resolve-Path -LiteralPath $Setup).Path
Copy-Item -LiteralPath $publishPath -Destination $app -Recurse
$index=Join-Path $app 'wwwroot\index.html'
if(-not (Test-Path -LiteralPath $index)){throw 'Published HTML missing.'}
Write-Output ('PRODUCT ' + [Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path $app 'MD-Split.exe')).ProductVersion)
$fixtureJs=Join-Path $app 'wwwroot\assets\index-CV3ngKhj.js'
if (Test-Path -LiteralPath $fixtureJs) { Write-Output ('JS_SHA256 ' + (Get-FileHash -LiteralPath $fixtureJs -Algorithm SHA256).Hash.ToLowerInvariant()) }
$html=[IO.File]::ReadAllText($index)
if(-not $html.Contains('</body>')){throw 'Body missing.'}
$html=$html.Replace('</body>','<script src="/native-scroll-probe.js"></script></body>')
[IO.File]::WriteAllText($index,$html,[Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath 'tests/installer/native-scroll-probe.js' -Destination (Join-Path $app 'wwwroot\native-scroll-probe.js')
$data=Join-Path $app 'Data'
New-Item -ItemType Directory -Path $data -Force|Out-Null
[IO.File]::WriteAllText((Join-Path $data 'settings.json'),'{"language":"ja","welcomeShown":true,"updateCheckDays":-1,"sessionPolicy":"clear","sync":true,"softBreaks":true,"showLineBreaks":true,"showFullWidthSpaces":true,"showTabs":true,"showSpaces":true,"wrap":true,"fontSize":15}',[Text.UTF8Encoding]::new($false))
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
   do{$initial=$pattern.Current.Value;if($initial.StartsWith($name+',')){break};if($initial.StartsWith('notfound:') -or $initial.StartsWith('lost:') -or $initial.StartsWith('notvisible:')){throw "Target line $initial"};Start-Sleep -Milliseconds 250}while([DateTime]::UtcNow -lt $until)
   if(-not $initial.StartsWith($name+',')){throw "Could not prepare $name; $initial"}
   [void][ScrollProbeWin]::SetForegroundWindow($process.MainWindowHandle)
   $targetCond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'probe target')
   $target=$null
   for($attempt=0;$attempt -lt 20;$attempt++){
     $all=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,$targetCond)
     foreach($candidate in $all){if(-not $candidate.Current.IsOffscreen){$target=$candidate;break}}
     if($target){break}; Start-Sleep -Milliseconds 200
   }
   if(-not $target){throw "Target line not visible: $name"}
   $rect=$target.Current.BoundingRectangle
   if($rect.Width -lt 4 -or $rect.Height -lt 4){throw "Invalid target rectangle: $name"}
   [void][ScrollProbeWin]::SetCursorPos([int]($rect.Left+[Math]::Min(40,$rect.Width/2)),[int]($rect.Top+$rect.Height/2))
   [ScrollProbeWin]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero);[ScrollProbeWin]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)
   Start-Sleep -Seconds 2
   $before=$pattern.Current.Value
   [Windows.Forms.SendKeys]::SendWait('{END}'); for($i=0;$i -lt 12;$i++){[Windows.Forms.SendKeys]::SendWait('{ENTER}a');Start-Sleep -Milliseconds 450}
   Start-Sleep -Seconds 2
   $final=$pattern.Current.Value
   Write-Output "TRACE sync=$sync phase=$name initial=$initial before=$before final=$final"
   $fields=$final.Split(',')
   if($fields.Count -ne 10 -or [int]$fields[8] -lt 5 -or [int]$fields[9] -lt 5){throw "Input events not delivered: $final"}
   $beforeFields=$before.Split(',')
   if($beforeFields.Count -ne 10){throw "Bad initial telemetry: $before"}
   $delta=[Math]::Abs([double]$fields[2]-[double]$beforeFields[2])
   Write-Output "DELTA sync=$sync preview=$delta"; if($delta -ge 100){throw "Preview moved by $delta pixels: $final"}
 }
 Invoke-Probe 'toggle'
 Test-Phase 'off' 'list'
}finally{if($process -and -not $process.HasExited){$process.Kill();$process.WaitForExit()}}
