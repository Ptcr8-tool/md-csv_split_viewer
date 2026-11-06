using MdSplit;
using System.Text.Json;

internal static class StartupTraceChecks
{
    internal static async Task Run(string root, Action<bool, string> assert)
    {
        var disabledDirectory = Path.Combine(root, "trace-disabled");
        var disabled = new StartupTraceSession(false, disabledDirectory);
        disabled.Mark(StartupStage.MainEntry);
        assert(!await disabled.FlushAsync() && !Directory.Exists(disabledDirectory), "startup trace does not write when disabled");

        var directory = Path.Combine(root, "trace-enabled");
        var trace = new StartupTraceSession(true, directory, 12.5);
        trace.Mark(StartupStage.MainEntry);
        trace.Mark(StartupStage.MainEntry);
        trace.Mark(StartupStage.EditorRendered);
        assert(await trace.FlushAsync(), "startup trace can record rendered editor without typing");
        var files = Directory.GetFiles(directory, "startup-trace-*.json");
        assert(files.Length == 1, "startup trace uses a unique file in the supplied data folder");
        var json = await File.ReadAllTextAsync(files[0]);
        using (var data = JsonDocument.Parse(json))
        {
            var elapsed = data.RootElement.GetProperty("elapsedFromMainMs");
            assert(data.RootElement.GetProperty("schemaVersion").GetInt32() == 1 && data.RootElement.GetProperty("windowScope").GetString() == "first-created" && data.RootElement.GetProperty("processToMainMs").GetDouble() == 12.5 && elapsed.GetProperty("EditorRendered").GetDouble() >= elapsed.GetProperty("MainEntry").GetDouble(), "startup trace identifies first-window scope and retains approximate process offset and monotonic stage times");
            assert(!elapsed.TryGetProperty("FirstInput", out _) && elapsed.EnumerateObject().Count() == 2, "duplicate stages do not overwrite timestamps and input is optional");
        }
        assert(!json.Contains(root, StringComparison.Ordinal) && !json.Contains("filename", StringComparison.OrdinalIgnoreCase) && !json.Contains("document", StringComparison.OrdinalIgnoreCase), "startup trace does not include local paths or document fields");
        trace.Mark(StartupStage.FirstInput);
        assert(await trace.FlushAsync(), "startup trace can add the first-input milestone");
        files = Directory.GetFiles(directory, "startup-trace-*.json");
        using var updated = JsonDocument.Parse(await File.ReadAllTextAsync(files[0]));
        assert(files.Length == 1 && updated.RootElement.GetProperty("elapsedFromMainMs").TryGetProperty("FirstInput", out _), "first input updates the same trace file");

        var blocked = Path.Combine(root, "trace-directory-is-a-file");
        await File.WriteAllTextAsync(blocked, "sentinel");
        var failing = new StartupTraceSession(true, blocked);
        failing.Mark(StartupStage.WebInitializationFailed);
        assert(!await failing.FlushAsync() && await File.ReadAllTextAsync(blocked) == "sentinel", "startup trace write errors do not replace user files or escape to the editor");
    }
}
