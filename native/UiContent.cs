namespace MdSplit;

// Shared native window and system-registration title.
internal static class AppInfo
{
    public const string Title = "MD-CSV Split Editor";
}

internal static class UiContent
{
    public const string HostName = "app.mdsplit.local";
    public const string Origin = "https://" + HostName + "/";
    public const string EntryFileName = "index.html";
    public static string EntryUrl => Origin + EntryFileName;

    public static string GetFolder(string applicationDirectory)
    {
        var folder = Path.GetFullPath(Path.Combine(applicationDirectory, "wwwroot"));
        var entry = Path.Combine(folder, EntryFileName);
        if (!File.Exists(entry))
            throw new FileNotFoundException("画面ファイルが見つかりません。セットアップを再実行して修復するか、再インストールしてください。\n" + entry, entry);
        return folder;
    }

    // A folder mapping serves files; it does not supply a default index page.
    public static void Navigate(Action<string> navigate) => navigate(EntryUrl);

    public static bool IsRootUrl(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) &&
        uri.Scheme == "https" && uri.IsDefaultPort &&
        uri.Host.Equals(HostName, StringComparison.OrdinalIgnoreCase) &&
        uri.AbsolutePath == "/";
}
