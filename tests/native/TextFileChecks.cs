using MdSplit;
using System.Text;
using System.Text.Json;

internal static class TextFileChecks
{
    // A seekable synthetic stream verifies offsets beyond 4 GiB without
    // allocating a multi-gigabyte fixture on the test machine.
    private sealed class LargeBinaryStream(long length) : Stream
    {
        private long position;
        public long LastSeek { get; private set; }
        public override bool CanRead => true;
        public override bool CanSeek => true;
        public override bool CanWrite => false;
        public override long Length => length;
        public override long Position { get => position; set => position = value; }
        public override int Read(byte[] buffer, int offset, int count)
        {
            var n = (int)Math.Min(count, length - position);
            Array.Fill(buffer, (byte)0xA5, offset, n);
            position += n;
            return n;
        }
        public override long Seek(long offset, SeekOrigin origin)
        {
            if (origin != SeekOrigin.Begin) throw new NotSupportedException();
            LastSeek = position = offset;
            return position;
        }
        public override void Flush() { }
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }

    public static async Task Run(string root, Action<bool, string> assert)
    {
        var binaryFixture = Path.Combine(root, "example.mp4");
        assert(BinaryPreview.IsKnownBinaryExtension(binaryFixture) && BinaryPreview.IsKnownBinaryExtension("VIDEO.MP4") && !BinaryPreview.IsKnownBinaryExtension("example.ics"), "known media extensions use bounded binary preview without probing the complete file");
        var binaryHeader = new byte[] { 0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0, 1, 2, 3 };
        await File.WriteAllBytesAsync(binaryFixture, binaryHeader);
        assert(BinaryPreview.IsProbablyBinary(binaryFixture), "MP4-like bytes are detected for a read-only preview");
        var binaryPrefix = BinaryPreview.ReadWindow(binaryFixture, 0, 10);
        assert(binaryPrefix.Length == binaryHeader.Length && binaryPrefix.Bytes.SequenceEqual(binaryHeader) && BinaryPreview.Format(binaryPrefix.Bytes, binaryPrefix.Offset).Contains("66 74 79 70"), "binary preview displays exact hex bytes");
        assert((await File.ReadAllBytesAsync(binaryFixture)).SequenceEqual(binaryHeader), "binary preview never modifies the source");
        var calendar = Path.Combine(root, "calendar.ics");
        await File.WriteAllTextAsync(calendar, "BEGIN:VCALENDAR\r\nSUMMARY:日本語\r\nEND:VCALENDAR\r\n", new UTF8Encoding(false));
        assert(!BinaryPreview.IsProbablyBinary(calendar), "ICS text remains editable");
        var empty = Path.Combine(root, "empty.txt");
        await File.WriteAllBytesAsync(empty, []);
        var emptyView = BinaryPreview.ReadWindow(empty, 99, 10);
        assert(!BinaryPreview.IsProbablyBinary(empty) && emptyView.Bytes.Length == 0 && emptyView.TopLine == 0 && emptyView.TotalLines == 1, "empty text remains editable and the binary view handles empty files");
        var largeBinary = Path.Combine(root, "large-preview.mp4");
        var tailMarker = new byte[] { 0xDE, 0xAD, 0xBE, 0xEF };
        using (var stream = File.Create(largeBinary)) { stream.Write(binaryHeader); stream.SetLength(65L * 1024 * 1024 + tailMarker.Length); stream.Seek(-tailMarker.Length, SeekOrigin.End); stream.Write(tailMarker); }
        var firstView = BinaryPreview.ReadWindow(largeBinary, 0, 24);
        var beyondOldLimit = BinaryPreview.ReadWindow(largeBinary, 65536 / BinaryPreview.BytesPerLine, 24);
        var endView = BinaryPreview.ReadWindow(largeBinary, long.MaxValue, 1);
        assert(firstView.Length == 65L * 1024 * 1024 + tailMarker.Length && firstView.Bytes.Length == 24 * BinaryPreview.BytesPerLine && firstView.Bytes.AsSpan(0, binaryHeader.Length).SequenceEqual(binaryHeader), "binary view reads only the visible part of a large file");
        assert(beyondOldLimit.Offset == 65536 && beyondOldLimit.Bytes.Length == 24 * BinaryPreview.BytesPerLine && BinaryPreview.Format(beyondOldLimit.Bytes, beyondOldLimit.Offset).StartsWith("00010000"), "binary view reaches beyond 64 KiB and displays absolute offsets");
        assert(endView.Offset == 65L * 1024 * 1024 && endView.Bytes.SequenceEqual(tailMarker), "binary view reaches the end of a large file and clamps an excessive position");
        assert(BinaryPreview.ReadWindow(largeBinary, -1, 1).TopLine == 0 && BinaryPreview.LineCount(16) == 1 && BinaryPreview.LineCount(17) == 2, "negative positions, exact line boundaries and one-byte remainders are handled");
        assert(BinaryPreview.LineCount(long.MaxValue) == 1 + (long.MaxValue - 1) / 16 && BinaryPreview.ScrollLine(1_000_000, BinaryPreview.LastTopLine(long.MaxValue, 24), 1_000_000) == BinaryPreview.LastTopLine(long.MaxValue, 24) && BinaryPreview.Format([0xAB], 0x100000000).StartsWith("100000000"), "scroll and offset calculations support very large files without overflow");
        using (var largeStream = new LargeBinaryStream(6L * 1024 * 1024 * 1024))
        {
            var offset = 5L * 1024 * 1024 * 1024;
            var distant = BinaryPreview.ReadWindow(largeStream, offset / BinaryPreview.BytesPerLine, 24);
            assert(largeStream.LastSeek == offset && distant.Offset == offset && distant.Bytes.Length == 24 * BinaryPreview.BytesPerLine && distant.Bytes[0] == 0xA5, "a view beyond 4 GiB seeks correctly and reads only visible lines");
            assert(BinaryPreview.Find(largeStream, [0xA5, 0xA5], offset, false, CancellationToken.None) == offset, "whole-file search accepts 64-bit offsets beyond 4 GiB");
        }
        assert(BinaryPreview.ReadWindow(largeBinary, 0, 1).Bytes.AsSpan(0, binaryHeader.Length).SequenceEqual(binaryHeader) && BinaryPreview.ReadWindow(largeBinary, long.MaxValue, 1).Bytes.SequenceEqual(tailMarker), "viewing distant positions never modifies file contents");
        var searchBytes = new byte[2 * BinaryPreview.SearchBlockBytes + 50];
        var marker = Encoding.UTF8.GetBytes("日本語-search");
        var firstMatch = BinaryPreview.SearchBlockBytes - 2;
        var secondMatch = searchBytes.Length - marker.Length;
        marker.CopyTo(searchBytes, firstMatch);
        marker.CopyTo(searchBytes, secondMatch);
        using (var searchStream = new MemoryStream(searchBytes, writable: false))
        {
            assert(BinaryPreview.Find(searchStream, marker, 0, false, CancellationToken.None) == firstMatch, "forward search finds UTF-8 bytes crossing a read boundary");
            assert(BinaryPreview.Find(searchStream, marker, firstMatch + 1, false, CancellationToken.None) == secondMatch, "forward search continues to a later match at the end of the file");
            assert(BinaryPreview.Find(searchStream, marker, long.MaxValue, true, CancellationToken.None) == secondMatch, "backward search finds a match at the end");
            assert(BinaryPreview.Find(searchStream, marker, secondMatch, true, CancellationToken.None) == firstMatch, "backward search excludes the current match and finds a boundary-spanning earlier match");
            assert(BinaryPreview.Find(searchStream, marker, firstMatch, true, CancellationToken.None) == -1 && BinaryPreview.Find(searchStream, [0xFF, 0xFE], 0, false, CancellationToken.None) == -1, "whole-file search reports missing matches in both directions");
            using var cancelled = new CancellationTokenSource();
            cancelled.Cancel();
            var wasCancelled = false;
            try { BinaryPreview.Find(searchStream, marker, 0, false, cancelled.Token); }
            catch (OperationCanceledException) { wasCancelled = true; }
            assert(wasCancelled, "whole-file search can be cancelled");
        }
        assert(BinaryPreview.IsNetworkPath(@"\\\\server\\share\\file") && BinaryPreview.IsNetworkPath("//server/share/file") && !BinaryPreview.IsNetworkPath("file.txt"), "network paths skip the synchronous preview probe");
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
        assert(extensions.Length>0 && extensions.Length==extensions.Distinct(StringComparer.OrdinalIgnoreCase).Count() && extensions.All(e=>e.Length>1&&e[0]=='.'&&e.Skip(1).All(char.IsAsciiLetterOrDigit)), "supported file extensions are unique and safe registry key names");
        assert(filterExtensions.SetEquals(extensions) && new[]{".md",".markdown",".txt",".csv",".tsv",".html",".json",".xml",".py",".bat",".cmd"}.All(e=>extensions.Contains(e, StringComparer.OrdinalIgnoreCase)), "Windows Open dialog preserves all supported editing formats including batch files");
        var registered=TextFileTypes.AssociationExtensions.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var expectedRegistered=extensions.Where(e=>!e.Equals(".bat",StringComparison.OrdinalIgnoreCase)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        assert(registered.SetEquals(expectedRegistered) && !registered.Contains(".bat") && registered.Contains(".cmd"), "Windows associations exclude only bat while leaving cmd and other formats unchanged");
        assert(TextFileTypes.FormatFor("run.BAT")=="batch" && TextFileTypes.SaveDialogFor("run.bat").DefaultExtension=="bat" && TextFileTypes.OpenFilter.Contains("*.bat"), "batch files remain editable and retain their extension in file dialogs");
        assert(Storage.AssociationProgIdForExtension(".MD")=="MD.Split.File.md" && Storage.AssociationProgIdForExtension(".csv")=="MD.Split.File.csv" && Storage.AssociationProgIdForExtension(".cmd")=="MD.Split.File.cmd", "document association identifiers preserve distinct file types and normalize casing");
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
        var chosenYaml = TextFileTypes.NewDocument("無題.yml", "utf-16be");
        assert(chosenYaml.Name == "無題.yml" && chosenYaml.Format == "yaml" && chosenYaml.Encoding == "utf16be" && chosenYaml.SavedEncoding == "utf16be" && chosenYaml.HasBom == true && chosenYaml.SavedHasBom == true, "new YAML retains selected encoding and BOM as its initial baseline");
        assert((await Storage.EncodeDocument("あ", chosenYaml)).SequenceEqual(new byte[] { 0xfe, 0xff, 0x30, 0x42 }), "new document actually saves with its chosen UTF-16 BE encoding and BOM");
        var chosenLegacy = TextFileTypes.NewDocument("無題.txt", "shiftjis");
        assert(chosenLegacy.Encoding == "shiftjis" && chosenLegacy.HasBom == false && (await Storage.EncodeDocument("日本", chosenLegacy)).SequenceEqual(new byte[] { 0x93, 0xfa, 0x96, 0x7b }), "new document saves with its chosen Shift JIS encoding");
        var invalidNewEncoding = false;
        try { TextFileTypes.NewDocument("無題.txt", "unsupported"); } catch (IOException) { invalidNewEncoding = true; }
        assert(invalidNewEncoding, "new-file requests reject unsupported encodings");
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
        assert(EditorAccelerators.CommandFor(0x4E, true, false, false) == "new" && EditorAccelerators.CommandFor(0x4E, true, false, true) == "new-options" && EditorAccelerators.CommandFor(0x4E, true, true, false) is null && EditorAccelerators.CommandFor(0x4E, false, false, false) is null, "native new-file shortcuts distinguish quick creation and format selection without intercepting AltGr or ordinary typing");
        assert(EditorAccelerators.CommandFor(0x53, true, true, false) is null && EditorAccelerators.CommandFor(0x53, false, false, false) is null && EditorAccelerators.CommandFor(0x52, true, false, false) is null, "native shortcut routing excludes AltGr, text typing and browser refresh");
    }
}


