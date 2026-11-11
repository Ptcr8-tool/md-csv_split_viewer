using System.IO.Pipes;
using System.Text.Json;

namespace MdSplit;

internal static class Program
{
    public static readonly string PipeName = "MD-Split-" + Storage.Hash(System.Text.Encoding.UTF8.GetBytes(Environment.UserName))[..16];
    [STAThread]
    private static void Main(string[] args)
    {
        StartupTrace.EnableIfRequested(args);
        ApplicationConfiguration.Initialize(); Storage.Initialize();
        _ = Storage.LoadSettings(); // Apply the saved language before native startup dialogs.
        StartupTrace.Mark(StartupStage.StorageReady);
        Application.ThreadException += (_, e) => { Storage.Log(e.Exception); MessageBox.Show(UiLanguage.T("処理中にエラーが発生しました。\n", "An error occurred.\n") + e.Exception.Message, AppInfo.Title, MessageBoxButtons.OK, MessageBoxIcon.Error); };
        AppDomain.CurrentDomain.UnhandledException += (_, e) => { if(e.ExceptionObject is Exception ex) Storage.Log(ex); };
        try
        {
            if(args.Contains("--context-menu-enable")){ContextMenuRegistration.Set(true);return;}
            if(args.Contains("--context-menu-disable")){ContextMenuRegistration.Set(false);return;}
            if (args.Contains("--register-only")||args.Contains("--register-quiet")) { Storage.RegisterAssociation(); try { ContextMenuRegistration.MigrateLegacy(); } catch (Exception ex) { Storage.Log(ex); } if(!args.Contains("--register-quiet"))MessageBox.Show(UiLanguage.T("対応ファイルの候補にMD-CSV Split Editorを登録しました。既定のアプリはWindowsの設定で拡張子ごとに選んでください。", "MD-CSV Split Editor was registered as an app candidate for supported files. Choose default apps by file extension in Windows settings."), AppInfo.Title); return; }
            if(args.Contains("--unregister-quiet")){Maintenance.Unregister();return;}
            if(args.Contains("--repair")){Maintenance.Repair();return;}
            var record=Array.IndexOf(args,"--record-installer");if(record>=0){if(record+1>=args.Length)throw new IOException(UiLanguage.T("修復用ファイルがありません。", "The repair file is missing."));Maintenance.RecordInstaller(args[record+1]);return;}
        }
        catch(Exception ex){Storage.Log(ex);MessageBox.Show(ex.Message,AppInfo.Title,MessageBoxButtons.OK,MessageBoxIcon.Warning);Environment.ExitCode=1;return;}
        using var mutex = new Mutex(true, "Local\\" + PipeName, out var first);
        if (!first)
        {
            StartupTrace.Mark(StartupStage.SecondaryInstance);
            try { var message=PipeMessagePolicy.Encode(args.Select(a=>a.StartsWith("--")?a:Path.GetFullPath(a)).ToArray()); using var client = new NamedPipeClientStream(".", PipeName, PipeDirection.Out); StartupTrace.Mark(StartupStage.PipeConnectStart); client.Connect(5000); StartupTrace.Mark(StartupStage.PipeConnectComplete); using var writer = new StreamWriter(client); writer.WriteLine(message); }
            catch (Exception ex) { StartupTrace.Mark(StartupStage.PipeConnectFailed); MessageBox.Show(UiLanguage.T("起動中のMD-CSV Split Editorへファイルを渡せませんでした。\n", "Could not send the file to the running MD-CSV Split Editor.\n") + ex.Message, AppInfo.Title); }
            if (args.Contains("--startup-trace", StringComparer.Ordinal)) _ = StartupTrace.FlushAsync().GetAwaiter().GetResult();
            return;
        }
        using var context = new EditorContext(args); Application.Run(context); context.Updates.Dispose(); mutex.ReleaseMutex();
    }
}

