using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace MdSplit;

internal static class Storage
{
    internal const long LargeFileWarningBytes = 64L * 1024 * 1024;
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string,long> LargeFileApprovals = new(StringComparer.OrdinalIgnoreCase);
    internal static bool ApproveLargeFile(string path, Func<long,bool> confirm)
    {
        path = Path.GetFullPath(path);
        var length = new FileInfo(path).Length;
        if (FileSizeApproved(path, length)) return true;
        if (!confirm(length)) return false;
        LargeFileApprovals[path] = length;
        return true;
    }
    internal static bool FileSizeApproved(string path, long length) => length <= LargeFileWarningBytes ||
        (LargeFileApprovals.TryGetValue(Path.GetFullPath(path), out var approved) && length <= approved);
    public static readonly string Root = Path.Combine(AppContext.BaseDirectory, "Data");
    public static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true, WriteIndented = false };
    public static readonly string SettingsPath = Path.Combine(Root, "settings.json");
    public static readonly string RecoveryPath = Path.Combine(Root, "Recovery");
    public static readonly string SessionPath = Path.Combine(Root, "Sessions");
    public static void Initialize() { MigrateLegacy(); Directory.CreateDirectory(Root); Directory.CreateDirectory(RecoveryPath); Directory.CreateDirectory(SessionPath); }
    public static void MigrateLegacy()
    {
        var old=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"MD Split");
        MigrateData(old,Root);
    }
    internal static void MigrateData(string old,string target)
    {
        if(File.Exists(Path.Combine(target,"settings.json"))||!Directory.Exists(old))return;
        Directory.CreateDirectory(target);
        foreach(var name in new[]{"Recovery","Images"})
        {
            var source=Path.Combine(old,name);if(!Directory.Exists(source))continue;
            CopyDirectory(source,Path.Combine(target,name));
        }
        foreach(var name in new[]{"recent.json","settings.json"}){var from=Path.Combine(old,name);if(File.Exists(from)&&!File.Exists(Path.Combine(target,name)))File.Copy(from,Path.Combine(target,name));}
        // Legacy installs using only defaults may have recovery but no settings file.
        // Write the default baseline only after recovery/images have been copied.
        if(!File.Exists(Path.Combine(target,"settings.json")))File.WriteAllText(Path.Combine(target,"settings.json"),JsonSerializer.Serialize(new AppSettings(),Json));
    }
    private static void CopyDirectory(string source,string target)
    {
        if((File.GetAttributes(source)&FileAttributes.ReparsePoint)!=0)return;Directory.CreateDirectory(target);
        foreach(var file in Directory.EnumerateFiles(source))if((File.GetAttributes(file)&FileAttributes.ReparsePoint)==0&&!File.Exists(Path.Combine(target,Path.GetFileName(file))))File.Copy(file,Path.Combine(target,Path.GetFileName(file)));
        foreach(var directory in Directory.EnumerateDirectories(source))CopyDirectory(directory,Path.Combine(target,Path.GetFileName(directory)));
    }
    public static AppSettings LoadSettings() { try { return (JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(SettingsPath), Json) ?? new()).NormalizePresentation(); } catch { return new(); } }
    public static string DefaultSaveDirectory() => ExistingSaveDirectory(
        Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile));
    internal static string ExistingSaveDirectory(string? documents, string? profile)
    {
        // Never use the install folder or its Data directory as a document default.
        if (!string.IsNullOrWhiteSpace(documents) && Directory.Exists(documents)) return documents;
        if (!string.IsNullOrWhiteSpace(profile) && Directory.Exists(profile)) return profile;
        return ""; // Let the Windows dialog select its normal user location.
    }
    private static readonly object LogLock = new();
    private static readonly Encoding LogEncoding = new UTF8Encoding(false);
    internal const long MaxLogBytes = 1024 * 1024;
    public static void Log(Exception ex) => LogAt(Root, ex, Environment.GetFolderPath(Environment.SpecialFolder.UserProfile));
    internal static void LogAt(string directory, Exception ex, string? userProfile)
    {
        try
        {
            var message = ex.ToString();
            if (!string.IsNullOrWhiteSpace(userProfile)) message = message.Replace(userProfile, "[user]", StringComparison.OrdinalIgnoreCase);
            // A single unusually large exception must not defeat the rotation limit.
            if (message.Length > 32768) message = message[..32768] + " …";
            var entry = DateTimeOffset.Now + " " + message + Environment.NewLine;
            lock (LogLock)
            {
                Directory.CreateDirectory(directory);
                var path = Path.Combine(directory, "errors.log");
                if (File.Exists(path) && new FileInfo(path).Length + LogEncoding.GetByteCount(entry) > MaxLogBytes)
                {
                    // The active file plus two archived files retain at most three recent logs.
                    var older = path + ".1";
                    if (File.Exists(older)) File.Move(older, path + ".2", true);
                    File.Move(path, older, true);
                }
                File.AppendAllText(path, entry, LogEncoding);
            }
        }
        catch { /* Logging must never replace the original error. */ }
    }
    public static async Task AtomicText(string path, string text) => await AtomicBytes(path, Encoding.UTF8.GetBytes(text));
    public static async Task AtomicBytes(string path, byte[] bytes)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temp = path + ".mdsplit-" + Guid.NewGuid().ToString("N") + ".tmp";
        var tempCreated = false;
        try
        {
            // Never silently replace the link itself with a regular file. In
            // particular, File.Exists is false for some dangling links.
            _ = ExistingRegularDestination(path);
            await using (var output = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 65536, FileOptions.Asynchronous | FileOptions.SequentialScan))
            {
                tempCreated = true;
                await output.WriteAsync(bytes);
                await output.FlushAsync();
            }
            // Recheck after writing: if another program changed the destination
            // to a reparse point meanwhile, refuse rather than replace it.
            if (ExistingRegularDestination(path)) File.Replace(temp, path, null);
            else File.Move(temp, path, false);
        }
        finally { if (tempCreated && File.Exists(temp)) File.Delete(temp); }
    }
    private static bool ExistingRegularDestination(string path)
    {
        try
        {
            var attributes = File.GetAttributes(path);
            if ((attributes & FileAttributes.ReparsePoint) != 0)
                throw new IOException("シンボリックリンクなどの再解析ポイントには保存できません。リンク先のファイルを直接開いて保存してください。");
            if ((attributes & FileAttributes.Directory) != 0)
                throw new IOException("保存先はファイルではありません。");
            return true;
        }
        catch (FileNotFoundException) { return false; }
        catch (DirectoryNotFoundException) { return false; }
    }
    public static string Hash(byte[] data) => Convert.ToHexString(SHA256.HashData(data));
    public static DocumentData ReadFile(string path, string? id = null, string? forceEncoding = null)
    {
        path = Path.GetFullPath(path);
        var info = new FileInfo(path);
        if (!FileSizeApproved(path, info.Length)) throw new IOException("大きなファイルを開くには確認が必要です。");
        var bytes = File.ReadAllBytes(path);
        if (!FileSizeApproved(path, bytes.LongLength)) throw new IOException("ファイルのサイズが変わりました。開き直してください。");
        var decoded = TextCodec.Decode(bytes, forceEncoding);
        return new DocumentData
        {
            Id = id ?? Guid.NewGuid().ToString(), Path = path, Name = System.IO.Path.GetFileName(path),
            Text = decoded.Text, SavedText = decoded.Text, Encoding = decoded.Encoding, SavedEncoding = decoded.Encoding,
            HasBom = decoded.HasBom, SavedHasBom = decoded.HasBom, EncodingGuessed = decoded.EncodingGuessed,
            EncodingNotice = decoded.EncodingNotice, Format = TextFileTypes.FormatFor(path), Fingerprint = Hash(bytes)
        };
    }
    public static byte[] Encode(string text, string encoding, bool? hasBom = null) => TextCodec.Encode(text, encoding, hasBom);
    public static async Task<byte[]> EncodeDocument(string text, DocumentData document)
    {
        var encoding = TextCodec.CanonicalId(document.Encoding);
        var savedEncoding = document.SavedEncoding is null ? encoding : TextCodec.CanonicalId(document.SavedEncoding);
        var bom = document.HasBom ?? TextCodec.DefaultBom(encoding);
        var savedBom = document.SavedHasBom ?? TextCodec.DefaultBom(savedEncoding);
        // Some legacy encodings have multiple byte representations for the same character.
        // Keep the exact original bytes when content/encoding/BOM have not changed.
        if (text == document.SavedText && encoding == savedEncoding && bom == savedBom && document.Path is not null && document.Fingerprint is not null && File.Exists(document.Path))
        {
            var info = new FileInfo(document.Path);
            if (FileSizeApproved(document.Path, info.Length))
            {
                var bytes = await File.ReadAllBytesAsync(document.Path);
                if (Hash(bytes) == document.Fingerprint) return bytes;
            }
        }
        return Encode(text, encoding, document.HasBom);
    }
    public static DocumentData ReloadDocument(DocumentData document)
    {
        if (document.Path is null) throw new IOException("元ファイルが見つかりません。");
        var result = ReadFile(document.Path, document.Id, document.SavedEncoding ?? document.Encoding);
        result.EncodingGuessed = document.EncodingGuessed;
        result.EncodingNotice = document.EncodingNotice;
        result.PreviewViewMode = document.PreviewViewMode is "source" or "preview" ? document.PreviewViewMode : "split";
        return result;
    }
    public static bool CanReloadUnchangedRecovery(DocumentData document)
    {
        if (document.Text != document.SavedText) return false;
        try
        {
            var encoding = TextCodec.CanonicalId(document.Encoding);
            var savedEncoding = document.SavedEncoding is null ? encoding : TextCodec.CanonicalId(document.SavedEncoding);
            if (encoding != savedEncoding) return false;
            var currentBom = document.HasBom ?? TextCodec.DefaultBom(encoding);
            // Older recovery files did not carry separate BOM metadata. An
            // explicitly observed BOM value is their baseline, otherwise use
            // the encoding's former default, without dropping an edited BOM.
            var savedBom = document.SavedHasBom ?? document.HasBom ?? TextCodec.DefaultBom(savedEncoding);
            return currentBom == savedBom;
        }
        catch (IOException) { return false; }
    }
    public static string AssetsDirectory(string documentPath) => Path.Combine(Path.GetDirectoryName(documentPath)!, Path.GetFileNameWithoutExtension(documentPath) + ".assets");
    public static string UrlPath(string path) => string.Join("/",path.Replace('\\','/').Split('/').Select(Uri.EscapeDataString));
    public static string StagingDirectory(string id)
    {
        if (!Guid.TryParse(id, out _)) throw new IOException("文書IDが正しくありません。");
        return Path.Combine(Root, "Images", id);
    }
    internal const int MaxPreviewImageBytes = 32 * 1024 * 1024;
    internal static async Task<byte[]> ReadPreviewImageAsync(string path, CancellationToken cancellation = default)
    {
        // Open asynchronously so a slow disk does not block the WebView thread.
        // Recheck while reading because a file can grow after its initial stat.
        await using var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 65536, FileOptions.Asynchronous | FileOptions.SequentialScan);
        if (input.Length > MaxPreviewImageBytes) throw new IOException("画像は1枚32MBまでプレビューできます。");
        using var output = new MemoryStream((int)input.Length);
        var buffer = new byte[65536];
        while (true)
        {
            var count = await input.ReadAsync(buffer, cancellation);
            if (count == 0) break;
            if (output.Length + count > MaxPreviewImageBytes) throw new IOException("画像は1枚32MBまでプレビューできます。");
            output.Write(buffer, 0, count);
        }
        return output.ToArray();
    }
    public static string? ResolveImage(DocumentData doc, string url)
    {
        if (url.StartsWith("mdsplit-asset://", StringComparison.OrdinalIgnoreCase))
        {
            var uri = new Uri(url); if (!uri.Host.Equals(doc.Id, StringComparison.OrdinalIgnoreCase)) return null;
            return Path.Combine(StagingDirectory(doc.Id), Path.GetFileName(Uri.UnescapeDataString(uri.AbsolutePath)));
        }
        if (doc.Path is null) return null;
        if(Uri.TryCreate(url,UriKind.Absolute,out var absolute))return absolute.IsFile&&!absolute.IsUnc&&(absolute.Host.Length==0||absolute.Host=="localhost")&&!IsNetworkPath(absolute.LocalPath)?absolute.LocalPath:null;
        url = Uri.UnescapeDataString(url).Replace('/', Path.DirectorySeparatorChar);
        if(IsNetworkPath(url))return null;
        var path=Path.GetFullPath(Path.Combine(Path.GetDirectoryName(doc.Path)!, url));return IsNetworkPath(path)?null:path;
    }
    private static bool IsNetworkPath(string path)=>path.StartsWith(@"\\")||path.StartsWith("//");
    internal const string AssociationProgId = "MD.Split.Markdown"; // Preserve existing .md choices across updates.
    internal const string RegisteredApplicationName = "MD Split";
    // The per-user app deep link is supported only on updated Windows 11;
    // older builds must use the general Default Apps page.
    internal static bool SupportsRegisteredAppUri(int build, int revision) => build >= 22631 || build >= 22621 && revision >= 1555 || build == 22000 && revision >= 1817;
    internal static string DefaultAppsSettingsUri(bool appPageSupported) => appPageSupported
        ? "ms-settings:defaultapps?registeredAppUser=" + Uri.EscapeDataString(RegisteredApplicationName)
        : "ms-settings:defaultapps";
    internal static string CurrentDefaultAppsSettingsUri()
    {
        try
        {
            using var current=Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
            var revision=current?.GetValue("UBR") is int value ? value : 0;
            return DefaultAppsSettingsUri(SupportsRegisteredAppUri(Environment.OSVersion.Version.Build, revision));
        }
        catch { return DefaultAppsSettingsUri(false); }
    }
    public static void RegisterAssociation()
    {
        var exe = Environment.ProcessPath ?? throw new IOException("実行ファイルが見つかりません。");
        const string progId = AssociationProgId;
        using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Classes\" + progId))
        {
            key.SetValue("", "MD-CSV Split Editor Document");
            using var icon = key.CreateSubKey("DefaultIcon"); icon.SetValue("", "\"" + exe + "\",0");
            using var command = key.CreateSubKey(@"shell\open\command"); command.SetValue("", "\"" + exe + "\" \"%1\"");
        }
        foreach (var ext in TextFileTypes.SupportedExtensions)
        {
            using var key = Registry.CurrentUser.CreateSubKey(@"Software\Classes\" + ext + @"\OpenWithProgids"); key.SetValue(progId, "");
        }
        using (var cap = Registry.CurrentUser.CreateSubKey(@"Software\MD Split\Capabilities"))
        {
            cap.SetValue("ApplicationName", AppInfo.Title); cap.SetValue("ApplicationDescription", "Text, Markdown and CSV editor");
            using var types = cap.CreateSubKey("FileAssociations"); foreach (var ext in TextFileTypes.SupportedExtensions) types.SetValue(ext, progId);
        }
        using (var registered = Registry.CurrentUser.CreateSubKey(@"Software\RegisteredApplications")) registered.SetValue(RegisteredApplicationName, @"Software\MD Split\Capabilities");
        NotifyAssociationsChanged();
    }
    internal static void NotifyAssociationsChanged() => SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero);
    [DllImport("shell32.dll")] private static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2);
}

