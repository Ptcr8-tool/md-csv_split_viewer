using MdSplit;

internal static class DocumentAuthorityChecks
{
    internal static void Run(string root, Action<bool,string> assert)
    {
        var documents = new Dictionary<string, DocumentData>();
        var id = Guid.NewGuid().ToString();
        var created = DocumentAuthority.RegisterUnsaved(documents, id, "note.md");
        assert(created.Path is null && created.Fingerprint is null && created.Name == "note.md", "new document registration cannot create file access");
        assert(ReferenceEquals(created, DocumentAuthority.RegisterUnsaved(documents,id,"other.csv")) && created.Name == "note.md", "repeat registration cannot replace native state");
        var nativeNew = TextFileTypes.NewDocument("無題.yml", "utf16be");
        documents[nativeNew.Id] = nativeNew;
        var repeat = DocumentAuthority.RegisterUnsaved(documents, nativeNew.Id, "changed.txt");
        assert(ReferenceEquals(repeat,nativeNew) && repeat.Name == "無題.yml" && repeat.Encoding == "utf16be" && repeat.SavedEncoding == "utf16be" && repeat.HasBom == true && repeat.SavedHasBom == true, "registration preserves a native-created document's selected type and encoding");
        var forged = new DocumentData { Id=id, Path=Path.Combine(root,"secret.txt"), Name="evil.txt", SavedText="forged", Fingerprint="forged", SavedEncoding="utf16le", SavedHasBom=true, Text="hello", Encoding="utf8", HasBom=false, Format="csv" };
        var merged = DocumentAuthority.Merge(documents, forged);
        assert(merged.Path is null && merged.Fingerprint is null && merged.SavedText == "" && merged.SavedEncoding == "utf8" && merged.Name == "note.md" && merged.Format == "markdown", "forged path and saved metadata do not affect unsaved document");
        assert(merged.Text == "hello" && merged.Encoding == "utf8", "current editor text remains usable");
        var opened = new DocumentData { Id=id, Path=Path.Combine(root,"real.md"), Name="real.md", SavedText="baseline", Fingerprint="original-hash", Encoding="utf8", SavedEncoding="utf8", HasBom=false, SavedHasBom=false };
        documents[id] = opened;
        merged = DocumentAuthority.Merge(documents, forged);
        assert(merged.Path == opened.Path && merged.Name == opened.Name && merged.Fingerprint == "original-hash" && merged.SavedText == "baseline" && merged.SavedEncoding == "utf8" && merged.SavedHasBom == false, "open document retains native path, fingerprint and baseline against spoofing");
        assert(merged.Text == "hello" && merged.Path != forged.Path, "edited text is saved only to the native-selected destination");
        var rejected = false;
        try { DocumentAuthority.Merge(documents, new DocumentData { Id=Guid.NewGuid().ToString(), Path=forged.Path }); } catch (IOException) { rejected = true; }
        assert(rejected, "unknown document IDs are rejected");
        rejected = false;
        try { DocumentAuthority.RegisterUnsaved(documents,"bad-id","test.md"); } catch (IOException) { rejected = true; }
        assert(rejected, "invalid document IDs are rejected");
    }
}
