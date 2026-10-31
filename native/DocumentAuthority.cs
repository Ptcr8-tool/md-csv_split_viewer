namespace MdSplit;

// Only native open/save flows may assign paths and the saved-file baseline.
internal static class DocumentAuthority
{
    internal static DocumentData RegisterUnsaved(IDictionary<string, DocumentData> documents, string? id, string? name)
    {
        if (!Guid.TryParse(id, out _)) throw new IOException("文書IDが正しくありません。");
        if (documents.TryGetValue(id!, out var existing)) return existing;
        var doc = TextFileTypes.NewDocument(name);
        doc.Id = id!;
        documents.Add(doc.Id, doc);
        return doc;
    }

    internal static DocumentData Require(IDictionary<string, DocumentData> documents, string? id)
    {
        if (id is null || !Guid.TryParse(id, out _) || !documents.TryGetValue(id, out var doc))
            throw new IOException("文書が見つかりません。再度開いてください。");
        return doc;
    }

    internal static DocumentData Merge(IDictionary<string, DocumentData> documents, DocumentData input)
    {
        var trusted = Require(documents, input.Id);
        return new DocumentData
        {
            Id = trusted.Id, Path = trusted.Path, Name = trusted.Name,
            SavedText = trusted.SavedText, Fingerprint = trusted.Fingerprint,
            SavedEncoding = trusted.SavedEncoding, SavedHasBom = trusted.SavedHasBom,
            NeedsInitialSave = trusted.NeedsInitialSave,
            EncodingGuessed = trusted.EncodingGuessed, EncodingNotice = trusted.EncodingNotice,
            Format = trusted.Format,
            Text = input.Text ?? "", Encoding = input.Encoding ?? "utf8", HasBom = input.HasBom,
            PreviewViewMode = input.PreviewViewMode is "source" or "preview" ? input.PreviewViewMode : "split"
        };
    }
}
