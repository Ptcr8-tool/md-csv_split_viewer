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
# Selected command-oriented types remain editable without advertising the
# editor as their default handler; Python is explicitly available as a candidate.
$typesSource = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\..\native\TextFileTypes.cs'))
$extensions = @([regex]::Matches($typesSource, 'new\("[^"\r\n]+",\s*\[([^\]]+)\]') | ForEach-Object {
    [regex]::Matches($_.Groups[1].Value, '"([a-z][a-z0-9]*)"') | ForEach-Object { '.' + $_.Groups[1].Value }
} | Select-Object -Unique)
if ($extensions.Count -lt 10 -or -not ($extensions -contains '.md') -or -not ($extensions -contains '.csv') -or -not ($extensions -contains '.html') -or -not ($extensions -contains '.txt') -or -not ($extensions -contains '.bat') -or -not ($extensions -contains '.cmd')) {
    throw 'Could not derive the supported extension list from TextFileTypes.'
}
$executableExtensions = @('.bat','.cmd','.ps1','.psm1','.js','.mjs','.cjs','.sh','.bash','.zsh','.rb','.pl','.php','.lua','.r','.kts','.vbs','.vbe','.wsf','.wsh','.jse','.hta','.exe','.com')
$associationExtensions = @($extensions | Where-Object { $executableExtensions -notcontains $_ })
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
$globalVerbs = @(
    'Software\Classes\*\shell\MD.Split.Open',
    'Software\Classes\Directory\Background\shell\MD.Split.New',
    'Software\Classes\Directory\shell\MD.Split.New'
)
foreach ($verb in $globalVerbs) {
    $existing = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($verb)
    if ($null -ne $existing) { $existing.Dispose(); throw 'Existing global context menu registration; refusing the isolated smoke test.' }
}
# Preserve a pre-existing per-user icon supplied by another application.
$foreignIconFixturePath = 'Software\Classes\.csv\DefaultIcon'
$foreignIconFixture = $false
$existingForeignIcon = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($foreignIconFixturePath)
if ($null -eq $existingForeignIcon) {
    $fixture = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($foreignIconFixturePath)
    try { $fixture.SetValue('', '%SystemRoot%\system32\shell32.dll,1') } finally { $fixture.Dispose() }
    $foreignIconFixture = $true
} else { $existingForeignIcon.Dispose() }
$initialExecutionClassIcons = @{}
foreach ($class in @('batfile','cmdfile')) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes\' + $class + '\DefaultIcon')
    if ($null -eq $key) { $initialExecutionClassIcons[$class] = $null } else { try { $initialExecutionClassIcons[$class] = [string]$key.GetValue('') } finally { $key.Dispose() } }
}
$initialUserChoices = @{}
$initialIconValues = @{}
foreach ($extension in $extensions) {
    $initialIconKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Software\Classes\$extension\DefaultIcon")
    if ($null -eq $initialIconKey) { $initialIconValues[$extension] = $null } else { try { $initialIconValues[$extension] = [string]$initialIconKey.GetValue('') } finally { $initialIconKey.Dispose() } }
    $openWith = "HKCU:\Software\Classes\$extension\OpenWithProgids"
    if (Test-Path -LiteralPath "HKCU:\Software\Classes\SystemFileAssociations\$extension\shell\MD.Split.Open") { throw 'An existing context-menu registration was found; refusing the smoke test.' }
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
    private static long PixelDifference(byte[] first, byte[] second) {
        if (first.Length != second.Length) throw new InvalidOperationException("Icon bitmap sizes differ.");
        long sum=0;
        // Compare visible BGR values; alpha in a rendered GDI DIB may be undefined.
        for (int i=0; i<first.Length; i+=4)
            sum+=Math.Abs((int)first[i]-second[i])+Math.Abs((int)first[i+1]-second[i+1])+Math.Abs((int)first[i+2]-second[i+2]);
        return sum;
    }
    public static void VerifyType(string extension, string expectedType) {
        int hr = CoInitializeEx(IntPtr.Zero, 0);
        if (hr < 0 && hr != unchecked((int)0x80010106)) Marshal.ThrowExceptionForHR(hr);
        try {
            SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero);
            var info = new SHFILEINFO();
            // TYPENAME | USEFILEATTRIBUTES queries the Explorer-visible type.
            var result = SHGetFileInfo("synthetic" + extension, 0x80, ref info, (uint)Marshal.SizeOf(typeof(SHFILEINFO)), 0x410);
            if (result == IntPtr.Zero || info.szTypeName != expectedType)
                throw new InvalidOperationException("Unexpected shell type name: " + info.szTypeName + "; expected " + expectedType);
        } finally { if (hr >= 0) CoUninitialize(); }
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
                long expectedDifference=PixelDifference(observedPixels,Render(expected,width,height));
                long negativeDifference=PixelDifference(observedPixels,Render(negative,width,height));
                long permittedDifference=(long)width*height*3;
                // The Windows image list introduces minor per-channel rounding
                // even for its own icons. Limit that error and require the
                // shell result to be at least four times closer to the expected
                // artwork than to a deliberately different negative control.
                Console.WriteLine("SHELL_ICON_PIXELS size={0}x{1} expectedDiff={2} permitted={3} negativeDiff={4}",width,height,expectedDifference,permittedDifference,negativeDifference);
                if (expectedDifference > permittedDifference) throw new InvalidOperationException("Shell icon differs too much from the expected artwork.");
                if (negativeDifference <= expectedDifference * 4) throw new InvalidOperationException("Shell icon is not sufficiently distinct from the negative-control artwork.");
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
        [MdSplitSmokeShellIcon]::VerifyType($probeExt, ($Extension.TrimStart('.').ToUpperInvariant() + ' File'))
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
    $languageMarker = Join-Path $installPath 'Data\install-language.txt'
    Assert-File $languageMarker 'initial installer language'
    $initialLanguage = [IO.File]::ReadAllText($languageMarker).Trim()
    if ($initialLanguage -notin @('ja', 'en')) { throw 'Installer language marker was invalid.' }
    $preservedLanguage = if ($initialLanguage -eq 'ja') { 'en' } else { 'ja' }
    [IO.File]::WriteAllText($languageMarker, $preservedLanguage, [Text.Encoding]::ASCII)
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
    # Simulate the prior typed descriptions and run the same registration used
    # on upgrade. The existing ProgIDs and protected UserChoice remain intact.
    foreach ($extension in @('.txt', '.md', '.csv')) {
        $typedPath = 'Software\Classes\MD.Split.File.' + $extension.TrimStart('.')
        $typedKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($typedPath, $true)
        try { $typedKey.SetValue('', 'MD-CSV Split Editor ' + $extension.ToUpperInvariant() + ' Document') } finally { $typedKey.Dispose() }
    }
    # Also migrate the last released extension-first labels and legacy ProgID.
    $typedKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes\MD.Split.File.csv', $true)
    try { $typedKey.SetValue('', 'CSV File (MD-CSV Split Editor)') } finally { $typedKey.Dispose() }
    $legacyKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes\MD.Split.Markdown', $true)
    try { $legacyKey.SetValue('', 'Document (MD-CSV Split Editor)') } finally { $legacyKey.Dispose() }
    Invoke-CheckedProcess $app @('--register-quiet')
    $legacyKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes\MD.Split.Markdown')
    try { $legacyTypeName = [string]$legacyKey.GetValue('') } finally { $legacyKey.Dispose() }
    if ($legacyTypeName -ne 'Document') { throw 'Legacy type label was not updated.' }
    foreach ($extension in $associationExtensions) {
        $newProgId = 'MD.Split.File.' + $extension.TrimStart('.').ToLowerInvariant()
        $openWith = "HKCU:\Software\Classes\$extension\OpenWithProgids"
        if (-not (Get-ItemProperty -LiteralPath $openWith -Name $newProgId -ErrorAction SilentlyContinue)) { throw "Open With candidate missing for $extension." }
        if (Get-ItemProperty -LiteralPath $openWith -Name 'MD.Split.Markdown' -ErrorAction SilentlyContinue) { throw "Legacy Open With candidate remains for $extension." }
        $value = Get-ItemProperty -LiteralPath $associations -Name $extension -ErrorAction Stop
        if ($value.PSObject.Properties[$extension].Value -ne $newProgId) { throw "Default-app capability missing for $extension." }
        $typeKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes\' + $newProgId)
        try { $typeName = [string]$typeKey.GetValue('') } finally { $typeKey.Dispose() }
        if ($typeName -ne ($extension.TrimStart('.').ToUpperInvariant() + ' File')) { throw "File type label did not match the extension-only description for $extension." }
        $iconPath = Join-Path $installPath ('doc-icons-v2\' + $extension.TrimStart('.').ToLowerInvariant() + '.ico')
        Assert-File $iconPath "document icon for $extension"
        $iconKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes\' + $newProgId + '\DefaultIcon')
        if ($null -eq $iconKey) { throw "DefaultIcon key is missing for $extension." }
        try { $iconValue = [string]$iconKey.GetValue('') } finally { $iconKey.Dispose() }
        if ($iconValue -ne ('"' + $iconPath + '",0')) { throw "Unexpected DefaultIcon for $extension." }
        if ((UserChoiceSnapshot $extension) -ne $initialUserChoices[$extension]) { throw "Installation unexpectedly changed the default app for $extension." }
    }
    # Every supported file type has an extension icon, independently of the
    # default program. Existing per-user icon overrides must be preserved.
    foreach ($extension in $extensions) {
        $iconPath = Join-Path $installPath ('doc-icons-v2\' + $extension.TrimStart('.').ToLowerInvariant() + '.ico')
        Assert-File $iconPath "document icon for $extension"
        $iconKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes\' + $extension + '\DefaultIcon')
        if ($null -eq $iconKey) { throw "Extension icon is missing for $extension." }
        try { $actualIcon = [string]$iconKey.GetValue('') } finally { $iconKey.Dispose() }
        $expectedIcon = if ($null -ne $initialIconValues[$extension]) { $initialIconValues[$extension] } else { '"' + $iconPath + '",0' }
        if ($actualIcon -ne $expectedIcon) { throw "Extension icon was not registered or existing custom icon was changed for $extension." }
        if ((UserChoiceSnapshot $extension) -ne $initialUserChoices[$extension]) { throw "Installation changed the default app for $extension." }
    }
    foreach ($extension in $executableExtensions) {
        $openWith = 'HKCU:\Software\Classes\' + $extension + '\OpenWithProgids'
        $typed = 'MD.Split.File.' + $extension.TrimStart('.')
        if ((Get-ItemProperty -LiteralPath $openWith -Name 'MD.Split.Markdown' -ErrorAction SilentlyContinue) -or (Get-ItemProperty -LiteralPath $openWith -Name $typed -ErrorAction SilentlyContinue) -or (Get-ItemProperty -LiteralPath $associations -Name $extension -ErrorAction SilentlyContinue)) { throw "Executable script was advertised as an app candidate: $extension." }
        $applicationTypes = 'HKCU:\Software\Classes\Applications\MD-Split.exe\SupportedTypes'
        if (Get-ItemProperty -LiteralPath $applicationTypes -Name $extension -ErrorAction SilentlyContinue) { throw "Executable script was added to SupportedTypes: $extension." }
    }
    foreach ($extension in @('.py','.pyw')) {
        $openWith = 'HKCU:\Software\Classes\' + $extension + '\OpenWithProgids'
        $typed = 'MD.Split.File.' + $extension.TrimStart('.')
        $supportedTypes = 'HKCU:\Software\Classes\Applications\MD-Split.exe\SupportedTypes'
        if (-not (Get-ItemProperty -LiteralPath $openWith -Name $typed -ErrorAction SilentlyContinue) -or -not (Get-ItemProperty -LiteralPath $supportedTypes -Name $extension -ErrorAction SilentlyContinue)) { throw "Python editor candidate is missing: $extension." }
        if ((UserChoiceSnapshot $extension) -ne $initialUserChoices[$extension]) { throw "Registration changed the Python default app: $extension." }
    }
    $python = (Get-Command python -ErrorAction Stop).Source
    $pythonFixture = Join-Path $testRoot 'synthetic-run.py'
    $pythonMarker = Join-Path $testRoot 'synthetic-python-result.txt'
    [IO.File]::WriteAllText($pythonFixture, "from pathlib import Path`nPath(__file__).with_name('synthetic-python-result.txt').write_text('PYTHON_OK', encoding='utf-8')`n", [Text.UTF8Encoding]::new($false))
    Invoke-CheckedProcess $python @('"' + $pythonFixture + '"')
    if (-not (Test-Path -LiteralPath $pythonMarker) -or [IO.File]::ReadAllText($pythonMarker) -ne 'PYTHON_OK') { throw 'Python command-line execution did not work.' }
    Write-Output 'PASS: Python files are registered as candidates without changing defaults or command-line execution.'
    foreach ($probeExtension in @('.py','.cmd','.bat')) {
        $class = if ($probeExtension -eq '.cmd') { 'cmdfile' } elseif ($probeExtension -eq '.bat') { 'batfile' } else { $null }
        if ($null -eq $initialIconValues[$probeExtension] -and ($null -eq $class -or $null -eq $initialExecutionClassIcons[$class]) -and $initialUserChoices[$probeExtension] -eq '<absent>') {
            [MdSplitSmokeShellIcon]::VerifyIcon($probeExtension, (Join-Path $installPath ('doc-icons-v2\' + $probeExtension.TrimStart('.') + '.ico')), (Join-Path $installPath 'doc-icons-v2\txt.ico'))
        }
    }
    Write-Output 'PASS: all supported extensions have individual icons and excluded scripts are not app candidates.'
    $legacyIconPath = Join-Path $installPath 'doc-icons-v2\document.ico'
    Assert-File $legacyIconPath 'legacy generic document icon'
    $legacyIconKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes\MD.Split.Markdown\DefaultIcon')
    if ($null -eq $legacyIconKey) { throw 'Legacy default-compatible document icon key is missing.' }
    try { $legacyIcon = [string]$legacyIconKey.GetValue('') } finally { $legacyIconKey.Dispose() }
    if ($legacyIcon -ne ('"' + $legacyIconPath + '",0')) { throw 'Legacy default-compatible document icon is incorrect.' }
    foreach ($probeExtension in @('.md','.txt','.csv')) {
        $different = if ($probeExtension -eq '.md') { 'txt' } else { 'md' }
        Assert-ShellIcon $probeExtension (Join-Path $installPath ('doc-icons-v2\' + $probeExtension.TrimStart('.') + '.ico')) (Join-Path $installPath ('doc-icons-v2\' + $different + '.ico'))
    }
    Write-Output 'PASS: Windows Shell icon pixels match each expected document icon and differ from a negative control.'
    # Seed an old supported-extension verb owned by this installation, to
    # verify that enabling the global action migrates only our old entries.
    $legacy = 'Software\Classes\SystemFileAssociations\.txt\shell\MD.Split.Open'
    $legacyCommand = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($legacy + '\command')
    try { $legacyCommand.SetValue('', '"' + $app + '" "%1"') } finally { $legacyCommand.Dispose() }
    $legacyOther = 'Software\Classes\SystemFileAssociations\.csv\shell\MD.Split.Open'
    $legacyOtherCommand = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($legacyOther + '\command')
    try { $legacyOtherCommand.SetValue('', '"C:\other\editor.exe" "%1"') } finally { $legacyOtherCommand.Dispose() }
    Invoke-CheckedProcess $app @('--context-menu-enable')
    $expectedCommands = @(
        ('"' + $app + '" "%1"'),
        ('"' + $app + '" --new-in-directory "%V"'),
        ('"' + $app + '" --new-in-directory "%1"')
    )
    for ($i=0; $i -lt $globalVerbs.Count; $i++) {
        $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($globalVerbs[$i] + '\command')
        if ($null -eq $key) { throw 'Global file or folder verb is missing.' }
        try { $actual = [string]$key.GetValue('') } finally { $key.Dispose() }
        if ($actual -ne $expectedCommands[$i]) { throw 'Global context menu command is incorrect.' }
    }
    if ([Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($legacy)) { throw 'The owned legacy verb was not migrated.' }
    $other = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($legacyOther + '\command')
    if ($null -eq $other) { throw 'Migration removed another installation context menu.' }
    try { if ($other.GetValue('') -ne '"C:\other\editor.exe" "%1"') { throw 'Migration changed another installation context menu.' } } finally { $other.Dispose() }
    foreach ($extension in $extensions) {
        if ((UserChoiceSnapshot $extension) -ne $initialUserChoices[$extension]) { throw "Context menu changed default app for $extension." }
    }
    Invoke-CheckedProcess $app @('--context-menu-disable')
    foreach ($verb in $globalVerbs) {
        $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($verb)
        if ($null -ne $key) { $key.Dispose(); throw 'Disabling left a global context menu.' }
    }
    # The unrelated fixture must be removed by the harness, not the app.
    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($legacyOther, $false)
    Invoke-CheckedProcess $app @('--context-menu-enable')
    Write-Output 'PASS: global file and folder context menus migrate legacy owned entries and preserve other registrations and default choices.'
    $batchOpenWith = 'HKCU:\Software\Classes\.bat\OpenWithProgids'
    if ((Get-ItemProperty -LiteralPath $batchOpenWith -Name 'MD.Split.Markdown' -ErrorAction SilentlyContinue) -or (Get-ItemProperty -LiteralPath $batchOpenWith -Name 'MD.Split.File.bat' -ErrorAction SilentlyContinue) -or (Test-Path -LiteralPath 'HKCU:\Software\Classes\MD.Split.File.bat') -or (Get-ItemProperty -LiteralPath $associations -Name '.bat' -ErrorAction SilentlyContinue)) { throw 'Fresh install unexpectedly registered .bat.' }
    if (-not (Get-ItemProperty -LiteralPath $batchOpenWith -Name $otherProgId -ErrorAction SilentlyContinue)) { throw 'Fresh install removed another app candidate.' }
    if ((UserChoiceSnapshot '.bat') -ne $initialUserChoices['.bat']) { throw 'Installation changed the .bat default app choice.' }
    if ((BatchClassDefaultSnapshot) -ne $initialBatchClassDefault) { throw 'Installation changed the per-user .bat class default.' }
    Assert-BatchExecution $batchFixture $batchMarker
    $cmdFixture = Join-Path $testRoot 'synthetic-run.cmd'
    [IO.File]::WriteAllText($cmdFixture, "@echo off`r`necho MD_SPLIT_BATCH_FIXTURE>`"%~dp0synthetic-run-result.txt`"`r`n", [Text.Encoding]::ASCII)
    Assert-BatchExecution $cmdFixture $batchMarker
    if ($null -eq $initialIconValues['.cmd'] -and $null -eq $initialExecutionClassIcons['cmdfile']) {
        # A later explicit user icon must not be hidden by our higher-priority
        # cmdfile icon when registration is repeated.
        $cmdExtIcon = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes\.cmd\DefaultIcon', $true)
        $customCmdIcon = '%SystemRoot%\system32\shell32.dll,1'
        try { $cmdExtIcon.SetValue('', $customCmdIcon) } finally { $cmdExtIcon.Dispose() }
        Invoke-CheckedProcess $app @('--register-quiet')
        $cmdClass = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes\cmdfile\DefaultIcon')
        if ($null -ne $cmdClass) { try { if ($null -ne $cmdClass.GetValue('')) { throw 'A custom cmd icon was masked by the app execution-class icon.' } } finally { $cmdClass.Dispose() } }
        $cmdExtIcon = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes\.cmd\DefaultIcon', $true)
        try {
            if ([string]$cmdExtIcon.GetValue('') -ne $customCmdIcon) { throw 'A custom cmd extension icon was changed.' }
            $cmdExtIcon.SetValue('', '"' + (Join-Path $installPath 'doc-icons-v2\cmd.ico') + '",0')
        } finally { $cmdExtIcon.Dispose() }
        Invoke-CheckedProcess $app @('--register-quiet')
        [MdSplitSmokeShellIcon]::VerifyIcon('.cmd', (Join-Path $installPath 'doc-icons-v2\cmd.ico'), (Join-Path $installPath 'doc-icons-v2\txt.ico'))
        Assert-BatchExecution $cmdFixture $batchMarker
        Write-Output 'PASS: a custom cmd icon is preserved on re-registration and execution still works.'
    }
    Write-Output 'PASS: fresh install leaves bat executable and excludes it from editor candidates while preserving the other types and defaults.'

    # Earlier releases registered .cmd (and other scripts). Seed owned
    # candidates and MRU history, then verify migration preserves foreign apps.
    $cmdOpenWith = 'HKCU:\Software\Classes\.cmd\OpenWithProgids'
    New-Item -Path $cmdOpenWith -Force | Out-Null
    New-ItemProperty -LiteralPath $cmdOpenWith -Name 'MD.Split.File.cmd' -Value '' -PropertyType String -Force | Out-Null
    New-ItemProperty -LiteralPath $cmdOpenWith -Name $otherProgId -Value '' -PropertyType String -Force | Out-Null
    $ownedCmd = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Classes\MD.Split.File.cmd\shell\open\command')
    try { $ownedCmd.SetValue('', '"' + $app + '" "%1"') } finally { $ownedCmd.Dispose() }
    New-ItemProperty -LiteralPath $associations -Name '.cmd' -Value 'MD.Split.File.cmd' -PropertyType String -Force | Out-Null
    $historyPath = 'Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.cmd\OpenWithList'
    $history = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($historyPath)
    try { $history.SetValue('x', 'MD-Split.exe'); $history.SetValue('y', 'other-editor.exe'); $history.SetValue('MRUList', 'xy') } finally { $history.Dispose() }
    Invoke-CheckedProcess $app @('--register-quiet')
    if ((Get-ItemProperty -LiteralPath $cmdOpenWith -Name 'MD.Split.File.cmd' -ErrorAction SilentlyContinue) -or (Get-ItemProperty -LiteralPath $associations -Name '.cmd' -ErrorAction SilentlyContinue)) { throw 'Stale cmd candidate was not removed.' }
    if (-not (Get-ItemProperty -LiteralPath $cmdOpenWith -Name $otherProgId -ErrorAction SilentlyContinue)) { throw 'Migration removed a foreign cmd candidate.' }
    $history = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($historyPath)
    try { if ($history.GetValue('x') -or $history.GetValue('y') -ne 'other-editor.exe' -or $history.GetValue('MRUList') -ne 'y') { throw 'Migration did not preserve other Open With history.' } } finally { $history.Dispose() }
    $history = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($historyPath, $true)
    try { $history.DeleteValue('y', $false); $history.DeleteValue('MRUList', $false) } finally { $history.Dispose() }
    Remove-ItemProperty -LiteralPath $cmdOpenWith -Name $otherProgId -Force
    Assert-BatchExecution $cmdFixture $batchMarker
    Write-Output 'PASS: stale cmd candidates are removed while other apps and execution are preserved.'

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
    if ([IO.File]::ReadAllText($languageMarker).Trim() -ne $preservedLanguage) { throw 'Repair overwrote the existing language marker.' }
    Write-Output 'PASS: same-version silent repair restored a missing file and preserved data.'

    Invoke-CheckedProcess $uninstaller @('/S')
    # NSIS uninstallers may continue in a temporary child process.
    $deadline = [DateTime]::UtcNow.AddMinutes(3)
    while ((Test-Path -LiteralPath $installPath) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Seconds 1 }
    if (Test-Path -LiteralPath $installPath) { throw 'Uninstall did not remove the installation directory.' }
    if ((Test-Path -LiteralPath $uninstallKey) -or (Test-Path -LiteralPath $progIdKey)) { throw 'Uninstall left product registration behind.' }
    foreach ($verb in $globalVerbs) {
        $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($verb)
        if ($null -ne $key) { $key.Dispose(); throw 'Uninstall left a global context menu.' }
    }
    foreach ($extension in $extensions) {
        if (Test-Path -LiteralPath "HKCU:\Software\Classes\SystemFileAssociations\$extension\shell\MD.Split.Open") { throw "Uninstall left a context menu for $extension." }
        $openWith = "HKCU:\Software\Classes\$extension\OpenWithProgids"
        if (Get-ItemProperty -LiteralPath $openWith -Name 'MD.Split.Markdown' -ErrorAction SilentlyContinue) { throw "Uninstall left an Open With candidate for $extension." }
        $newProgId = 'MD.Split.File.' + $extension.TrimStart('.').ToLowerInvariant()
        if ((Get-ItemProperty -LiteralPath $openWith -Name $newProgId -ErrorAction SilentlyContinue) -or (Test-Path -LiteralPath ("HKCU:\Software\Classes\" + $newProgId))) { throw "Uninstall left a document icon candidate for $extension." }
        if ((UserChoiceSnapshot $extension) -ne $initialUserChoices[$extension]) { throw "Uninstall unexpectedly changed the default app for $extension." }
        $afterIcon = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes\' + $extension + '\DefaultIcon')
        if ($null -eq $initialIconValues[$extension]) {
            if ($null -ne $afterIcon) { try { if ($null -ne $afterIcon.GetValue('')) { throw "Uninstall left an extension icon for $extension." } } finally { $afterIcon.Dispose() } }
        } else {
            if ($null -eq $afterIcon) { throw "Uninstall removed another app's icon for $extension." }
            try { if ([string]$afterIcon.GetValue('') -ne $initialIconValues[$extension]) { throw "Uninstall changed another app's icon for $extension." } } finally { $afterIcon.Dispose() }
        }
    }
    foreach ($class in @('batfile','cmdfile')) {
        $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes\' + $class + '\DefaultIcon')
        if ($null -eq $initialExecutionClassIcons[$class]) {
            if ($null -ne $key) { try { if ($null -ne $key.GetValue('')) { throw "Uninstall left an icon override for $class." } } finally { $key.Dispose() } }
        } else {
            if ($null -eq $key) { throw "Uninstall removed another application's icon for $class." }
            try { if ([string]$key.GetValue('') -ne $initialExecutionClassIcons[$class]) { throw "Uninstall changed another application's icon for $class." } } finally { $key.Dispose() }
        }
    }
    if (-not (Get-ItemProperty -LiteralPath $batchOpenWith -Name $otherProgId -ErrorAction SilentlyContinue)) { throw 'Uninstall removed another app candidate for bat.' }
    if ((BatchClassDefaultSnapshot) -ne $initialBatchClassDefault) { throw 'Uninstall changed the per-user .bat class default.' }
    Assert-BatchExecution $batchFixture $batchMarker
    Assert-BatchExecution $cmdFixture $batchMarker
    if (Test-Path -LiteralPath $startLink) { throw 'Uninstall left the start-menu shortcut behind.' }
    $cleaned = $true
    Write-Output 'PASS: silent uninstall removed the dedicated folder and product registration.'
} finally {
    if ($foreignIconFixture) { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($foreignIconFixturePath, $false) }
    $batchKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($batchOpenWithPath, $true)
    if ($null -ne $batchKey) { try { $batchKey.DeleteValue($otherProgId, $false) } finally { $batchKey.Dispose() } }
    # If a step fails, preserve the isolated directory for runner diagnostics;
    # the hosted runner is destroyed after the job. Never clean unrelated paths.
    if ($cleaned -and (Test-Path -LiteralPath $testRoot)) { Remove-Item -LiteralPath $testRoot -Force -Recurse }
}

