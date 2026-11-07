$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:OS -ne 'Windows_NT' -or -not $env:RUNNER_TEMP -or -not $env:GITHUB_WORKSPACE) { throw 'An isolated GitHub-hosted Windows runner is required.' }
$root = Join-Path $env:RUNNER_TEMP ('mdsplit-shell-pixels-' + [Guid]::NewGuid().ToString('N'))
$out = Join-Path $env:GITHUB_WORKSPACE 'shell-icon-diagnostics'
if ((Test-Path -LiteralPath $root) -or (Test-Path -LiteralPath $out)) { throw 'Diagnostic destination already exists.' }
[void][IO.Directory]::CreateDirectory($root)
[void][IO.Directory]::CreateDirectory($out)
$md = (Resolve-Path -LiteralPath 'native/doc-icons/md.ico').Path
$txt = (Resolve-Path -LiteralPath 'native/doc-icons/txt.ico').Path
$appIcon = (Resolve-Path -LiteralPath 'native/app.ico').Path
$systemIcon = Join-Path $env:WINDIR 'System32\shell32.dll'
# Dummy command follows the product's quoted executable + quoted argument
# structure but is never executed. Both EXE and documents are synthetic.
$dummyExe = Join-Path $root 'MD-Split.exe'
Copy-Item -LiteralPath (Join-Path $env:WINDIR 'System32\cmd.exe') -Destination $dummyExe
$id = [Guid]::NewGuid().ToString('N')
$cases = @(
    @{ Label='product'; ProgId='MD.Split.File.md'; Path=$md; Index=0 },
    @{ Label='short'; ProgId=('MD.Split.File.d' + $id.Substring(0,8)); Path=$md; Index=0 },
    @{ Label='long'; ProgId=('MdSplit.Probe.' + $id); Path=$md; Index=0 },
    @{ Label='app'; ProgId=('MD.Split.File.a' + $id.Substring(0,8)); Path=$appIcon; Index=0 },
    @{ Label='system'; ProgId=('MD.Split.File.s' + $id.Substring(0,8)); Path=$systemIcon; Index=3 }
)
$createdExtensions = [Collections.Generic.List[string]]::new()
$createdProgIds = [Collections.Generic.List[string]]::new()

Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;

