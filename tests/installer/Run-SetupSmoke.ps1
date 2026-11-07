param([Parameter(Mandatory)][string] $Setup)

$ErrorActionPreference = 'Stop'
# Product installation writes per-user registry and shortcuts. Never run this
# destructive smoke test on a developer machine or on a self-hosted runner.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:OS -ne 'Windows_NT') {
    throw 'The setup smoke test requires an ephemeral GitHub-hosted Windows runner.'
}
if (-not [Environment]::Is64BitOperatingSystem -or -not $env:RUNNER_TEMP) { throw 'A 64-bit Windows runner with RUNNER_TEMP is required.' }
$setupPath = (Resolve-Path -LiteralPath $Setup).Path
$testRoot = Join-Path $env:RUNNER_TEMP ('md-split-setup-smoke-' + [Guid]::NewGuid().ToString('N'))
$installPath = Join-Path $testRoot 'Application'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MD Split'
$progIdKey = 'HKCU:\Software\Classes\MD.Split.Markdown'
$capabilities = 'HKCU:\Software\MD Split\Capabilities'
$registered = 'HKCU:\Software\RegisteredApplications'
$startLink = Join-Path ([Environment]::GetFolderPath('Programs')) 'MD-CSV Split Editor.lnk'
$desktopLink = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'MD-CSV Split Editor.lnk'
$legacyStartLink = Join-Path ([Environment]::GetFolderPath('Programs')) 'MD Split.lnk'
$legacyDesktopLink = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'MD Split.lnk'
$legacyData = Join-Path $env:LOCALAPPDATA 'MD Split'