internal sealed class AppSettings
{
    public string SessionPolicy { get; set; } = "clear";
    public string StartupFormat { get; set; } = "md";
    public string OpenPolicy { get; set; } = "tabs";
    public string Theme { get; set; } = "dark";
    public string ColorTheme { get; set; } = "black";
    public bool SoftBreaks { get; set; } = true;
    public bool ShowLineBreaks { get; set; }
    public bool DistinguishLineBreaks { get; set; } = true;
    public bool ShowFullWidthSpaces { get; set; }
    public bool ShowTabs { get; set; }
    public bool ShowSpaces { get; set; }
    public int FontSize { get; set; } = 15;
    public bool Wrap { get; set; } = true;
    public string? WrapMode { get; set; }
    public int WrapColumn { get; set; } = 80;
    public bool Sync { get; set; } = true;
    public bool OutlineVisible { get; set; } = true;
    public string ViewMode { get; set; } = "split";
    public string DefaultViewMode { get; set; } = "last";
    public Dictionary<string, FileTypePresentation> FileTypeSettings { get; set; } = new();
    public bool WelcomeShown { get; set; }
    public Dictionary<string, WhitespaceStyle> WhitespaceStyles { get; set; } = WhitespaceStyle.Defaults();
    public int UpdateCheckDays { get; set; } = 7;
    public double Ratio { get; set; } = .47;
    public int Limit { get; set; } = 2000;
    public AppSettings NormalizePresentation()
    {
        SessionPolicy = SessionPolicy is "all" or "active" ? SessionPolicy : "clear";
        StartupFormat = StartupFormat is "md" or "csv" or "txt" or "html" or "json" or "tsv" or "xml" ? StartupFormat : "md";
        ViewMode = ViewMode is "source" or "preview" ? ViewMode : "split";
        DefaultViewMode = DefaultViewMode is "split" or "source" or "preview" ? DefaultViewMode : "last";
        var fileTypes = FileTypeSettings;
        FileTypeSettings = new();
        foreach (var kind in new[] { "markdown", "csv", "tsv", "html" })
        {
            FileTypePresentation? entry = null;
            fileTypes?.TryGetValue(kind, out entry);
            FileTypeSettings[kind] = new FileTypePresentation
            {
                ViewMode = entry?.ViewMode is "split" or "source" or "preview" ? entry.ViewMode : ViewMode,
                DefaultViewMode = entry?.DefaultViewMode is "last" or "split" or "source" or "preview" ? entry.DefaultViewMode : DefaultViewMode,
                OutlineVisible = (kind is "markdown" or "html") && (entry?.OutlineVisible ?? OutlineVisible),
                Sync = kind != "html" && (entry?.Sync ?? Sync)
            };
        }
        var input = WhitespaceStyles;
        WhitespaceStyles = WhitespaceStyle.Defaults();
        foreach (var key in WhitespaceStyles.Keys.ToArray())
        {
            if (input is null || !input.TryGetValue(key, out var style) || style is null) continue;
            WhitespaceStyles[key] = new WhitespaceStyle
            {
                Color = style.Color is { Length: 7 } color && color[0] == '#' && color.AsSpan(1).IndexOfAnyExcept("0123456789abcdefABCDEF") < 0 ? color : "#87909a",
                Opacity = double.IsFinite(style.Opacity) ? Math.Clamp(style.Opacity, .1, 1) : WhitespaceStyles[key].Opacity
            };
        }
        return this;
    }
}
internal sealed class FileTypePresentation
{
    public string? ViewMode { get; set; }
    public string? DefaultViewMode { get; set; }
    public bool? OutlineVisible { get; set; }
    public bool? Sync { get; set; }
}
internal sealed class WhitespaceStyle
{
    public string Color { get; set; } = "#87909a";
    public double Opacity { get; set; } = .45;
    public static Dictionary<string, WhitespaceStyle> Defaults() => new()
    {
        ["lineBreak"] = new(), ["wideSpace"] = new() { Opacity = .4 }, ["tab"] = new() { Opacity = .4 }, ["space"] = new() { Opacity = .3 }
    };
}
internal sealed class DocumentData
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Text { get; set; } = "";
    public string SavedText { get; set; } = "";
    public string? Path { get; set; }
    public bool? NeedsInitialSave { get; set; }
    public string Name { get; set; } = "無題.md";
    public string Encoding { get; set; } = "utf8";
    public string? SavedEncoding { get; set; }
    public bool? HasBom { get; set; }
    public bool? SavedHasBom { get; set; }
    public bool EncodingGuessed { get; set; }
    public string? EncodingNotice { get; set; }
    public string Format { get; set; } = "markdown";
    public string PreviewViewMode { get; set; } = "split";
    public string? Fingerprint { get; set; }
}
internal sealed class RecoveryData
{
    public List<DocumentData> Documents { get; set; } = [];
    public string Mode { get; set; } = "normal";
    public string? ActiveId { get; set; }
    public string? Reason { get; set; }
}
internal sealed class ImageReference
{
    public int From { get; set; }
    public int To { get; set; }
    public string Url { get; set; } = "";
    public int UrlFrom { get; set; }
    public int UrlTo { get; set; }
}
