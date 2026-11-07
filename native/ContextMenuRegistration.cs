using Microsoft.Win32;

namespace MdSplit;

// Per-user Explorer verbs; never set extension defaults or protected UserChoice.
internal static class ContextMenuRegistration
{
    private const string Root = @"Software\Classes\SystemFileAssociations\";
    private const string Verb = @"\shell\MD.Split.Open";
    private static string Executable => Environment.ProcessPath ?? throw new IOException("実行ファイルが見つかりません。");
    private static string Command => '"' + Executable + "\" \"%1\"";
    private static string KeyPath(string ext) => Root + ext + Verb;
    private static string? ExistingCommand(string ext)
    {
        using var command = Registry.CurrentUser.OpenSubKey(KeyPath(ext) + @"\command");
        return command?.GetValue(null) as string;
    }
    private static bool Owned(string ext) => string.Equals(ExistingCommand(ext), Command, StringComparison.OrdinalIgnoreCase);

    public static object Status()
    {
        var extensions = TextFileTypes.SupportedExtensions;
        var count = extensions.Count(Owned);
        return new { enabled = count == extensions.Length, partial = count > 0 && count < extensions.Length };
    }
    public static object Set(bool enabled)
    {
        var extensions = TextFileTypes.SupportedExtensions;
        if (enabled)
        {
            // Refuse to overwrite another installation or an unrelated key.
            foreach (var ext in extensions)
            {
                using var existing = Registry.CurrentUser.OpenSubKey(KeyPath(ext));
                if (existing is not null && !Owned(ext))
                    throw new IOException("別のインストールが右クリックメニューを使用しています。先にそちらの設定を解除してください。");
            }
            foreach (var ext in extensions)
            {
                using var verb = Registry.CurrentUser.CreateSubKey(KeyPath(ext));
                verb.SetValue("MUIVerb", "MD-CSV Split Editor で開く");
                verb.SetValue("Icon", '"' + Executable + "\",0");
                verb.SetValue("MultiSelectModel", "Single");
                using var command = verb.CreateSubKey("command");
                command.SetValue("", Command);
            }
        }
        else
        {
            foreach (var ext in extensions)
                if (Owned(ext)) Registry.CurrentUser.DeleteSubKeyTree(KeyPath(ext), false);
        }
        Storage.NotifyAssociationsChanged();
        return Status();
    }
}
