namespace MdSplit;

internal static class UiLanguage
{
    public static string Current { get; set; } = SystemDefault();
    public static string SystemDefault()
    {
        var language = System.Globalization.CultureInfo.CurrentUICulture.TwoLetterISOLanguageName;
        return language == "ja" || string.IsNullOrEmpty(language) || language == "iv" ? "ja" : "en";
    }
    public static string T(string ja, string en) => Current == "ja" ? ja : en;
    // Translate labels only; never alter the paired extension patterns.
    public static string FileFilter(string value)
    {
        if (Current != "en") return value;
        var parts = value.Split('|');
        for (var i = 0; i < parts.Length; i += 2)
            parts[i] = parts[i].Replace("テキスト・ソースファイル", "Text and source files")
                .Replace("テキスト", "Text").Replace("ログ", "Log")
                .Replace("設定ファイル", "Configuration").Replace("その他の設定", "Other configuration")
                .Replace("バッチ", "Batch").Replace("現在の拡張子", "Current extension")
                .Replace("すべてのファイル", "All files");
        return string.Join("|", parts);
    }
}
