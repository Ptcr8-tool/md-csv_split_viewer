$ErrorActionPreference = 'Stop'
# Temporary HKCU Classes only; never execute this on a normal user machine.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:OS -ne 'Windows_NT' -or -not $env:RUNNER_TEMP) { throw 'An isolated GitHub-hosted Windows runner is required.' }
$source = (Resolve-Path -LiteralPath 'native/doc-icons/md.ico').Path
$root = Join-Path $env:RUNNER_TEMP ('mdsplit-icon-probe-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($root)
$icon = Join-Path $root 'md.ico'
Copy-Item -LiteralPath $source -Destination $icon
$id = [Guid]::NewGuid().ToString('N')
$progId = 'MdSplit.Probe.' + $id
$extensions = @(('.mz' + $id.Substring(0,6)), ('.mdsplitprobe' + $id))
$createdExtensions = [Collections.Generic.List[string]]::new()
$createdProgId = $false

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public static class MdSplitShellDiagnostics {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    private struct SHFILEINFO {
        public IntPtr hIcon;
        public int iIcon;
        public uint dwAttributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string szDisplayName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=80)] public string szTypeName;
    }
    [DllImport("shell32.dll", EntryPoint="SHGetFileInfoW", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern IntPtr SHGetFileInfo(string path, uint attributes, ref SHFILEINFO info, uint cb, uint flags);
    [DllImport("shlwapi.dll", EntryPoint="AssocQueryStringW", CharSet=CharSet.Unicode)]
    private static extern int AssocQueryString(uint flags, uint kind, string assoc, string extra, StringBuilder output, ref uint length);
    [DllImport("shell32.dll")] private static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2);
    [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr icon);
    [DllImport("ole32.dll")] private static extern int CoInitializeEx(IntPtr reserved, uint coInit);
    [DllImport("ole32.dll")] private static extern void CoUninitialize();

    public static void Refresh() { SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero); }
    public static string Run(string ext, string path, string expectedIcon, string apartment) {
        string result = null;
        var worker = new Thread(delegate() {
            int comHr = CoInitializeEx(IntPtr.Zero, apartment == "STA" ? 2u : 0u);
            try {
                var lines = new List<string>();
                lines.Add("COM apartment=" + apartment + " hr=0x" + comHr.ToString("X8"));
                if (comHr < 0 && comHr != unchecked((int)0x80010106)) throw new InvalidOperationException("COM initialization failed.");
                Refresh();
                foreach (string assoc in new string[] {ext, "MdSplit.Probe." + System.IO.Path.GetFileNameWithoutExtension(path)}) {
                    uint length = 4096;
                    var buffer = new StringBuilder((int)length);
                    int hr = AssocQueryString(0, 15, assoc, null, buffer, ref length); // ASSOCSTR_DEFAULTICON
                    lines.Add("ASSOC assoc=" + assoc + " hr=0x" + hr.ToString("X8") + " length=" + length + " value=" + buffer.ToString());
                }
                string synthetic = "synthetic" + ext;
                string[] paths = new string[] {synthetic, path, ext};
                uint[] flags = new uint[] {0x100, 0x110, 0x1000, 0x1010, 0x1100, 0x1110};
                foreach (string file in paths) foreach (uint flag in flags) {
                    var info = new SHFILEINFO();
                    var ret = SHGetFileInfo(file, 0x80, ref info, (uint)Marshal.SizeOf(typeof(SHFILEINFO)), flag);
                    int error = Marshal.GetLastWin32Error();
                    string name = info.szDisplayName ?? "";
                    bool match = name.Trim('"').Equals(expectedIcon, StringComparison.OrdinalIgnoreCase);
                    lines.Add("SHELL apartment=" + apartment + " path=" + (file == path ? "real" : file == ext ? "extension" : "relative") + " flags=0x" + flag.ToString("X") + " ret=" + ret.ToInt64() + " lastError=" + error + " iconHandle=" + (info.hIcon != IntPtr.Zero) + " index=" + info.iIcon + " match=" + match + " name=" + name);
                    if (info.hIcon != IntPtr.Zero) DestroyIcon(info.hIcon);
                }
                result = String.Join("\n", lines.ToArray());
            } catch (Exception e) { result = "PROBE_EXCEPTION " + e.ToString(); }
            finally { if (comHr >= 0) CoUninitialize(); }
        });
        worker.SetApartmentState(apartment == "STA" ? ApartmentState.STA : ApartmentState.MTA);
        worker.Start(); worker.Join(); return result;
    }
}
'@

try {
    $classes = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes', $true)
    if ($null -eq $classes) { throw 'HKCU Classes is not writable.' }
    try {
        if ($classes.OpenSubKey($progId)) { throw 'Generated ProgID unexpectedly exists.' }
        $prog = $classes.CreateSubKey($progId); $createdProgId = $true
        try {
            $prog.SetValue('', 'Synthetic MD Split document')
            $iconKey = $prog.CreateSubKey('DefaultIcon')
            try { $iconKey.SetValue('', ('"' + $icon + '",0')) } finally { $iconKey.Dispose() }
            $command = $prog.CreateSubKey('shell\open\command')
            try { $command.SetValue('', ('"' + (Join-Path $env:WINDIR 'notepad.exe') + '" "%1"')) } finally { $command.Dispose() }
        } finally { $prog.Dispose() }
        foreach ($ext in $extensions) {
            $existing = [Microsoft.Win32.Registry]::ClassesRoot.OpenSubKey($ext)
            if ($null -ne $existing) { $existing.Dispose(); throw 'Generated test extension unexpectedly exists.' }
            $key = $classes.CreateSubKey($ext)
            try { $key.SetValue('', $progId) } finally { $key.Dispose() }
            $createdExtensions.Add($ext)
            # Name the synthetic file by the full GUID so the native helper
            # can also query the exact generated ProgID without a second arg.
            $file = Join-Path $root ($id + $ext)
            [IO.File]::WriteAllText($file, 'synthetic')
            foreach ($apartment in @('STA','MTA')) {
                Write-Output ('PROBE extension_length=' + $ext.Length + ' apartment=' + $apartment)
                Write-Output ([MdSplitShellDiagnostics]::Run($ext, $file, $icon, $apartment))
            }
        }
    } finally { $classes.Dispose() }
} finally {
    $classes = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes', $true)
    if ($null -ne $classes) {
        try {
            foreach ($ext in $createdExtensions) { $classes.DeleteSubKeyTree($ext, $false) }
            if ($createdProgId) { $classes.DeleteSubKeyTree($progId, $false) }
        } finally { $classes.Dispose() }
    }
    [MdSplitShellDiagnostics]::Refresh()
    if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Force -Recurse }
}

