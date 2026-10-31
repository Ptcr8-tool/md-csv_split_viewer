using MdSplit;
using System.Text;
using System.Text.Json;

internal static class TextFileChecks
{
    public static async Task Run(string root, Action<bool, string> assert)
    {
        var imported = new DocumentData { Name = "opened.csv", Text = "a,b", SavedText = "a,b", NeedsInitialSave = false };
        var importedRecovery = JsonSerializer.Deserialize<DocumentData>(JsonSerializer.Serialize(imported, Storage.Json), Storage.Json)!;
        assert(importedRecovery.Path is null && importedRecovery.NeedsInitialSave == false, "browser imported files retain their known saved baseline through native recovery");
        var olderRecovery = JsonSerializer.Deserialize<DocumentData>("{\"name\":\"old.md\",\"text\":\"recovered\",\"savedText\":\"recovered\"}", Storage.Json)!;
        assert(olderRecovery.NeedsInitialSave is null, "older recovery retains unknown initial-save state for backward-compatible prompting");
        foreach (var extension in new[] { "txt", "html", "json", "csv", "tsv", "xml", "js", "css", "yaml", "log" })
        {
            var path = Path.Combine(root, "plain." + extension);
            var text = "# literal Markdown\r\n![image](do-not-move.png)\n日本語 <script>literal</script>";
            await File.WriteAllTextAsync(path, text, new UTF8Encoding(false, true));
            var doc = Storage.ReadFile(path);
            assert(doc.Text == text && doc.Format != "markdown" && doc.Name == "plain." + extension && doc.HasBom == false, "general text loads without Markdown conversion: " + extension);
            assert(!TextFileTypes.ShouldMigrateImages(doc, Path.Combine(root, "copy.md")) && !TextFileTypes.ShouldMigrateImages(doc, Path.Combine(root, "copy." + extension)), "non-Markdown document never migrates image-like text: " + extension);
            var spec = TextFileTypes.SaveDialogFor(doc.Name);
            var selectedPattern = spec.Filter.Split('|')[spec.FilterIndex * 2 - 1];
            assert(spec.DefaultExtension == extension && selectedPattern.Split(';')[0] == "*." + extension && spec.FileName == "plain", "Save As starts at the original extension while permitting GUI type selection: " + extension);
        }
        assert(TextFileTypes.ShouldMigrateImages(new DocumentData { Name = "note.MD" }, "copy.markdown") && !TextFileTypes.ShouldMigrateImages(new DocumentData { Name = "note.md" }, "copy.txt"), "managed image migration requires Markdown source and Markdown destination");
        var alias = TextFileTypes.SaveDialogFor("note.markdown");
        assert(alias.DefaultExtension == "markdown" && alias.Filter.Split('|')[alias.FilterIndex * 2 - 1].StartsWith("*.markdown;"), "Markdown alias extension survives Save As defaults");
        var custom = TextFileTypes.SaveDialogFor("settings.custom");
        assert(custom.DefaultExtension == "custom" && custom.FilterIndex == 1 && custom.Filter.Split('|')[1] == "*.custom", "unknown text extension is retained rather than replaced with md");
        var unusual = TextFileTypes.SaveDialogFor("note.foo;bar");
        assert(unusual.FileName == "note.foo;bar" && unusual.DefaultExtension == "" && unusual.Filter == "すべてのファイル (*.*)|*.*", "unusual extension cannot alter the save filter or lose part of its name");
        var extensionless = TextFileTypes.SaveDialogFor("README");
        assert(extensionless.FileName == "README" && extensionless.DefaultExtension == "" && extensionless.Filter.Split('|')[extensionless.FilterIndex * 2 - 1] == "*.*", "extensionless text retains its name and all-files filter");
        var dotfile = TextFileTypes.SaveDialogFor(".gitignore");
        assert(dotfile.FileName == ".gitignore" && dotfile.DefaultExtension == "" && TextFileTypes.ResolveSavePath(".gitignore", Path.Combine(root, ".gitignore"), dotfile.FilterIndex) == Path.Combine(root, ".gitignore"), "leading-dot text filename remains intact in Save As");
        assert(TextFileTypes.OpenFilter.Contains("*.txt") && TextFileTypes.OpenFilter.Contains("*.html") && TextFileTypes.OpenFilter.Contains("*.json") && TextFileTypes.OpenFilter.EndsWith("|*.*"), "Open dialog lists general text formats and all files");
        var extensions=TextFileTypes.SupportedExtensions;
        var filterExtensions=TextFileTypes.OpenFilter.Split('|')[1].Split(';').Select(p=>p[1..]).ToHashSet(StringComparer.OrdinalIgnoreCase);
        assert(extensions.Length>0 && extensions.Length==extensions.Distinct(StringComparer.OrdinalIgnoreCase).Count() && extensions.All(e=>e.Length>1&&e[0]=='.'&&e.Skip(1).All(char.IsAsciiLetterOrDigit)), "registered file extensions are unique and safe registry key names");
        assert(filterExtensions.SetEquals(extensions) && new[]{".md",".markdown",".txt",".csv",".tsv",".html",".json",".xml",".py"}.All(e=>extensions.Contains(e, StringComparer.OrdinalIgnoreCase)), "Windows Open With registration covers every explicitly supported file picker extension");
        assert(Storage.DefaultAppsSettingsUri(false)=="ms-settings:defaultapps" && Storage.DefaultAppsSettingsUri(true)=="ms-settings:defaultapps?registeredAppUser=MD%20Split", "Windows default-apps links use the matching per-user registration without setting a default");
        assert(!Storage.SupportsRegisteredAppUri(19045,5000) && !Storage.SupportsRegisteredAppUri(22000,1816) && Storage.SupportsRegisteredAppUri(22000,1817) && !Storage.SupportsRegisteredAppUri(22621,1554) && Storage.SupportsRegisteredAppUri(22621,1555) && Storage.SupportsRegisteredAppUri(22631,0), "the app-specific settings link is used only on Windows 11 builds that support it");
        foreach (var (ext, expected) in new[] { ("xhtml", "html"), ("json5", "json"), ("mts", "typescript"), ("scss", "scss"), ("less", "less"), ("py", "python"), ("vue", "vue"), ("svelte", "svelte"), ("swift", "swift"), ("kt", "kotlin"), ("lua", "lua"), ("pl", "perl"), ("log", "text") })
        {
            assert(TextFileTypes.FormatFor("document." + ext) == expected && TextFileTypes.FormatFor("C:\\folder\\FILE." + ext.ToUpperInvariant()) == expected, "native file type agrees with browser kind and accepts case-insensitive Windows paths: " + ext);
            var typedSpec = TextFileTypes.SaveDialogFor("document." + ext);
            assert(typedSpec.DefaultExtension == ext && typedSpec.Filter.Split('|')[typedSpec.FilterIndex * 2 - 1].StartsWith("*." + ext), "save dialog retains the actual extension: " + ext);
            assert(TextFileTypes.OpenFilter.Contains("*." + ext), "open dialog exposes supported text extension: " + ext);
        }
        var logSpec = TextFileTypes.SaveDialogFor("activity.log");
        assert(logSpec.Filter.Split('|')[(logSpec.FilterIndex - 1) * 2].StartsWith("ログ (") && logSpec.DefaultExtension == "log", "log keeps its dedicated save option while using the text kind");
        assert(TextFileTypes.FormatFor(".md") == "text" && TextFileTypes.FormatFor(".notes.md") == "markdown" && TextFileTypes.FormatFor("unknown.xyz") == "text", "native dotfiles and unknown extensions follow browser routing");
        var dotted = TextFileTypes.SaveDialogFor("a.b.json");
        assert(TextFileTypes.ResolveSavePath("a.b.json", Path.Combine(root, "a.b"), dotted.FilterIndex) == Path.Combine(root, "a.b.json"), "multi-dot Save As stem receives the actual selected extension");
        assert(TextFileTypes.ResolveSavePath("note.md", Path.Combine(root, "note.md"), 4) == Path.Combine(root, "note.json"), "GUI JSON type replaces a stale Markdown extension before overwrite confirmation");
        assert(TextFileTypes.ResolveSavePath("note.md", Path.Combine(root, "chosen.custom"), 4) == Path.Combine(root, "chosen.custom"), "explicit custom extension remains the user's choice");
        assert(TextFileTypes.ResolveSavePath("a.b.json", Path.Combine(root, "a.b"), dotted.Filter.Split('|').Length / 2) == Path.Combine(root, "a.b"), "all-files selection retains the exact requested multi-dot name");
        assert(TextFileTypes.NewDocument("無題.json").Format == "json" && TextFileTypes.NewDocument("note.custom").Name == "note.custom", "new-file requests accept general text names and preserve unknown extensions");
        foreach (var unsafeName in new[] { "../other.txt", "C:\\private\\note.txt", "bad|name.txt", "NUL.txt", "NUL.tar.gz", "CON", "COM1.backup.txt", "LPT9 .csv", "line\nbreak.md" })
            assert(TextFileTypes.NewDocument(unsafeName).Name == "無題.md", "unsafe new-file name falls back without creating or exposing a path");
        assert(TextFileTypes.NewDocument("COM10.notes.txt").Name == "COM10.notes.txt" && TextFileTypes.NewDocument("CONSOLE.txt").Name == "CONSOLE.txt", "ordinary names resembling reserved device names remain available");
        var duplicate = Path.Combine(root, "iso2022-alternate-designation.txt");
        var originalBytes = new byte[] { 0x1b, 0x24, 0x40, 0x46, 0x7c, 0x4b, 0x5c, 0x38, 0x6c, 0x1b, 0x28, 0x42 };
        await File.WriteAllBytesAsync(duplicate, originalBytes);
        var duplicateDoc = Storage.ReadFile(duplicate, forceEncoding: "iso2022jp");
        assert(!TextCodec.Encode(duplicateDoc.Text, duplicateDoc.Encoding).SequenceEqual(originalBytes), "legacy fixture has an alternative byte representation that canonical encoding would change");
        assert((await Storage.EncodeDocument(duplicateDoc.Text, duplicateDoc)).SequenceEqual(originalBytes), "unchanged legacy byte representation is preserved");
        duplicateDoc.Text += " changed";
        assert(!(await Storage.EncodeDocument(duplicateDoc.Text, duplicateDoc)).SequenceEqual(originalBytes), "changed legacy text is encoded instead of reusing stale bytes");
        duplicateDoc.Text = duplicateDoc.SavedText;
        duplicateDoc.Encoding = "utf8"; duplicateDoc.HasBom = false;
        assert((await Storage.EncodeDocument(duplicateDoc.Text, duplicateDoc)).SequenceEqual(new UTF8Encoding(false, true).GetBytes(duplicateDoc.Text)), "explicit encoding conversion does not reuse the original legacy bytes");
        var noBom = Path.Combine(root, "no-bom.json");
        await File.WriteAllBytesAsync(noBom, new UnicodeEncoding(false, false, true).GetBytes("{\"日本語\":true}\r\n"));
        var noBomDoc = Storage.ReadFile(noBom, forceEncoding: "utf16le");
        noBomDoc.PreviewViewMode = "source";
        var restored = JsonSerializer.Deserialize<DocumentData>(JsonSerializer.Serialize(noBomDoc, Storage.Json), Storage.Json)!;
        var reloaded = Storage.ReloadDocument(restored);
        assert(restored.HasBom == false && restored.SavedHasBom == false && restored.Format == "json" && reloaded.PreviewViewMode == "source" && reloaded.Text == restored.Text, "recovery and reload retain BOMless encoding, format and per-document preview mode");
        var restoredBytes = await Storage.EncodeDocument(restored.Text, restored);
        var noBomBytes = await File.ReadAllBytesAsync(noBom);
        assert(restoredBytes.SequenceEqual(noBomBytes), "unchanged BOMless Unicode bytes survive recovery and save");
        var bomOnly = new DocumentData { Text = "same", SavedText = "same", Encoding = "utf16le", SavedEncoding = "utf16le", HasBom = false, SavedHasBom = true };
        assert(!Storage.CanReloadUnchangedRecovery(bomOnly), "BOM-only unsaved conversion prevents disk reload from replacing recovery state");
        var bomSnapshot = JsonSerializer.Deserialize<DocumentData>(JsonSerializer.Serialize(bomOnly, Storage.Json), Storage.Json)!;
        assert(!Storage.CanReloadUnchangedRecovery(bomSnapshot) && bomSnapshot.HasBom == false && bomSnapshot.SavedHasBom == true, "BOM-only recovery remains dirty after serialization");
        assert(!Storage.CanReloadUnchangedRecovery(new DocumentData { Text = "edited", SavedText = "saved" }), "unsaved text prevents recovery disk reload");
        assert(!Storage.CanReloadUnchangedRecovery(new DocumentData { Encoding = "utf16be", SavedEncoding = "utf16le", HasBom = true, SavedHasBom = true }), "unsaved encoding choice prevents recovery disk reload");
        assert(Storage.CanReloadUnchangedRecovery(new DocumentData { Encoding = "utf16le", SavedEncoding = "utf16le", HasBom = false, SavedHasBom = false }), "unchanged BOMless recovery can refresh clean text from disk");
        assert(Storage.CanReloadUnchangedRecovery(new DocumentData { Encoding = "utf16le" }) && Storage.CanReloadUnchangedRecovery(new DocumentData { Encoding = "utf8", HasBom = false }), "old nullable encoding and BOM metadata remain backward compatible");
        assert(!Storage.CanReloadUnchangedRecovery(new DocumentData { Encoding = "unsupported" }), "unrecognized recovery encoding is retained rather than reloaded with a fallback");
        assert(EditorAccelerators.CommandFor(0x53, true, false, false) == "save" && EditorAccelerators.CommandFor(0x53, true, false, true) == "saveas" && EditorAccelerators.CommandFor(0x46, true, false, false) == "search" && EditorAccelerators.CommandFor(0x48, true, false, false) == "replace", "native editor shortcuts map save, Save As, search and replace");
        assert(EditorAccelerators.CommandFor(0x53, true, true, false) is null && EditorAccelerators.CommandFor(0x53, false, false, false) is null && EditorAccelerators.CommandFor(0x52, true, false, false) is null, "native shortcut routing excludes AltGr, text typing and browser refresh");
    }
}
