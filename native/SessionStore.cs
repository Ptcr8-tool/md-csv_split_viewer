using System.Text.Json;

namespace MdSplit;

// A clean shutdown stores references only. Unsaved text belongs to the crash
// recovery system and is never silently resurrected after a deliberate discard.
internal sealed class SessionSnapshot
{
    public int Version { get; set; } = 1;
    public string Mode { get; set; } = "normal";
    public string? ActiveId { get; set; }
    public string? ClosedRecoveryId { get; set; }
    public string? PreviousSessionId { get; set; }
    public List<SessionEntry> Documents { get; set; } = [];
}
internal sealed class SessionEntry
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "無題.md";
    public string? Path { get; set; }
    public string? Encoding { get; set; }
    public string PreviewViewMode { get; set; } = "split";
}
internal static class SessionStore
{
    internal static HashSet<string> ClosedRecoveryIds(IEnumerable<SessionSnapshot> sessions) => sessions.Where(s => s.ClosedRecoveryId is not null).Select(s => s.ClosedRecoveryId!).ToHashSet(StringComparer.OrdinalIgnoreCase);
    internal static HashSet<string> SupersededSessionIds(IEnumerable<SessionSnapshot> sessions) => sessions.Where(s => s.PreviousSessionId is not null).Select(s => s.PreviousSessionId!).ToHashSet(StringComparer.OrdinalIgnoreCase);
    internal static SessionSnapshot? Capture(string? policy, IReadOnlyList<string> order, string? activeId, string? mode, IDictionary<string, DocumentData> trusted)
    {
        if (policy is not ("clear" or "all" or "active")) throw new IOException("終了時の設定が正しくありません。");
        if (order.Count != order.Distinct(StringComparer.Ordinal).Count()) throw new IOException("タブの一覧が正しくありません。");
        var docs = order.Select(id => DocumentAuthority.Require(trusted, id)).ToList();
        if (docs.Count > 0 && !docs.Any(d => d.Id == activeId)) throw new IOException("現在のタブが見つかりません。");
        var chosen = policy == "clear" ? Enumerable.Empty<DocumentData>() : policy == "active" ? docs.Where(d => d.Id == activeId) : docs;
        return new SessionSnapshot
        {
            Mode = mode == "discord" ? "discord" : "normal", ActiveId = activeId,
            Documents = chosen.Select(d => new SessionEntry { Id = d.Id, Name = d.Name, Path = d.Path,
                Encoding = d.SavedEncoding ?? d.Encoding, PreviewViewMode = d.PreviewViewMode }).ToList()
        };
    }
    // Called on the UI thread when the final window closes: no other window can
    // be opened or closed between the final-window check and the commit.
    internal static void Write(string path, SessionSnapshot snapshot)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(temporary, JsonSerializer.Serialize(snapshot, Storage.Json), new System.Text.UTF8Encoding(false));
            File.Move(temporary, path, true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    internal static SessionSnapshot Read(string path)
    {
        var data = JsonSerializer.Deserialize<SessionSnapshot>(File.ReadAllText(path), Storage.Json) ?? throw new IOException("タブの復元情報を読み取れません。");
        if (data.Version != 1 || (data.ClosedRecoveryId is not null && !Guid.TryParseExact(data.ClosedRecoveryId, "N", out _)) || (data.PreviousSessionId is not null && !Guid.TryParseExact(data.PreviousSessionId, "N", out _)) || data.Documents is null || data.Documents.Any(d => d is null || !Guid.TryParse(d.Id, out _)) || data.Documents.Select(d => d.Id).Distinct(StringComparer.Ordinal).Count() != data.Documents.Count)
            throw new IOException("タブの復元情報が正しくありません。");
        return data;
    }
    internal static void Consume(string path, string recoveryDirectory, string sessionDirectory, HashSet<string>? visited = null)
    {
        if (!File.Exists(path)) return;
        visited ??= new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (!visited.Add(Path.GetFullPath(path))) throw new IOException("タブの復元情報が循環しています。");
        var source = Read(path);
        if (source.ClosedRecoveryId is not null) RecoveryStore.Delete(Path.Combine(recoveryDirectory, source.ClosedRecoveryId + ".json"));
        if (source.PreviousSessionId is not null) Consume(Path.Combine(sessionDirectory, source.PreviousSessionId + ".json"), recoveryDirectory, sessionDirectory, visited);
        File.Delete(path);
    }
    internal static async Task<bool> CommitRecovery(RecoveryStore store, RecoveryData recovery, IReadOnlyList<string> order, string? sourceSessionFile, string? recoveryDirectory = null, string? sessionDirectory = null)
    {
        // On any write failure, the old session remains available for restart.
        await store.Write(recovery, order);
        if (sourceSessionFile is null) return true;
        try { Consume(sourceSessionFile, recoveryDirectory ?? Storage.RecoveryPath, sessionDirectory ?? Storage.SessionPath); return true; }
        catch (Exception ex) { Storage.Log(ex); return false; }
    }
    internal static RecoveryData Restore(SessionSnapshot data, ISet<string> seenPaths, ISet<string> seenIds, Func<string, bool> approveLarge, Action<string> warn)
    {
        var result = new RecoveryData { Mode = data.Mode == "discord" ? "discord" : "normal", ActiveId = data.ActiveId };
        foreach (var item in data.Documents)
        {
            try
            {
                if (seenIds.Contains(item.Id)) continue;
                DocumentData doc;
                if (item.Path is null)
                {
                    doc = TextFileTypes.NewDocument(item.Name);
                    doc.Id = item.Id;
                }
                else
                {
                    var path = Path.GetFullPath(item.Path);
                    if (seenPaths.Contains(path)) continue;
                    if (!File.Exists(path)) throw new IOException("ファイルが見つからないか、読み取れません。");
                    if (!approveLarge(path)) throw new IOException("読み込みを中止しました。");
                    doc = Storage.ReadFile(path, item.Id, item.Encoding);
                    seenPaths.Add(path);
                }
                doc.PreviewViewMode = item.PreviewViewMode is "source" or "preview" ? item.PreviewViewMode : "split";
                result.Documents.Add(doc);
                seenIds.Add(doc.Id);
            }
            catch (Exception ex) { Storage.Log(ex); warn((item.Path ?? item.Name) + "\n" + ex.Message); }
        }
        if (!result.Documents.Any(d => d.Id == result.ActiveId)) result.ActiveId = result.Documents.LastOrDefault()?.Id;
        return result;
    }
}
