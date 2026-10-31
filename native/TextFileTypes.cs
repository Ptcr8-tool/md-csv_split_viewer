namespace MdSplit;

internal static class TextFileTypes
{
    private sealed record Kind(string Label, string[] Extensions, string Format);
    private static readonly Kind[] Kinds =
    [
        new("Markdown", ["md", "markdown"], "markdown"),
        new("テキスト", ["txt", "text"], "text"),
        new("HTML", ["html", "htm", "xhtml"], "html"),
        new("JSON", ["json", "jsonc", "json5"], "json"),
        new("CSV", ["csv"], "csv"), new("TSV", ["tsv"], "tsv"),
        new("XML", ["xml", "svg", "xsd", "xsl", "xslt"], "xml"),
        new("JavaScript", ["js", "mjs", "cjs", "jsx"], "javascript"),
        new("TypeScript", ["ts", "mts", "cts", "tsx"], "typescript"),
        new("CSS", ["css"], "css"),
        new("SCSS / Sass", ["scss", "sass"], "scss"),
        new("Less", ["less"], "less"),
        new("YAML", ["yaml", "yml"], "yaml"),
        // Logs remain a separate choice in the Windows dialog but use the same text kind as the editor.
        new("ログ", ["log"], "text"),
        new("TOML", ["toml"], "toml"),
        new("設定ファイル", ["ini", "cfg", "conf", "properties"], "ini"),
        new("その他の設定", ["config"], "text"),
        new("Python", ["py", "pyw", "pyi"], "python"),
        new("Ruby", ["rb"], "ruby"),
        new("PHP", ["php"], "php"),
        new("SQL", ["sql"], "sql"),
        new("Shell", ["sh", "bash", "zsh"], "shell"),
        new("PowerShell", ["ps1", "psm1", "psd1"], "powershell"),
        new("バッチ", ["bat", "cmd"], "batch"),
        new("C", ["c", "h"], "c"),
        new("C++", ["cpp", "cxx", "cc", "hpp", "hxx"], "cpp"),
        new("C#", ["cs"], "csharp"),
        new("Java", ["java"], "java"),
        new("Go", ["go"], "go"),
        new("Rust", ["rs"], "rust"),
        new("Swift", ["swift"], "swift"),
        new("Kotlin", ["kt", "kts"], "kotlin"),
        new("R", ["r"], "r"),
        new("Lua", ["lua"], "lua"),
        new("Perl", ["pl", "pm"], "perl"),
        new("Vue", ["vue"], "vue"),
        new("Svelte", ["svelte"], "svelte")
    ];
    // The file picker, Windows "Open with" candidates and Default Apps must
    // agree on the explicitly supported extensions. The all-files picker can
    // still open additional text files without claiming arbitrary extensions.
    public static string[] SupportedExtensions => Kinds.SelectMany(k => k.Extensions).Select(e => "." + e).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    public static string OpenFilter => "テキスト・ソースファイル|" + string.Join(";", Kinds.SelectMany(k => k.Extensions).Select(e => "*." + e)) + "|すべてのファイル (*.*)|*.*";
    public static string FormatFor(string? pathOrName)
    {
        // Match the browser's basename and dotfile handling on every host OS.
        var name = (pathOrName ?? "").Replace('\\', '/').Split('/').Last();
        var dot = name.LastIndexOf('.');
        if (dot < 1) return "text";
        var extension = name[(dot + 1)..];
        return Kinds.FirstOrDefault(k => k.Extensions.Contains(extension, StringComparer.OrdinalIgnoreCase))?.Format ?? "text";
    }
    public static bool IsMarkdown(string? pathOrName) => FormatFor(pathOrName) == "markdown";
    public static DocumentData NewDocument(string? name = null)
    {
        name = string.IsNullOrWhiteSpace(name) ? "無題.md" : name.Trim();
        var invalid = name.Length > 200 || name is "." or ".." || name.EndsWith('.') || name.Any(c => char.IsControl(c) || "<>:\"/\\|?*".Contains(c));
        // Windows reserves device names even when followed by multiple extensions.
        var stem = name.Split('.')[0].TrimEnd(' ').ToUpperInvariant();
        if (stem is "CON" or "PRN" or "AUX" or "NUL" || stem.Length == 4 && (stem.StartsWith("COM") || stem.StartsWith("LPT")) && stem[3] is >= '1' and <= '9') invalid = true;
        if (invalid) name = "無題.md";
        return new DocumentData { Name = name, Format = FormatFor(name), Encoding = "utf8", SavedEncoding = "utf8", HasBom = false, SavedHasBom = false };
    }
    public static bool ShouldMigrateImages(DocumentData document, string destination) => IsMarkdown(document.Path ?? document.Name) && IsMarkdown(destination);
    public sealed record SaveSpec(string FileName, string DefaultExtension, string Filter, int FilterIndex);
    public static string ResolveSavePath(string originalName, string selectedPath, int filterIndex)
    {
        var spec = SaveDialogFor(originalName);
        var filters = spec.Filter.Split('|');
        if (filterIndex < 1 || filterIndex * 2 > filters.Length) throw new IOException("保存形式を選び直してください。");
        var pattern = filters[filterIndex * 2 - 1].Split(';')[0];
        if (pattern == "*.*") return selectedPath;
        var selectedExtension = pattern[2..];
        // A stem such as a.b is otherwise mistaken for an explicit .b extension.
        if (Path.GetFileName(selectedPath).Equals(spec.FileName, StringComparison.OrdinalIgnoreCase)) return selectedPath + "." + selectedExtension;
        var originalExtension = Path.GetExtension(originalName);
        if (filterIndex != spec.FilterIndex && originalExtension.Length > 0 && Path.GetExtension(selectedPath).Equals(originalExtension, StringComparison.OrdinalIgnoreCase))
            return Path.ChangeExtension(selectedPath, selectedExtension);
        return selectedPath;
    }
    public static SaveSpec SaveDialogFor(string name)
    {
        name = Path.GetFileName(name);
        var dotfileWithoutSuffix = name.StartsWith('.') && name.IndexOf('.', 1) < 0;
        var extension = dotfileWithoutSuffix ? "" : Path.GetExtension(name).TrimStart('.').ToLowerInvariant();
        if (extension.Length > 0 && extension.Any(c => c is ';' or '|' or '*' or '?'))
            return new(name, "", "すべてのファイル (*.*)|*.*", 1);
        var kindIndex = Array.FindIndex(Kinds, k => k.Extensions.Contains(extension, StringComparer.OrdinalIgnoreCase));
        var filters = Kinds.Select(k =>
        {
            var extensions = k.Extensions.OrderByDescending(e => e.Equals(extension, StringComparison.OrdinalIgnoreCase)).ToArray();
            var patterns = string.Join(";", extensions.Select(e => "*." + e));
            return k.Label + " (" + patterns + ")|" + patterns;
        }).ToList();
        if (extension.Length > 0 && kindIndex < 0)
        {
            // Retain an arbitrary text extension without turning it into Markdown.
            filters.Insert(0, "現在の拡張子 (*." + extension + ")|*." + extension);
            kindIndex = 0;
        }
        filters.Add("すべてのファイル (*.*)|*.*");
        return new(extension.Length == 0 ? name : Path.GetFileNameWithoutExtension(name), extension,
            string.Join("|", filters), extension.Length == 0 ? filters.Count : kindIndex + 1);
    }
}
