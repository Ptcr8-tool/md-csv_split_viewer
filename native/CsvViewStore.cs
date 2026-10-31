using System.Text;
using System.Text.Json;

namespace MdSplit;

internal static class CsvViewStore
{
    internal const int MaxBytes = 2 * 1024 * 1024;
    private const string Schema = "md-split.csv-view";
    private static readonly HashSet<string> Horizontal = ["left", "center", "right"];
    private static readonly HashSet<string> Vertical = ["top", "middle", "bottom", "viewport"];

    public static string SidecarPath(string? documentPath)
    {
        if (string.IsNullOrWhiteSpace(documentPath)) throw new IOException("表示設定を保存するには、先にCSV・TSVを保存してください。");
        var path = Path.GetFullPath(documentPath);
        if (TextFileTypes.FormatFor(path) is not ("csv" or "tsv") || !File.Exists(path)) throw new IOException("CSV・TSVの元ファイルが見つかりません。");
        return path + ".mdsplit-view.json";
    }

    public static JsonElement ValidateView(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object || Encoding.UTF8.GetByteCount(value.GetRawText()) > MaxBytes) throw Invalid();
        var names = new HashSet<string>(StringComparer.Ordinal);
        var clean = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var item in value.EnumerateObject())
        {
            if (!names.Add(item.Name)) throw Invalid();
            switch (item.Name)
            {
                case "version": if (item.Value.ValueKind != JsonValueKind.Number || !item.Value.TryGetInt32(out var version) || version != 1) throw Invalid(); break;
                case "columnLabel": if (item.Value.ValueKind != JsonValueKind.String || item.Value.GetString() is not ("letters" or "numbers")) throw Invalid(); break;
                case "wrap": if (item.Value.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) throw Invalid(); break;
                case "enterDirection": if (item.Value.ValueKind != JsonValueKind.String || item.Value.GetString() is not ("down" or "up" or "left" or "right" or "none")) throw Invalid(); break;
                case "stripedRows": if (item.Value.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) throw Invalid(); break;
                case "defaultColumnWidth": Number(item.Value, 40, 4000); break;
                // Zero means automatic height; explicit per-row heights start at 20 px.
                case "defaultRowHeight": Number(item.Value, 0, 5000); break;
                case "freezeRows": Integer(item.Value, 0, 100); break;
                case "freezeColumns": Integer(item.Value, 0, 50); break;
                case "hiddenRows": case "hiddenColumns":
                    if (item.Value.ValueKind != JsonValueKind.Array) throw Invalid();
                    foreach (var index in item.Value.EnumerateArray()) Integer(index, 0, 99_999_999);
                    break;
                case "rowHeights": Map(item.Value, false, x => Number(x, 20, 5000)); break;
                case "columnWidths": Map(item.Value, false, x => Number(x, 40, 4000)); break;
                case "alignment": Alignment(item.Value); break;
                case "rowAlignment": case "columnAlignment": Map(item.Value, false, Alignment); break;
                case "cellAlignment": Map(item.Value, true, Alignment); break;
                // These are never display settings and could leak document contents or paths.
                case "text": case "path": throw Invalid();
                // Ignore future fields of the same schema version, without saving them.
                default: continue;
            }
            clean.Add(item.Name, item.Value);
        }
        if (!names.Contains("version")) throw Invalid();
        return clean.Count == names.Count ? value.Clone() : JsonSerializer.SerializeToElement(clean);
    }

    public static async Task Save(string documentPath, JsonElement view)
    {
        var path = SidecarPath(documentPath);
        CheckSidecar(path);
        var clean = ValidateView(view);
        var json = JsonSerializer.Serialize(new { schema = Schema, version = 1, view = clean }, Storage.Json);
        if (Encoding.UTF8.GetByteCount(json) > MaxBytes) throw Invalid();
        await Storage.AtomicText(path, json);
    }

    public static JsonElement? Load(string documentPath)
    {
        var path = SidecarPath(documentPath);
        CheckSidecar(path);
        if (!File.Exists(path)) return null;
        if (new FileInfo(path).Length > MaxBytes) throw Invalid();
        var bytes = File.ReadAllBytes(path);
        if (bytes.Length > MaxBytes) throw Invalid();
        try
        {
            using var doc = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 20 });
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) throw Invalid();
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var p in root.EnumerateObject()) if (!names.Add(p.Name) || p.Name is "path" or "text") throw Invalid();
            if (!root.TryGetProperty("schema", out var schema) || schema.ValueKind != JsonValueKind.String || schema.GetString() != Schema ||
                !root.TryGetProperty("version", out var version) || version.ValueKind != JsonValueKind.Number || !version.TryGetInt32(out var v) || v != 1 || !root.TryGetProperty("view", out var view)) throw Invalid();
            return ValidateView(view);
        }
        catch (JsonException) { throw Invalid(); }
    }

    private static void CheckSidecar(string path)
    {
        if (Directory.Exists(path) || File.Exists(path) && (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new IOException("表示設定の保存先が通常のファイルではありません。");
    }
    private static void Map(JsonElement value, bool cells, Action<JsonElement> validate)
    {
        if (value.ValueKind != JsonValueKind.Object) throw Invalid();
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var p in value.EnumerateObject())
        {
            if (!names.Add(p.Name)) throw Invalid();
            var parts = cells ? p.Name.Split(':') : [p.Name];
            if (parts.Length != (cells ? 2 : 1) || parts.Any(x => x.Length == 0 || x.Length > 8 || x.Any(c => c is < '0' or > '9') || !int.TryParse(x, out var n) || n >= 100_000_000)) throw Invalid();
            validate(p.Value);
        }
    }
    private static void Alignment(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object) throw Invalid();
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var p in value.EnumerateObject())
        {
            if (!names.Add(p.Name) || p.Value.ValueKind != JsonValueKind.String) throw Invalid();
            var text = p.Value.GetString()!;
            if (p.Name == "horizontal" ? !Horizontal.Contains(text) : p.Name == "vertical" ? !Vertical.Contains(text) : true) throw Invalid();
        }
    }
    private static void Number(JsonElement value, double min, double max)
    {
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out var n) || !double.IsFinite(n) || n < min || n > max) throw Invalid();
    }
    private static void Integer(JsonElement value, int min, int max)
    {
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt32(out var n) || n < min || n > max) throw Invalid();
    }
    private static IOException Invalid() => new("表示設定ファイルの形式が正しくないか、サイズが大きすぎます。");
}
