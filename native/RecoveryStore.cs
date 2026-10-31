using System.Text.Json;

namespace MdSplit;

// Documents are immutable generation files. A small manifest is replaced only
// after every changed document is safely written, so an interrupted write never
// invalidates the previous complete recovery snapshot.
internal sealed class RecoveryStore
{
    private const int FormatVersion = 2;
    private readonly string path;
    private readonly string directory;
    private Dictionary<string, string> committed = new(StringComparer.Ordinal);

    internal RecoveryStore(string path) { this.path = path; directory = path + ".documents"; }

    internal async Task Write(RecoveryData delta, IReadOnlyList<string> order)
    {
        if (order.Count != order.Distinct(StringComparer.Ordinal).Count() ||
            order.Any(id => !Guid.TryParse(id, out _)))
            throw new IOException("復元データの文書IDが正しくありません。");
        var changed = delta.Documents.ToDictionary(d => d.Id, StringComparer.Ordinal);
        if (changed.Count != delta.Documents.Count || changed.Keys.Any(id => !order.Contains(id)))
            throw new IOException("復元データの文書IDが正しくありません。");

        var next = new Dictionary<string, string>(committed, StringComparer.Ordinal);
        foreach (var doc in delta.Documents)
        {
            if (!Guid.TryParse(doc.Id, out _)) throw new IOException("復元データの文書IDが正しくありません。");
            var name = Guid.NewGuid().ToString("N") + ".json";
            await Storage.AtomicText(Path.Combine(directory, name), JsonSerializer.Serialize(doc, Storage.Json));
            next[doc.Id] = name;
        }
        if (order.Any(id => !next.ContainsKey(id))) throw new IOException("復元データが不足しています。再度保存してください。");
        var manifest = new Manifest { Version = FormatVersion, Mode = delta.Mode, ActiveId = delta.ActiveId,
            Reason = delta.Reason, Documents = order.Select(id => new Entry { Id = id, File = next[id] }).ToList() };
        await Storage.AtomicText(path, JsonSerializer.Serialize(manifest, Storage.Json));
        committed = order.ToDictionary(id => id, id => next[id], StringComparer.Ordinal);
        // Clean only after the new manifest is committed. Orphan cleanup failure
        // must not turn a successful commit into a failed acknowledgement.
        try
        {
            if (Directory.Exists(directory))
            {
                var keep = committed.Values.ToHashSet(StringComparer.Ordinal);
                foreach (var file in Directory.GetFiles(directory, "*.json"))
                    if (!keep.Contains(Path.GetFileName(file))) File.Delete(file);
            }
        }
        catch (Exception ex) { Storage.Log(ex); }
    }

    internal static RecoveryData? Read(string path)
    {
        var text = File.ReadAllText(path);
        using var json = JsonDocument.Parse(text);
        if (!json.RootElement.TryGetProperty("version", out var version))
            return JsonSerializer.Deserialize<RecoveryData>(text, Storage.Json);
        if (version.ValueKind != JsonValueKind.Number || version.GetInt32() != FormatVersion)
            throw new IOException("この復元データの形式には対応していません。");
        var manifest = JsonSerializer.Deserialize<Manifest>(text, Storage.Json) ?? throw new IOException("復元データが壊れています。");
        var result = new RecoveryData { Mode = manifest.Mode, ActiveId = manifest.ActiveId, Reason = manifest.Reason };
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var entry in manifest.Documents)
        {
            if (!Guid.TryParse(entry.Id, out _) || !ids.Add(entry.Id) || entry.File.Length != 37 ||
                !entry.File.EndsWith(".json", StringComparison.Ordinal) ||
                !Guid.TryParseExact(entry.File[..32], "N", out _))
                throw new IOException("復元データの参照が正しくありません。");
            var doc = JsonSerializer.Deserialize<DocumentData>(File.ReadAllText(Path.Combine(path + ".documents", entry.File)), Storage.Json)
                ?? throw new IOException("復元データが壊れています。");
            if (!string.Equals(doc.Id, entry.Id, StringComparison.Ordinal)) throw new IOException("復元データの文書IDが一致しません。");
            result.Documents.Add(doc);
        }
        return result;
    }

    internal static void Delete(string path)
    {
        if (File.Exists(path)) File.Delete(path);
        var directory = path + ".documents";
        if (Directory.Exists(directory)) Directory.Delete(directory, true);
    }

    private sealed class Manifest
    {
        public Manifest() { }
        public int Version { get; set; }
        public string Mode { get; set; } = "normal";
        public string? ActiveId { get; set; }
        public string? Reason { get; set; }
        public List<Entry> Documents { get; set; } = [];
    }
    private sealed class Entry
    {
        public Entry() { }
        public string Id { get; set; } = "";
        public string File { get; set; } = "";
    }
}