# Refuse to overwrite or remove an existing installation, registration or data.
if ((Get-Process -Name 'MD-Split' -ErrorAction SilentlyContinue) -or
    (Test-Path -LiteralPath $uninstallKey) -or (Test-Path -LiteralPath $progIdKey) -or
    (Test-Path -LiteralPath $capabilities) -or (Test-Path -LiteralPath $legacyData) -or
    (Test-Path -LiteralPath $startLink) -or (Test-Path -LiteralPath $desktopLink) -or
    (Test-Path -LiteralPath $legacyStartLink) -or (Test-Path -LiteralPath $legacyDesktopLink) -or
    (Get-ItemProperty -LiteralPath $registered -Name 'MD Split' -ErrorAction SilentlyContinue)) {
    throw 'Existing MD Split data or registration was found; refusing the smoke test.'
}
# Derive the editable extension set from the native file-picker list. The
# executable .bat extension remains editable but is not registered as a type
# for which this editor should appear in the Windows Open With candidates.
$typesSource = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\..\native\TextFileTypes.cs'))
$extensions = @([regex]::Matches($typesSource, 'new\("[^"\r\n]+",\s*\[([^\]]+)\]') | ForEach-Object {
    [regex]::Matches($_.Groups[1].Value, '"([a-z][a-z0-9]*)"') | ForEach-Object { '.' + $_.Groups[1].Value }
} | Select-Object -Unique)
if ($extensions.Count -lt 10 -or -not ($extensions -contains '.md') -or -not ($extensions -contains '.csv') -or -not ($extensions -contains '.html') -or -not ($extensions -contains '.txt') -or -not ($extensions -contains '.bat') -or -not ($extensions -contains '.cmd')) {
    throw 'Could not derive the supported extension list from TextFileTypes.'
}
$associationExtensions = @($extensions | Where-Object { $_ -ine '.bat' })
function UserChoiceSnapshot([string] $Extension) {
    $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$Extension\UserChoice"
    if (-not (Test-Path -LiteralPath $key)) { return '<absent>' }
    $value = Get-ItemProperty -LiteralPath $key -ErrorAction Stop
    return ([string]$value.ProgId + "`n" + [string]$value.Hash)
}
function BatchClassDefaultSnapshot {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes\.bat')
    if ($null -eq $key) { return '<absent>' }
    try {
        $value = $key.GetValue('')
        if ($null -eq $value) { return '<absent>' }
        return [string]$value
    } finally { $key.Dispose() }
}
$initialBatchClassDefault = BatchClassDefaultSnapshot
$initialUserChoices = @{}
foreach ($extension in $extensions) {
    $openWith = "HKCU:\Software\Classes\$extension\OpenWithProgids"
    $newProgId = 'MD.Split.File.' + $extension.TrimStart('.').ToLowerInvariant()
    if ((Get-ItemProperty -LiteralPath $openWith -Name 'MD.Split.Markdown' -ErrorAction SilentlyContinue) -or
        (Get-ItemProperty -LiteralPath $openWith -Name $newProgId -ErrorAction SilentlyContinue) -or
        (Test-Path -LiteralPath ("HKCU:\Software\Classes\" + $newProgId))) {
        throw 'An existing file association was found; refusing the smoke test.'
    }
    $initialUserChoices[$extension] = UserChoiceSnapshot $extension
}
if (Test-Path -LiteralPath $testRoot) { throw 'The isolated test directory already exists.' }
[void][IO.Directory]::CreateDirectory($testRoot)

function Invoke-CheckedProcess([string] $File, [string[]] $ProcessArguments, [int] $TimeoutSeconds = 900) {
    $process = Start-Process -FilePath $File -ArgumentList $ProcessArguments -PassThru
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        throw 'A setup process timed out.'
    }
    if ($process.ExitCode -ne 0) { throw "A setup process failed with exit code $($process.ExitCode)." }
}
function Assert-File([string] $Path, [string] $Description) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing: $Description" }
}
function Assert-BatchExecution([string] $BatchPath, [string] $MarkerPath) {
    if (Test-Path -LiteralPath $MarkerPath) { Remove-Item -LiteralPath $MarkerPath -Force }
    # This fixture exists only in the unique, disposable RUNNER_TEMP folder.
    # ShellExecute, unlike `cmd /c`, exercises the actual .bat association.
    Start-Process -FilePath $BatchPath -WorkingDirectory $testRoot | Out-Null
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while (-not (Test-Path -LiteralPath $MarkerPath -PathType Leaf) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 200 }
    if (-not (Test-Path -LiteralPath $MarkerPath -PathType Leaf) -or [IO.File]::ReadAllText($MarkerPath).Trim() -ne 'MD_SPLIT_BATCH_FIXTURE') { throw 'The synthetic batch file did not execute through its Windows association.' }
}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MdSplitSmokeShellIcon {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    private struct SHFILEINFO {
        public IntPtr hIcon;
        public int iIcon;
        public uint dwAttributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string szDisplayName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=80)] public string szTypeName;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct BITMAPINFOHEADER {
        public uint biSize; public int biWidth; public int biHeight; public ushort biPlanes; public ushort biBitCount;
        public uint biCompression; public uint biSizeImage; public int biXPelsPerMeter; public int biYPelsPerMeter;
        public uint biClrUsed; public uint biClrImportant;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct BITMAPINFO { public BITMAPINFOHEADER bmiHeader; public uint bmiColors; }
    [DllImport("shell32.dll", EntryPoint="SHGetFileInfoW", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern IntPtr SHGetFileInfo(string path, uint attributes, ref SHFILEINFO info, uint cb, uint flags);
    [DllImport("shell32.dll")] private static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2);
    [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr icon);
    [DllImport("user32.dll", EntryPoint="LoadImageW", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern IntPtr LoadImage(IntPtr instance, string name, uint type, int width, int height, uint flags);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll", SetLastError=true)] private static extern bool DrawIconEx(IntPtr dc, int x, int y, IntPtr icon, int width, int height, uint step, IntPtr brush, uint flags);
    [DllImport("gdi32.dll", SetLastError=true)] private static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll", SetLastError=true)] private static extern IntPtr CreateDIBSection(IntPtr dc, ref BITMAPINFO info, uint usage, out IntPtr bits, IntPtr section, uint offset);
    [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern bool GdiFlush();
    [DllImport("ole32.dll")] private static extern int CoInitializeEx(IntPtr reserved, uint coInit);
    [DllImport("ole32.dll")] private static extern void CoUninitialize();
    private static byte[] Render(IntPtr icon, int width, int height) {
        var dc = CreateCompatibleDC(IntPtr.Zero);
        if (dc == IntPtr.Zero) throw new InvalidOperationException("Could not create icon test DC.");
        IntPtr bitmap = IntPtr.Zero, previous = IntPtr.Zero;
        try {
            var info = new BITMAPINFO();
            info.bmiHeader.biSize = (uint)Marshal.SizeOf(typeof(BITMAPINFOHEADER));
            info.bmiHeader.biWidth = width; info.bmiHeader.biHeight = -height;
            info.bmiHeader.biPlanes = 1; info.bmiHeader.biBitCount = 32;
            IntPtr pixels;
            bitmap = CreateDIBSection(dc, ref info, 0, out pixels, IntPtr.Zero, 0);
            if (bitmap == IntPtr.Zero || pixels == IntPtr.Zero) throw new InvalidOperationException("Could not create icon test bitmap.");
            previous = SelectObject(dc, bitmap);
            if (previous == IntPtr.Zero || previous == new IntPtr(-1)) throw new InvalidOperationException("Could not select icon test bitmap.");
            var bytes = new byte[width * height * 4];
            for (int i=0; i<bytes.Length; i+=4) { bytes[i]=235; bytes[i+1]=235; bytes[i+2]=235; bytes[i+3]=255; }
            Marshal.Copy(bytes, 0, pixels, bytes.Length);
            if (!DrawIconEx(dc, 0, 0, icon, width, height, 0, IntPtr.Zero, 3)) throw new InvalidOperationException("Could not render icon.");
            GdiFlush();
            Marshal.Copy(pixels, bytes, 0, bytes.Length);
            return bytes;
        } finally {
            if (previous != IntPtr.Zero && previous != new IntPtr(-1)) SelectObject(dc, previous);
            if (bitmap != IntPtr.Zero) DeleteObject(bitmap);
            DeleteDC(dc);
        }
    }
    private static bool SamePixels(byte[] first, byte[] second) {
        if (first.Length != second.Length) return false;
        // Compare visible BGR values; alpha in a rendered GDI DIB may be undefined.
        for (int i=0; i<first.Length; i+=4)
            if (first[i]!=second[i] || first[i+1]!=second[i+1] || first[i+2]!=second[i+2]) return false;
        return true;
    }
    public static void VerifyIcon(string extension, string expectedFile, string differentFile) {
        int hr = CoInitializeEx(IntPtr.Zero, 0);
        // RPC_E_CHANGED_MODE means this thread was already initialized using
        // the other apartment model; COM is still available on the thread.
        if (hr < 0 && hr != unchecked((int)0x80010106)) Marshal.ThrowExceptionForHR(hr);
        try {
            SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero);
            var info = new SHFILEINFO();
            // ICON | USEFILEATTRIBUTES yields the icon that Explorer would draw.
            // ICONLOCATION can return an empty location despite a valid icon.
            var result = SHGetFileInfo("synthetic" + extension, 0x80, ref info, (uint)Marshal.SizeOf(typeof(SHFILEINFO)), 0x110);
            IntPtr expected = IntPtr.Zero, negative = IntPtr.Zero;
            try {
                if (result == IntPtr.Zero || info.hIcon == IntPtr.Zero) throw new InvalidOperationException("Shell did not provide a document icon handle.");
                int width=GetSystemMetrics(11), height=GetSystemMetrics(12); // SM_CXICON / SM_CYICON
                if (width <= 0 || height <= 0 || width > 512 || height > 512) throw new InvalidOperationException("Unexpected system icon size.");
                expected=LoadImage(IntPtr.Zero, expectedFile, 1, width, height, 0x10); // IMAGE_ICON / LR_LOADFROMFILE
                negative=LoadImage(IntPtr.Zero, differentFile, 1, width, height, 0x10);
                if (expected == IntPtr.Zero || negative == IntPtr.Zero) throw new InvalidOperationException("Could not load the expected or negative-control icon.");
                var observedPixels=Render(info.hIcon,width,height);
                if (!SamePixels(observedPixels,Render(expected,width,height))) throw new InvalidOperationException("Shell icon did not match the expected icon pixels.");
                if (SamePixels(observedPixels,Render(negative,width,height))) throw new InvalidOperationException("Shell icon also matched the different negative-control icon.");
            } finally {
                if (info.hIcon != IntPtr.Zero) DestroyIcon(info.hIcon);
                if (expected != IntPtr.Zero) DestroyIcon(expected);
                if (negative != IntPtr.Zero) DestroyIcon(negative);
            }
        } finally { if (hr >= 0) CoUninitialize(); }
    }
}
'@
function Assert-ShellIcon([string] $Extension, [string] $ExpectedIcon, [string] $DifferentIcon) {
    # An isolated throwaway extension has no existing UserChoice and does not
    # affect the machine's actual .md/.txt/.csv defaults.
    $probeExt = '.mp' + [Guid]::NewGuid().ToString('N').Substring(0,8)
    $probePath = 'Software\Classes\' + $probeExt
    $existing = [Microsoft.Win32.Registry]::ClassesRoot.OpenSubKey($probeExt)
    if ($null -ne $existing) { $existing.Dispose(); throw 'Probe extension unexpectedly exists.' }
    $probeKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($probePath)
    try { $probeKey.SetValue('', ('MD.Split.File.' + $Extension.TrimStart('.').ToLowerInvariant())) } finally { $probeKey.Dispose() }
    try {
        [MdSplitSmokeShellIcon]::VerifyIcon($probeExt, $ExpectedIcon, $DifferentIcon)
    } finally {
        [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($probePath, $false)
    }
}

$cleaned = $false
$batchOpenWithPath = 'Software\Classes\.bat\OpenWithProgids'
$otherProgId = 'MdSplit.Smoke.Other.' + [Guid]::NewGuid().ToString('N')
try {
    $batchFixture = Join-Path $testRoot 'synthetic-run.bat'
    $batchMarker = Join-Path $testRoot 'synthetic-run-result.txt'
    [IO.File]::WriteAllText($batchFixture, "@echo off`r`necho MD_SPLIT_BATCH_FIXTURE>`"%~dp0synthetic-run-result.txt`"`r`n", [Text.Encoding]::ASCII)
    Assert-BatchExecution $batchFixture $batchMarker
    # A foreign candidate must survive both registration and later cleanup.
    $batchKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($batchOpenWithPath)
    try { $batchKey.SetValue($otherProgId, '') } finally { $batchKey.Dispose() }
    # NSIS requires /D= to be the final argument and accepts spaces without
    # quoting its value. RUNNER_TEMP and the suffix contain no shell commands.
    Invoke-CheckedProcess $setupPath @('/S', "/D=$installPath")
    $app = Join-Path $installPath 'MD-Split.exe'
    $html = Join-Path $installPath 'wwwroot\index.html'
    $uninstaller = Join-Path $installPath 'Uninstall.exe'
    Assert-File $app 'application executable'
    Assert-File $html 'application UI'
    Assert-File $uninstaller 'uninstaller'
    Assert-File (Join-Path $installPath 'WebView2Runtime\msedgewebview2.exe') 'offline WebView runtime'
    $readme = Join-Path $installPath 'README.md'
    Assert-File $readme 'offline README'
    Assert-File (Join-Path $installPath 'CODE_SIGNING.md') 'offline code signing policy'
    if (-not [IO.File]::ReadAllText($readme).Contains('(CODE_SIGNING.md)')) { throw 'Offline README does not link to the bundled code signing policy.' }
    Assert-File (Join-Path $installPath 'install.ini') 'ownership marker'
    $location = (Get-ItemProperty -LiteralPath $uninstallKey -Name InstallLocation).InstallLocation
    if (-not [string]::Equals($location, $installPath, [StringComparison]::OrdinalIgnoreCase)) { throw 'The registered install location does not match the test directory.' }
    if (-not (Test-Path -LiteralPath $progIdKey)) { throw 'The application association was not registered.' }
    $associations = Join-Path $capabilities 'FileAssociations'
    foreach ($extension in $associationExtensions) {
        $newProgId = 'MD.Split.File.' + $extension.TrimStart('.').ToLowerInvariant()
        $openWith = "HKCU:\Software\Classes\$extension\OpenWithProgids"
        if (-not (Get-ItemProperty -LiteralPath $openWith -Name $newProgId -ErrorAction SilentlyContinue)) { throw "Open With candidate missing for $extension." }
        if (Get-ItemProperty -LiteralPath $openWith -Name 'MD.Split.Markdown' -ErrorAction SilentlyContinue) { throw "Legacy Open With candidate remains for $extension." }
        $value = Get-ItemProperty -LiteralPath $associations -Name $extension -ErrorAction Stop
        if ($value.PSObject.Properties[$extension].Value -ne $newProgId) { throw "Default-app capability missing for $extension." }
        $iconPath = Join-Path $installPath ('doc-icons\' + $extension.TrimStart('.').ToLowerInvariant() + '.ico')
        Assert-File $iconPath "document icon for $extension"
        $iconKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes\' + $newProgId + '\DefaultIcon')
        if ($null -eq $iconKey) { throw "DefaultIcon key is missing for $extension." }
        try { $iconValue = [string]$iconKey.GetValue('') } finally { $iconKey.Dispose() }
        if ($iconValue -ne ('"' + $iconPath + '",0')) { throw "Unexpected DefaultIcon for $extension." }
        if ((UserChoiceSnapshot $extension) -ne $initialUserChoices[$extension]) { throw "Installation unexpectedly changed the default app for $extension." }
    }
    $legacyIconPath = Join-Path $installPath 'doc-icons\document.ico'
    Assert-File $legacyIconPath 'legacy generic document icon'
    $legacyIconKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes\MD.Split.Markdown\DefaultIcon')
    if ($null -eq $legacyIconKey) { throw 'Legacy default-compatible document icon key is missing.' }
    try { $legacyIcon = [string]$legacyIconKey.GetValue('') } finally { $legacyIconKey.Dispose() }
    if ($legacyIcon -ne ('"' + $legacyIconPath + '",0')) { throw 'Legacy default-compatible document icon is incorrect.' }
    foreach ($probeExtension in @('.md','.txt','.csv')) {
        $different = if ($probeExtension -eq '.md') { 'txt' } else { 'md' }
        Assert-ShellIcon $probeExtension (Join-Path $installPath ('doc-icons\' + $probeExtension.TrimStart('.') + '.ico')) (Join-Path $installPath ('doc-icons\' + $different + '.ico'))
    }
    Write-Output 'PASS: Windows Shell icon pixels match each expected document icon and differ from a negative control.'
    $batchOpenWith = 'HKCU:\Software\Classes\.bat\OpenWithProgids'
    if ((Get-ItemProperty -LiteralPath $batchOpenWith -Name 'MD.Split.Markdown' -ErrorAction SilentlyContinue) -or (Get-ItemProperty -LiteralPath $batchOpenWith -Name 'MD.Split.File.bat' -ErrorAction SilentlyContinue) -or (Test-Path -LiteralPath 'HKCU:\Software\Classes\MD.Split.File.bat') -or (Get-ItemProperty -LiteralPath $associations -Name '.bat' -ErrorAction SilentlyContinue)) { throw 'Fresh install unexpectedly registered .bat.' }
    if (-not (Get-ItemProperty -LiteralPath $batchOpenWith -Name $otherProgId -ErrorAction SilentlyContinue)) { throw 'Fresh install removed another app candidate.' }
    if ((UserChoiceSnapshot '.bat') -ne $initialUserChoices['.bat']) { throw 'Installation changed the .bat default app choice.' }
    if ((BatchClassDefaultSnapshot) -ne $initialBatchClassDefault) { throw 'Installation changed the per-user .bat class default.' }
    Assert-BatchExecution $batchFixture $batchMarker
    Write-Output 'PASS: fresh install leaves bat executable and excludes it from editor candidates while preserving the other types and defaults.'

    # Simulate the two stale values made by v1.0.1, then exercise the same
    # registration entrypoint used by install, upgrade and settings.
    New-ItemProperty -LiteralPath $batchOpenWith -Name 'MD.Split.Markdown' -Value '' -PropertyType String -Force | Out-Null
    New-ItemProperty -LiteralPath $associations -Name '.bat' -Value 'MD.Split.Markdown' -PropertyType String -Force | Out-Null
    Invoke-CheckedProcess $app @('--register-quiet')
    if ((Get-ItemProperty -LiteralPath $batchOpenWith -Name 'MD.Split.Markdown' -ErrorAction SilentlyContinue) -or (Get-ItemProperty -LiteralPath $batchOpenWith -Name 'MD.Split.File.bat' -ErrorAction SilentlyContinue) -or (Get-ItemProperty -LiteralPath $associations -Name '.bat' -ErrorAction SilentlyContinue)) { throw 'Re-registration left stale bat editor candidates.' }
    if (-not (Get-ItemProperty -LiteralPath $batchOpenWith -Name $otherProgId -ErrorAction SilentlyContinue) -or (UserChoiceSnapshot '.bat') -ne $initialUserChoices['.bat']) { throw 'Re-registration changed another candidate or Windows default.' }
    if ((BatchClassDefaultSnapshot) -ne $initialBatchClassDefault) { throw 'Re-registration changed the per-user .bat class default.' }
    New-ItemProperty -LiteralPath $associations -Name '.bat' -Value $otherProgId -PropertyType String -Force | Out-Null
    Invoke-CheckedProcess $app @('--register-quiet')
    if ((Get-ItemProperty -LiteralPath $associations -Name '.bat' -ErrorAction Stop).PSObject.Properties['.bat'].Value -ne $otherProgId) { throw 'Re-registration removed another capability value.' }
    Remove-ItemProperty -LiteralPath $associations -Name '.bat' -Force
    Assert-BatchExecution $batchFixture $batchMarker
    Write-Output 'PASS: re-registration removes only the stale bat editor entry and preserves foreign entries, defaults and execution.'

    $sentinel = Join-Path $installPath 'Data\smoke-preserved.txt'
    [IO.File]::WriteAllText($sentinel, 'preserve during repair')
    Remove-Item -LiteralPath $html -Force
    Invoke-CheckedProcess $setupPath @('/S', "/D=$installPath")
    Assert-File $html 'repaired application UI'
    if ([IO.File]::ReadAllText($sentinel) -ne 'preserve during repair') { throw 'Repair did not preserve application data.' }
    Write-Output 'PASS: same-version silent repair restored a missing file and preserved data.'

    Invoke-CheckedProcess $uninstaller @('/S')
    # NSIS uninstallers may continue in a temporary child process.
    $deadline = [DateTime]::UtcNow.AddMinutes(3)
    while ((Test-Path -LiteralPath $installPath) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Seconds 1 }
    if (Test-Path -LiteralPath $installPath) { throw 'Uninstall did not remove the installation directory.' }
    if ((Test-Path -LiteralPath $uninstallKey) -or (Test-Path -LiteralPath $progIdKey)) { throw 'Uninstall left product registration behind.' }
    foreach ($extension in $extensions) {
        $openWith = "HKCU:\Software\Classes\$extension\OpenWithProgids"
        if (Get-ItemProperty -LiteralPath $openWith -Name 'MD.Split.Markdown' -ErrorAction SilentlyContinue) { throw "Uninstall left an Open With candidate for $extension." }
        $newProgId = 'MD.Split.File.' + $extension.TrimStart('.').ToLowerInvariant()
        if ((Get-ItemProperty -LiteralPath $openWith -Name $newProgId -ErrorAction SilentlyContinue) -or (Test-Path -LiteralPath ("HKCU:\Software\Classes\" + $newProgId))) { throw "Uninstall left a document icon candidate for $extension." }
        if ((UserChoiceSnapshot $extension) -ne $initialUserChoices[$extension]) { throw "Uninstall unexpectedly changed the default app for $extension." }
    }
    if (-not (Get-ItemProperty -LiteralPath $batchOpenWith -Name $otherProgId -ErrorAction SilentlyContinue)) { throw 'Uninstall removed another app candidate for bat.' }
    if ((BatchClassDefaultSnapshot) -ne $initialBatchClassDefault) { throw 'Uninstall changed the per-user .bat class default.' }
    Assert-BatchExecution $batchFixture $batchMarker
    if (Test-Path -LiteralPath $startLink) { throw 'Uninstall left the start-menu shortcut behind.' }
    $cleaned = $true
    Write-Output 'PASS: silent uninstall removed the dedicated folder and product registration.'
} finally {
    $batchKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($batchOpenWithPath, $true)
    if ($null -ne $batchKey) { try { $batchKey.DeleteValue($otherProgId, $false) } finally { $batchKey.Dispose() } }
    # If a step fails, preserve the isolated directory for runner diagnostics;
    # the hosted runner is destroyed after the job. Never clean unrelated paths.
    if ($cleaned -and (Test-Path -LiteralPath $testRoot)) { Remove-Item -LiteralPath $testRoot -Force -Recurse }
}

