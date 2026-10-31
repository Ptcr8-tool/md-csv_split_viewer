using MdSplit;
using System.Text;
using System.Text.Json;

internal static class CsvViewChecks
{
    public static async Task Run(string root, Action<bool, string> assert)
    {
        static JsonElement Json(string text) { using var doc = JsonDocument.Parse(text); return doc.RootElement.Clone(); }
        static bool Rejected(string text) { try { CsvViewStore.ValidateView(Json(text)); return false; } catch (IOException) { return true; } }
        var csv = Path.Combine(root, "view-check.csv");
        var original = new UTF8Encoding(true).GetPreamble().Concat(Encoding.UTF8.GetBytes("Name,Note\r\nA,\"line1\r\nline2\"\r\n")).ToArray();
        await File.WriteAllBytesAsync(csv, original);
        var sidecar = csv + ".mdsplit-view.json";
        assert(CsvViewStore.SidecarPath(csv) == sidecar && CsvViewStore.Load(csv) is null, "CSV sidecar name is derived from the document and missing preferences do not create a file");
        var view = Json("""
        {"version":1,"columnLabel":"numbers","wrap":false,"enterDirection":"right","stripedRows":true,"defaultColumnWidth":180,"defaultRowHeight":0,"freezeRows":2,"freezeColumns":1,"hiddenRows":[3],"hiddenColumns":[2],"rowHeights":{"1":60},"columnWidths":{"0":200},"alignment":{"horizontal":"left","vertical":"viewport"},"rowAlignment":{"0":{"horizontal":"center"}},"columnAlignment":{"2":{"vertical":"bottom"}},"cellAlignment":{"2:3":{"horizontal":"right","vertical":"middle"}}}
        """);
        await CsvViewStore.Save(csv, view);
        var loaded = CsvViewStore.Load(csv)!.Value;
        assert(loaded.GetRawText() == view.GetRawText(), "sidecar round trip preserves only validated view preferences including cell and viewport alignment");
        assert((await File.ReadAllBytesAsync(csv)).SequenceEqual(original), "saving view preferences leaves original CSV bytes and BOM unchanged");
        var future = CsvViewStore.ValidateView(Json("{\"version\":1,\"wrap\":false,\"futureSetting\":{\"value\":42}}"));
        assert(!future.TryGetProperty("futureSetting", out _) && !future.GetProperty("wrap").GetBoolean(), "unknown future settings are ignored and are not serialized into the sidecar");
        assert(Rejected("{\"version\":1,\"future\":1,\"future\":2}"), "duplicate unknown future settings remain invalid");
        using (var wrapper = JsonDocument.Parse(await File.ReadAllBytesAsync(sidecar)))
            assert(wrapper.RootElement.GetProperty("schema").GetString() == "md-split.csv-view" && wrapper.RootElement.GetProperty("version").GetInt32() == 1 && wrapper.RootElement.EnumerateObject().Count() == 3, "sidecar wrapper has a fixed schema and version without a document path or content");
        foreach (var invalid in new[]
        {
            "[]", "{}", "{\"version\":2}", "{\"version\":\"1\"}", "{\"version\":1,\"version\":1}",
            "{\"version\":1,\"text\":\"not allowed\"}", "{\"version\":1,\"path\":\"not allowed\"}",
            "{\"version\":1,\"columnLabel\":\"invalid\"}", "{\"version\":1,\"columnLabel\":12}", "{\"version\":1,\"wrap\":1}", "{\"version\":1,\"enterDirection\":\"invalid\"}", "{\"version\":1,\"stripedRows\":1}", "{\"version\":1,\"defaultColumnWidth\":1}", "{\"version\":1,\"defaultRowHeight\":5001}",
            "{\"version\":1,\"freezeRows\":1.5}", "{\"version\":1,\"freezeRows\":101}", "{\"version\":1,\"freezeColumns\":51}",
            "{\"version\":1,\"hiddenRows\":[-1]}", "{\"version\":1,\"hiddenColumns\":{}}",
            "{\"version\":1,\"columnWidths\":{\"path\":200}}", "{\"version\":1,\"rowHeights\":{\"0\":10}}",
            "{\"version\":1,\"cellAlignment\":{\"0:1:2\":{}}}", "{\"version\":1,\"rowAlignment\":{\"100000000\":{}}}",
            "{\"version\":1,\"alignment\":{\"vertical\":\"url(value)\"}}", "{\"version\":1,\"alignment\":{\"horizontal\":\"bottom\"}}",
            "{\"version\":1,\"alignment\":{\"text\":\"not allowed\"}}"
        }) assert(Rejected(invalid), "invalid or unrecognized sidecar preferences are rejected before saving");
        var rejectedPath = false;
        try { CsvViewStore.SidecarPath(null); } catch (IOException) { rejectedPath = true; }
        assert(rejectedPath, "untitled documents cannot select an arbitrary sidecar destination");
        var txt = Path.Combine(root, "view-check.txt"); await File.WriteAllTextAsync(txt, "unchanged");
        rejectedPath = false; try { CsvViewStore.SidecarPath(txt); } catch (IOException) { rejectedPath = true; }
        assert(rejectedPath, "non-CSV documents cannot write view sidecars");
        await File.WriteAllTextAsync(sidecar, "{bad json");
        var bad = false; try { CsvViewStore.Load(csv); } catch (IOException) { bad = true; }
        assert(bad, "invalid sidecar JSON returns a view-specific error");
        foreach (var wrapper in new[]
        {
            "{\"schema\":\"other\",\"version\":1,\"view\":{\"version\":1}}",
            "{\"schema\":\"md-split.csv-view\",\"version\":\"1\",\"view\":{\"version\":1}}",
            "{\"schema\":\"md-split.csv-view\",\"version\":1,\"view\":{\"version\":1},\"text\":\"not allowed\"}"
        })
        {
            await File.WriteAllTextAsync(sidecar, wrapper); bad = false; try { CsvViewStore.Load(csv); } catch (IOException) { bad = true; }
            assert(bad, "sidecar schema and wrapper fields are validated on load");
        }
        using (var stream = File.Create(sidecar)) stream.SetLength(CsvViewStore.MaxBytes + 1L);
        bad = false; try { CsvViewStore.Load(csv); } catch (IOException) { bad = true; }
        assert(bad, "oversized sidecar is rejected before reading its content");
        File.Delete(sidecar); Directory.CreateDirectory(sidecar);
        bad = false; try { await CsvViewStore.Save(csv, view); } catch (IOException) { bad = true; }
        assert(bad, "sidecar does not overwrite a directory");
        Directory.Delete(sidecar);
        assert((await File.ReadAllBytesAsync(csv)).SequenceEqual(original), "invalid sidecar files never change CSV data");
    }
}
