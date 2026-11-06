using System.Diagnostics;
using System.Text.Json;

namespace MdSplit;

// Explicit opt-in diagnostics only. No document content, filenames, paths or
// account identifiers are written into the trace.
internal enum StartupStage
{
    MainEntry, StorageReady, ContextStart, SessionsScanned, RecoveriesScanned,
    SessionsRestored, FileReadStart, FileReadComplete, RecentUpdated, ContextReady,
    WindowCreated, WindowShown, WebEnvironmentStart, WebEnvironmentReady,
    WebControllerReady, NavigationStart, NavigationComplete,
    BootstrapStart, BootstrapReady, EditorRendered, FirstInput, SecondaryInstance,
    PipeConnectStart, PipeConnectComplete, PipeConnectFailed,
    NoCommandFile, SingleCommandFile, MultipleCommandFiles, RestoredWindowPresent,
    CommandFileInTracedWindow, CommandFileInOtherWindow,
    WebInitializationFailed, NavigationFailed, WindowClosed,
    WindowIconStart, WindowIconComplete, WindowControlsAddStart, WindowControlsAddComplete,
    WindowConstructorComplete, WindowShowStart, WindowShowComplete
}

internal sealed class StartupTraceSession
{
    private readonly Stopwatch clock;
    private readonly object gate = new();
    private readonly SemaphoreSlim writeGate = new(1, 1);
    private readonly Dictionary<StartupStage, double> stages = new();
    private readonly string outputPath;
    private readonly double? processToMainMs;
    internal bool Enabled { get; }

    internal StartupTraceSession(bool enabled, string outputDirectory, double? processToMainMs = null, Stopwatch? clock = null)
    {
        Enabled = enabled;
        this.clock = clock ?? Stopwatch.StartNew();
        outputPath = Path.Combine(outputDirectory, "startup-trace-" + Guid.NewGuid().ToString("N") + ".json");
        this.processToMainMs = processToMainMs;
    }
    internal void Mark(StartupStage stage)
    {
        if (!Enabled) return;
        lock (gate) stages.TryAdd(stage, Math.Round(clock.Elapsed.TotalMilliseconds, 2));
    }
    internal async Task<bool> FlushAsync()
    {
        if (!Enabled) return false;
        await writeGate.WaitAsync();
        try
        {
            Dictionary<string, double> snapshot;
            lock (gate) snapshot = stages.ToDictionary(pair => pair.Key.ToString(), pair => pair.Value);
            // All elapsed times are relative to the Main entry. The separate
            // process-to-Main estimate uses the wall clock and is approximate.
            // Only the first window is timed. A restored window can render an
            // unrelated active tab even when the command file shares it.
            var json = JsonSerializer.Serialize(new { schemaVersion = 1, windowScope = "first-created", processToMainMs, elapsedFromMainMs = snapshot });
            await Storage.AtomicText(outputPath, json);
            return true;
        }
        catch { return false; }
        finally { writeGate.Release(); }
    }
}

internal static class StartupTrace
{
    private static StartupTraceSession? current;
    private static int windowClaimed;
    internal static void EnableIfRequested(string[] args)
    {
        if (!args.Contains("--startup-trace", StringComparer.Ordinal)) return;
        var clock = Stopwatch.StartNew();
        var mainStarted = DateTime.UtcNow;
        double? processToMainMs = null;
        try
        {
            using var process = Process.GetCurrentProcess();
            var value = (mainStarted - process.StartTime.ToUniversalTime()).TotalMilliseconds;
            if (value >= 0 && value < 300000) processToMainMs = Math.Round(value, 2);
        }
        catch { /* Timing is still useful without this optional estimate. */ }
        current = new StartupTraceSession(true, Storage.Root, processToMainMs, clock);
        current.Mark(StartupStage.MainEntry);
    }
    internal static bool ClaimFirstWindow() => current is not null && Interlocked.CompareExchange(ref windowClaimed, 1, 0) == 0;
    internal static void Mark(StartupStage stage) => current?.Mark(stage);
    internal static Task<bool> FlushAsync() => current?.FlushAsync() ?? Task.FromResult(false);
}