internal sealed class EditorContext : ApplicationContext
{
    public bool ConfirmLargeFile(string path, IWin32Window? owner = null) => Storage.ApproveLargeFile(path, size =>
        MessageBox.Show(owner, UiLanguage.T($"このファイルは約{size / 1024.0 / 1024.0:N1} MiBあります。\n読み込みや編集に時間がかかり、メモリを多く使用する場合があります。\n\n開きますか？", $"This file is approximately {size / 1024.0 / 1024.0:N1} MiB. Opening or editing it may take time and use substantial memory.\n\nOpen it?"), UiLanguage.T("大きなファイルを開く", "Open large file"), MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) == DialogResult.Yes);
    public RecentFiles Recent { get; } = new(Path.Combine(Storage.Root,"recent.json"));
    public UpdateService Updates { get; } = new();
    internal TabTransfers Transfers { get; }
    private readonly HashSet<EditorWindow> updateReady=[];
    private readonly System.Windows.Forms.Timer updateWatchdog=new(){Interval=3*60*1000};
    private bool preparingUpdate;
    private string? updateSession;
    public AppSettings Settings { get; set; } = Storage.LoadSettings();
    public List<EditorWindow> Windows { get; } = [];
    private EditorWindow? lastActive;
    private readonly CancellationTokenSource cancellation = new();
    private Task? pipeTask;
    private bool contextDisposed;
    private bool initializing = true;
    public EditorContext(string[] args)
    {
        Transfers=new TabTransfers(this);
        StartupTrace.Mark(StartupStage.ContextStart);
        updateWatchdog.Tick+=(_,_)=>{if(preparingUpdate)AbortUpdate(UiLanguage.T("更新の準備が完了しなかったため中止しました。編集を続けられます。", "The update was cancelled because preparation did not finish. You can continue editing."));};
        var restored = false;
        var sessionWarnings = new List<string>();
        var sessions = new Dictionary<string,SessionSnapshot>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in Directory.GetFiles(Storage.SessionPath, "*.json"))
        {
            try
            {
                if (!Guid.TryParseExact(Path.GetFileNameWithoutExtension(file), "N", out _)) throw new IOException(UiLanguage.T("タブの復元情報の名前が正しくありません。", "The saved tab information filename is invalid."));
                sessions.Add(file, SessionStore.Read(file));
            }
            catch (Exception ex) { Storage.Log(ex); sessionWarnings.Add(UiLanguage.T("保存されたタブの情報を読み取れませんでした。\n", "Could not read the saved tab information.\n") + ex.Message); }
        }
        StartupTrace.Mark(StartupStage.SessionsScanned);
        // Clean-close markers commit the user's discard decision before the
        // window goes away. Suppress any obsolete recovery even after a crash
        // between the marker commit and FormClosed cleanup.
        var closedRecoveries = SessionStore.ClosedRecoveryIds(sessions.Values);
        var supersededSessions = SessionStore.SupersededSessionIds(sessions.Values);
        foreach (var file in Directory.GetFiles(Storage.RecoveryPath, "*.json"))
        {
            try
            {
                if (closedRecoveries.Contains(Path.GetFileNameWithoutExtension(file))) continue;
                var recovery = RecoveryStore.Read(file);
                if(recovery is not null)for(var i=0;i<recovery.Documents.Count;i++){var d=recovery.Documents[i];if(d.Path is not null&&File.Exists(d.Path)&&Storage.CanReloadUnchangedRecovery(d)){try{recovery.Documents[i]=Storage.ReloadDocument(d);}catch(Exception ex){Storage.Log(ex);}}}
                if (recovery?.Documents.Count > 0) { AddWindow(recovery, true, file); restored = true; }
            }
            catch (Exception ex) { Storage.Log(ex); }
        }
        StartupTrace.Mark(StartupStage.RecoveriesScanned);
        // Successful clean-exit sessions are references to files, independent
        // of crash/update recovery. Consume them only after creating a window.
        var seenPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var doc in Windows.SelectMany(w => w.Documents.Values).Where(d => d.Path is not null))
            try { seenPaths.Add(Path.GetFullPath(doc.Path!)); } catch (Exception ex) { Storage.Log(ex); }
        var seenIds = Windows.SelectMany(w => w.Documents.Keys).ToHashSet(StringComparer.Ordinal);
        foreach (var (file, session) in sessions)
        {
            try
            {
                if (supersededSessions.Contains(Path.GetFileNameWithoutExtension(file))) continue;
                var initialSession = SessionStore.Restore(session, seenPaths, seenIds, path => ConfirmLargeFile(path), sessionWarnings.Add);
                if (initialSession.Documents.Count > 0) { AddWindow(initialSession, sessionFile: file); restored = true; }
                else SessionStore.Consume(file, Storage.RecoveryPath, Storage.SessionPath);
            }
            catch (Exception ex) { Storage.Log(ex); sessionWarnings.Add(UiLanguage.T("保存されたタブの情報を読み取れませんでした。\n", "Could not read the saved tab information.\n") + ex.Message); }
        }
        StartupTrace.Mark(StartupStage.SessionsRestored);
        var files = args.Where(a => !a.StartsWith("--") && File.Exists(a)).ToArray();
        if (restored) StartupTrace.Mark(StartupStage.RestoredWindowPresent);
        StartupTrace.Mark(files.Length switch { 0 => StartupStage.NoCommandFile, 1 => StartupStage.SingleCommandFile, _ => StartupStage.MultipleCommandFiles });
        if (files.Length > 0) RouteFiles(files, lastActive);
        else if (!restored) AddWindow();
        if(Windows.Count==0)AddWindow();
        RouteNewDirectory(args, lastActive);
        if (sessionWarnings.Count > 0) MessageBox.Show(UiLanguage.T("前回のタブの一部を開けませんでした。\n\n", "Some previously opened tabs could not be restored.\n\n") + string.Join("\n\n", sessionWarnings), AppInfo.Title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
        pipeTask = ListenPipe();
        initializing = false; StartupTrace.Mark(StartupStage.ContextReady);
    }
    protected override void Dispose(bool disposing)
    {
        if(disposing&&!contextDisposed)
        {
            contextDisposed=true;Transfers.Dispose();
            updateWatchdog.Stop();updateWatchdog.Dispose();cancellation.Cancel();
            // The pipe listener may still be unwinding from an asynchronous read.
            // Dispose its token source only after that operation has finished.
            if(pipeTask is null || pipeTask.IsCompleted)cancellation.Dispose();
            else _=pipeTask.ContinueWith(_=>cancellation.Dispose(),TaskScheduler.Default);
        }
        base.Dispose(disposing);
    }
    public EditorWindow AddWindow(RecoveryData? initial = null, bool recovered = false, string? recoveryFile = null, string? sessionFile = null, Action<EditorWindow>? beforeShow = null)
    {
        if(preparingUpdate)AbortUpdate();
        var window = new EditorWindow(this, initial, recovered, recoveryFile, sessionFile); Windows.Add(window); lastActive = window;
        window.Activated += (_, _) => lastActive = window;
        window.FormClosed += (_, _) => { Transfers.WindowClosed(window); if(preparingUpdate)AbortUpdate(); Windows.Remove(window); if (lastActive == window) lastActive = Windows.LastOrDefault(); if (Windows.Count == 0) { cancellation.Cancel(); ExitThread(); } };
        beforeShow?.Invoke(window);
        if (window.IsStartupTraceWindow) StartupTrace.Mark(StartupStage.WindowShowStart);
        window.Show();
        if (window.IsStartupTraceWindow) StartupTrace.Mark(StartupStage.WindowShowComplete);
        return window;
    }
    public void NewFile(EditorWindow origin, string? name = null, string? encoding = null)
    {
        var document = TextFileTypes.NewDocument(name, encoding);
        if (Settings.OpenPolicy == "windows") AddWindow(new RecoveryData { Documents = [document], ActiveId = document.Id }); else origin.AddNewDocument(document);
    }
    private void RouteNewDirectory(string[] args, EditorWindow? origin)
    {
        var index = Array.IndexOf(args, "--new-in-directory");
        var desktop = args.Contains("--new-in-desktop");
        if (index < 0 && !desktop) return;
        var directory = desktop ? Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory) : index + 1 < args.Length ? args[index + 1] : "";
        if (!Path.IsPathFullyQualified(directory) || !Directory.Exists(directory))
        {
            MessageBox.Show(origin, UiLanguage.T("新規作成するフォルダーが見つかりません。", "The folder for the new file was not found."), AppInfo.Title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        var target = origin ?? lastActive ?? Windows.FirstOrDefault();
        if (target is null) return;
        target.RequestNewInDirectory(Path.GetFullPath(directory));
        target.BringForward();
    }
    public void RouteFiles(IEnumerable<string> paths, EditorWindow? origin, string? forceEncoding = null)
    {
        if(preparingUpdate)AbortUpdate();
        foreach (var candidate in paths)
        {
            try
            {
                var path = Path.GetFullPath(candidate);
                var existing = Windows.SelectMany(w => w.Documents.Values.Select(d => (Window: w, Doc: d))).FirstOrDefault(p => string.Equals(p.Doc.Path, path, StringComparison.OrdinalIgnoreCase));
                if (existing.Doc is not null)
                {
                    if (initializing) StartupTrace.Mark(existing.Window.IsStartupTraceWindow ? StartupStage.CommandFileInTracedWindow : StartupStage.CommandFileInOtherWindow);
                    existing.Window.BringForward(); existing.Window.Emit(new { type = "activate-document", id = existing.Doc.Id });
                    if (forceEncoding is not null) existing.Window.Emit(new { type = "encoding-open-existing", id = existing.Doc.Id, name = existing.Doc.Name });
                    continue;
                }
                // Probe only a bounded local prefix before potentially loading a
                // large binary in full. Explicit encoding retains its old behavior.
                // Normal supported text formats keep the existing single-read
                // path so opening TXT/PY/LOG does not acquire an extra probe.
                if (forceEncoding is null &&
                    (BinaryPreview.IsKnownBinaryExtension(path) ||
                    (!TextFileTypes.SupportedExtensions.Contains(Path.GetExtension(path), StringComparer.OrdinalIgnoreCase) &&
                    BinaryPreview.IsProbablyBinary(path))))
                {
                    ShowBinary(path, origin);
                    continue;
                }
                if (!ConfirmLargeFile(path, origin ?? lastActive)) continue;
                if (initializing) StartupTrace.Mark(StartupStage.FileReadStart);
                DocumentData doc;
                try { doc = Storage.ReadFile(path, forceEncoding: forceEncoding); }
                catch (Exception ex) when (forceEncoding is null && (ex is BinaryContentException || ex is System.Text.DecoderFallbackException))
                {
                    ShowBinary(path, origin);
                    continue;
                }
                if (initializing) StartupTrace.Mark(StartupStage.FileReadComplete);
                Recent.Touch(path);
                if (initializing) StartupTrace.Mark(StartupStage.RecentUpdated);
                var target = Settings.OpenPolicy == "windows" || (origin ?? lastActive) is null ? AddWindow(new RecoveryData { Documents = [doc] }) : origin ?? lastActive!;
                if (!target.Documents.ContainsKey(doc.Id)) target.AddDocument(doc);
                if (initializing) StartupTrace.Mark(target.IsStartupTraceWindow ? StartupStage.CommandFileInTracedWindow : StartupStage.CommandFileInOtherWindow);
                target.BringForward();
            }
            catch (Exception ex) { Storage.Log(ex); MessageBox.Show(UiLanguage.T("ファイルを開けませんでした。\n", "Could not open the file.\n") + candidate + "\n\n" + ex.Message, AppInfo.Title, MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        }
    }
    private void ShowBinary(string path, EditorWindow? origin)
    {
        // The normal editor remains the application owner. The binary form is
        // read-only and does not register the source as an editable document.
        var owner = origin ?? lastActive ?? AddWindow();
        var viewer = new BinaryViewer(path);
        viewer.Show(owner);
    }
    public async Task UpdateSettings(AppSettings settings)
    {
        settings.NormalizePresentation();
        settings.WelcomeShown |= Settings.WelcomeShown;
        settings.UpdateCheckDays=Math.Clamp(settings.UpdateCheckDays,-1,365);
        settings.FontSize = Math.Clamp(settings.FontSize, 11, 28); settings.Ratio = Math.Clamp(settings.Ratio, .22, .78); settings.Limit = Math.Clamp(settings.Limit, 32, 100000);
        settings.OpenPolicy = settings.OpenPolicy == "windows" ? "windows" : "tabs";
        var languageChanged = Settings.Language != settings.Language;
        Settings = settings; UiLanguage.Current = settings.Language; await Storage.AtomicText(Storage.SettingsPath, JsonSerializer.Serialize(settings, Storage.Json));
        if (languageChanged) { try { ContextMenuRegistration.RefreshLanguage(); } catch (Exception ex) { Storage.Log(ex); } }
        foreach (var w in Windows) w.Emit(new { type = "settings-changed", settings });
    }
    public async Task<bool> ClaimWelcome(bool noInitialDocuments)
    {
        if (!noInitialDocuments || Settings.WelcomeShown) return false;
        // Claim before awaiting disk I/O so simultaneous empty windows show one guide.
        Settings.WelcomeShown = true;
        try { await Storage.AtomicText(Storage.SettingsPath, JsonSerializer.Serialize(Settings, Storage.Json)); }
        catch (Exception ex) { Storage.Log(ex); }
        return true;
    }
    public async Task BeginUpdate()
    {
        if(preparingUpdate)return;
        var session=Guid.NewGuid().ToString("N");
        updateReady.Clear();preparingUpdate=true;updateSession=session;updateWatchdog.Start();
        try
        {
            await Updates.VerifiedInstaller();
            if(!preparingUpdate||updateSession!=session)return;
            foreach(var window in Windows.ToArray())window.Emit(new{type="update-close-request",session});
        }
        catch{if(updateSession==session)AbortUpdate();throw;}
    }
    public void AbortUpdate(string? message=null)
    {
        if(!preparingUpdate)return;
        var session=updateSession;updateWatchdog.Stop();updateSession=null;preparingUpdate=false;updateReady.Clear();
        foreach(var window in Windows.ToArray())
        {
            try{window.Emit(new{type="update-aborted",session,message});}
            catch(Exception ex){Storage.Log(ex);}
        }
    }
    public async Task ReadyForUpdate(EditorWindow window,bool accepted,string? session)
    {
        if(!preparingUpdate||session!=updateSession)return;if(!accepted){AbortUpdate();return;}updateReady.Add(window);
        if(Windows.Any(w=>!updateReady.Contains(w)))return;
        try
        {
            var installer=await Updates.VerifiedInstaller();if(!preparingUpdate||updateSession!=session||Windows.Any(w=>!updateReady.Contains(w)))return;
            Maintenance.StartSetup(installer,true);updateWatchdog.Stop();preparingUpdate=false;updateSession=null;
            foreach(var w in Windows.ToArray())w.CloseForUpdate();
        }
        catch{if(updateSession==session)AbortUpdate();throw;}
    }
    private async Task ListenPipe()
    {
        while (!cancellation.IsCancellationRequested)
        {
            try
            {
                await using var server = new NamedPipeServerStream(Program.PipeName, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await server.WaitForConnectionAsync(cancellation.Token); using var reader = new StreamReader(server);
                using var readTimeout=CancellationTokenSource.CreateLinkedTokenSource(cancellation.Token);readTimeout.CancelAfter(TimeSpan.FromSeconds(5));
                var line = await PipeMessagePolicy.ReadLine(reader, readTimeout.Token); if (line is null) continue;
                var args = PipeMessagePolicy.Decode(line);
                var target = lastActive ?? Windows.FirstOrDefault(); if (target is null || target.IsDisposed) continue;
                target.BeginInvoke(() => { if (args.Contains("--new-in-directory") || args.Contains("--new-in-desktop")) { RouteNewDirectory(args, target); return; } var files = args.Where(a => !a.StartsWith("--") && File.Exists(a)).ToArray(); if (files.Length > 0) RouteFiles(files, lastActive); else target.BringForward(); });
            }
            catch (OperationCanceledException) { if(cancellation.IsCancellationRequested) break; }
            catch (Exception ex) { Storage.Log(ex); await Task.Delay(250); }
        }
    }
}

