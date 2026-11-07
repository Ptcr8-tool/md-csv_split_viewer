using Microsoft.Win32;

namespace MdSplit;

// Per-user Explorer verbs; never modify extension defaults or protected UserChoice.
internal static class ContextMenuRegistration
{
    private const string Root = @"Software\Classes\";
    private const string LegacyRoot = Root + @"SystemFileAssociations\";
    private const string LegacyVerb = @"\shell\MD.Split.Open";
    private const string FileKey = Root + @"*\shell\MD.Split.Open";
    private const string BackgroundKey = Root + @"Directory\Background\shell\MD.Split.New";
    private const string FolderKey = Root + @"Directory\shell\MD.Split.New";
    private static string Executable => Environment.ProcessPath ?? throw new IOException("実行ファイルが見つかりません。");
    private static string OpenCommand => '"' + Executable + "\" \"%1\"";
    private static string BackgroundCommand => '"' + Executable + "\" --new-in-directory \"%V\"";
    private static string FolderCommand => '"' + Executable + "\" --new-in-directory \"%1\"";
    private static string LegacyKey(string ext) => LegacyRoot + ext + LegacyVerb;
    private static string? ExistingCommand(string path)
    {
        using var key = Registry.CurrentUser.OpenSubKey(path + @"\command");
        return key?.GetValue(null) as string;
    }
    private static bool Owned(string path, string expected) => string.Equals(ExistingCommand(path), expected, StringComparison.OrdinalIgnoreCase);
    private static (string Key, string Command, string Title)[] Entries() =>
    [
        (FileKey, OpenCommand, "MD-CSV Split Editor で開く"),
        (BackgroundKey, BackgroundCommand, "MD-CSV Split Editor で新規作成"),
        (FolderKey, FolderCommand, "MD-CSV Split Editor で新規作成")
    ];

    public static object Status()
    {
        var entries = Entries();
        var count = entries.Count(entry => Owned(entry.Key, entry.Command));
        var legacy = TextFileTypes.SupportedExtensions.Any(ext => Owned(LegacyKey(ext), OpenCommand));
        return new { enabled = count == entries.Length && !legacy, partial = count > 0 && count < entries.Length || legacy };
    }
    public static void MigrateLegacy()
    {
        if (TextFileTypes.SupportedExtensions.Any(ext => Owned(LegacyKey(ext), OpenCommand))) Set(true);
    }
    public static object Set(bool enabled)
    {
        var entries = Entries();
        if (enabled)
        {
            foreach (var entry in entries)
            {
                using var existing = Registry.CurrentUser.OpenSubKey(entry.Key);
                if (existing is not null && !Owned(entry.Key, entry.Command))
                    throw new IOException("別のインストールが右クリックメニューを使用しています。先にそちらの設定を解除してください。");
            }
            foreach (var entry in entries)
            {
                using var verb = Registry.CurrentUser.CreateSubKey(entry.Key);
                verb.SetValue("MUIVerb", entry.Title);
                verb.SetValue("Icon", '"' + Executable + "\",0");
                verb.SetValue("MultiSelectModel", "Single");
                using var command = verb.CreateSubKey("command");
                command.SetValue("", entry.Command);
            }
        }
        else
            foreach (var entry in entries)
                if (Owned(entry.Key, entry.Command)) Registry.CurrentUser.DeleteSubKeyTree(entry.Key, false);
        // Remove only this installation's legacy per-extension verbs.
        foreach (var ext in TextFileTypes.SupportedExtensions)
            if (Owned(LegacyKey(ext), OpenCommand)) Registry.CurrentUser.DeleteSubKeyTree(LegacyKey(ext), false);
        Storage.NotifyAssociationsChanged();
        return Status();
    }
}