public static class MdSplitShellPixelDiagnostics {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    private struct SHFILEINFO {
        public IntPtr hIcon; public int iIcon; public uint dwAttributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string szDisplayName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=80)] public string szTypeName;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct BITMAPINFOHEADER {
        public uint biSize; public int biWidth; public int biHeight; public ushort biPlanes; public ushort biBitCount;
        public uint biCompression; public uint biSizeImage; public int biXPelsPerMeter; public int biYPelsPerMeter;
        public uint biClrUsed; public uint biClrImportant;
    }
    [StructLayout(LayoutKind.Sequential)] private struct BITMAPINFO { public BITMAPINFOHEADER bmiHeader; public uint bmiColors; }
    [DllImport("shell32.dll", EntryPoint="SHGetFileInfoW", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern IntPtr SHGetFileInfo(string path, uint attributes, ref SHFILEINFO info, uint cb, uint flags);
    [DllImport("shlwapi.dll", EntryPoint="AssocQueryStringW", CharSet=CharSet.Unicode)]
    private static extern int AssocQueryString(uint flags, uint kind, string assoc, string extra, StringBuilder output, ref uint length);
    [DllImport("shell32.dll")] private static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2);
    [DllImport("shell32.dll", EntryPoint="ExtractIconExW", CharSet=CharSet.Unicode)]
    private static extern uint ExtractIconEx(string file, int index, IntPtr[] large, IntPtr[] small, uint count);
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
    [DllImport("ole32.dll")] private static extern int CoInitializeEx(IntPtr reserved, uint mode);
    [DllImport("ole32.dll")] private static extern void CoUninitialize();

    public static void Refresh() { SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero); }
    private static byte[] Render(IntPtr icon, int width, int height) {
        var dc=CreateCompatibleDC(IntPtr.Zero); if (dc==IntPtr.Zero) throw new InvalidOperationException("CreateCompatibleDC failed");
        IntPtr bitmap=IntPtr.Zero, previous=IntPtr.Zero;
        try {
            var bmi=new BITMAPINFO(); bmi.bmiHeader.biSize=(uint)Marshal.SizeOf(typeof(BITMAPINFOHEADER));
            bmi.bmiHeader.biWidth=width; bmi.bmiHeader.biHeight=-height; bmi.bmiHeader.biPlanes=1; bmi.bmiHeader.biBitCount=32;
            IntPtr bits; bitmap=CreateDIBSection(dc,ref bmi,0,out bits,IntPtr.Zero,0);
            if (bitmap==IntPtr.Zero || bits==IntPtr.Zero) throw new InvalidOperationException("CreateDIBSection failed");
            previous=SelectObject(dc,bitmap); if (previous==IntPtr.Zero || previous==new IntPtr(-1)) throw new InvalidOperationException("SelectObject failed");
            var pixels=new byte[width*height*4]; for(int i=0;i<pixels.Length;i+=4) { pixels[i]=235;pixels[i+1]=235;pixels[i+2]=235;pixels[i+3]=255; }
            Marshal.Copy(pixels,0,bits,pixels.Length);
            if (!DrawIconEx(dc,0,0,icon,width,height,0,IntPtr.Zero,3)) throw new InvalidOperationException("DrawIconEx failed");
            GdiFlush(); Marshal.Copy(bits,pixels,0,pixels.Length); return pixels;
        } finally { if(previous!=IntPtr.Zero && previous!=new IntPtr(-1)) SelectObject(dc,previous); if(bitmap!=IntPtr.Zero) DeleteObject(bitmap); DeleteDC(dc); }
    }
    private static void SaveBmp(string path, byte[] pixels, int width, int height) {
        using(var f=File.Create(path)) using(var w=new BinaryWriter(f)) {
            w.Write((ushort)0x4D42);w.Write(54+pixels.Length);w.Write(0);w.Write(54);
            w.Write(40);w.Write(width);w.Write(-height);w.Write((ushort)1);w.Write((ushort)32);
            w.Write(0);w.Write(pixels.Length);w.Write(0);w.Write(0);w.Write(0);w.Write(0);w.Write(pixels);
        }
    }
    private static int DifferentPixels(byte[] a, byte[] b, out long total) {
        int diff=0;total=0; for(int i=0;i<a.Length;i+=4) { int d=Math.Abs(a[i]-b[i])+Math.Abs(a[i+1]-b[i+1])+Math.Abs(a[i+2]-b[i+2]); if(d!=0) diff++; total+=d; } return diff;
    }
    private static IntPtr LoadExpected(string path, int index, bool small, int w, int h) {
        if (index==0) return LoadImage(IntPtr.Zero,path,1,w,h,0x10);
        IntPtr[] large=new IntPtr[1],little=new IntPtr[1];
        if (ExtractIconEx(path,index,large,little,1)==0) return IntPtr.Zero;
        IntPtr result=small ? little[0] : large[0]; IntPtr other=small ? large[0] : little[0];
        if (other!=IntPtr.Zero) DestroyIcon(other); return result;
    }
    public static string Run(string label, string progId, string ext, string realFile, string expectedFile, int expectedIndex, string negativeFile, string output, string apartment) {
        string response=null;
        var thread=new Thread(delegate() {
            int com=CoInitializeEx(IntPtr.Zero,apartment=="STA"?2u:0u);
            try {
                if(com<0 && com!=unchecked((int)0x80010106)) Marshal.ThrowExceptionForHR(com);
                Refresh(); var log=new StringBuilder();
                foreach(string assoc in new string[] {ext,progId}) {
                    uint length=4096;var value=new StringBuilder((int)length);int hr=AssocQueryString(0,15,assoc,null,value,ref length);
                    log.AppendLine("ASSOC case="+label+" apartment="+apartment+" kind="+(assoc==ext?"extension":"progid")+" hr=0x"+hr.ToString("X8")+" value="+value.ToString());
                }
                foreach(uint flags in new uint[] {0x110,0x111,0x1110,0x100}) {
                    bool small=(flags & 1)!=0;int width=GetSystemMetrics(small?49:11),height=GetSystemMetrics(small?50:12);
                    if(width<=0||height<=0||width>512||height>512) throw new InvalidOperationException("Invalid dimensions");
                    var info=new SHFILEINFO();string path=(flags&0x10)!=0?"synthetic"+ext:realFile;
                    var ret=SHGetFileInfo(path,0x80,ref info,(uint)Marshal.SizeOf(typeof(SHFILEINFO)),flags);
                    IntPtr expected=IntPtr.Zero,negative=IntPtr.Zero;
                    try {
                        if(ret==IntPtr.Zero||info.hIcon==IntPtr.Zero) { log.AppendLine("FAILED case="+label+" apt="+apartment+" flags=0x"+flags.ToString("X")+" ret="+ret.ToInt64()+" error="+Marshal.GetLastWin32Error()); continue; }
                        expected=LoadExpected(expectedFile,expectedIndex,small,width,height);
                        negative=LoadImage(IntPtr.Zero,negativeFile,1,width,height,0x10);
                        if(expected==IntPtr.Zero||negative==IntPtr.Zero) {log.AppendLine("LOAD_FAILED case="+label+" expected="+(expected!=IntPtr.Zero)+" negative="+(negative!=IntPtr.Zero));continue;}
                        var got=Render(info.hIcon,width,height);var want=Render(expected,width,height);var wrong=Render(negative,width,height);
                        long totalExpected,totalNegative;int expectedDiff=DifferentPixels(got,want,out totalExpected),negativeDiff=DifferentPixels(got,wrong,out totalNegative);
                        string prefix=Path.Combine(output,label+"-"+apartment+"-"+flags.ToString("X"));
                        SaveBmp(prefix+"-shell.bmp",got,width,height);SaveBmp(prefix+"-expected.bmp",want,width,height);SaveBmp(prefix+"-negative.bmp",wrong,width,height);
                        log.AppendLine("PIXELS case="+label+" apt="+apartment+" flags=0x"+flags.ToString("X")+" size="+width+"x"+height+" shellIndex="+info.iIcon+" expectedDiff="+expectedDiff+" expectedTotal="+totalExpected+" negativeDiff="+negativeDiff+" negativeTotal="+totalNegative);
                    } finally {if(info.hIcon!=IntPtr.Zero) DestroyIcon(info.hIcon);if(expected!=IntPtr.Zero) DestroyIcon(expected);if(negative!=IntPtr.Zero) DestroyIcon(negative);}
                }
                response=log.ToString();
            } catch(Exception e) {response="PROBE_EXCEPTION case="+label+" apt="+apartment+" "+e.ToString();}
            finally {if(com>=0) CoUninitialize();}
        });
        thread.SetApartmentState(apartment=="STA"?ApartmentState.STA:ApartmentState.MTA);thread.Start();thread.Join();return response;
    }
}
'@

try {
    $classes = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes', $true)
    if ($null -eq $classes) { throw 'HKCU Classes is not writable.' }
    try {
        foreach ($case in $cases) {
            $probeExt = '.mp' + [Guid]::NewGuid().ToString('N').Substring(0,8)
            $existing = [Microsoft.Win32.Registry]::ClassesRoot.OpenSubKey($probeExt)
            if ($null -ne $existing) { $existing.Dispose(); throw 'Generated extension unexpectedly exists.' }
            $existing = [Microsoft.Win32.Registry]::ClassesRoot.OpenSubKey($case.ProgId)
            if ($null -ne $existing) { $existing.Dispose(); throw 'Generated ProgID unexpectedly exists.' }
            $prog = $classes.CreateSubKey($case.ProgId); $createdProgIds.Add($case.ProgId)
            try {
                $prog.SetValue('', 'MD-CSV Split Editor .MD Document')
                $iconKey = $prog.CreateSubKey('DefaultIcon')
                try { $iconKey.SetValue('', ('"' + $case.Path + '",' + $case.Index)) } finally { $iconKey.Dispose() }
                $command = $prog.CreateSubKey('shell\open\command')
                try { $command.SetValue('', ('"' + $dummyExe + '" "%1"')) } finally { $command.Dispose() }
            } finally { $prog.Dispose() }
            $key = $classes.CreateSubKey($probeExt)
            try { $key.SetValue('', $case.ProgId) } finally { $key.Dispose() }
            $createdExtensions.Add($probeExt)
            $file = Join-Path $root ($case.Label + $probeExt)
            [IO.File]::WriteAllText($file, 'synthetic')
            foreach ($apartment in @('STA','MTA')) {
                Write-Output ([MdSplitShellPixelDiagnostics]::Run($case.Label,$case.ProgId,$probeExt,$file,$case.Path,$case.Index,$txt,$out,$apartment))
            }
        }
    } finally { $classes.Dispose() }
    # Diagnostics are synthetic; PNGs can be inspected as a workflow artifact.
    Add-Type -AssemblyName System.Drawing
    foreach ($bmp in @(Get-ChildItem -LiteralPath $out -Filter '*.bmp' -File)) {
        $img=[System.Drawing.Image]::FromFile($bmp.FullName)
        try { $img.Save([IO.Path]::ChangeExtension($bmp.FullName,'.png'),[System.Drawing.Imaging.ImageFormat]::Png) } finally { $img.Dispose() }
        Remove-Item -LiteralPath $bmp.FullName -Force
    }
    if (@(Get-ChildItem -LiteralPath $out -Filter '*.png' -File).Count -eq 0) { throw 'No diagnostic images were generated.' }
} finally {
    $classes = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes', $true)
    if ($null -ne $classes) {
        try {
            foreach ($ext in $createdExtensions) { $classes.DeleteSubKeyTree($ext, $false) }
            foreach ($progId in $createdProgIds) { $classes.DeleteSubKeyTree($progId, $false) }
        } finally { $classes.Dispose() }
    }
    [MdSplitShellPixelDiagnostics]::Refresh()
    if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Force -Recurse }
}
