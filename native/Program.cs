using System.IO.Pipes;
using System.Text.Json;

namespace MdSplit;

internal static class Program
{
    public static readonly string PipeName = "MD-Split-" + Storage.Hash(System.Text.Encoding.UTF8.GetBytes(Environment.UserName))[..16];
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize(); Storage.Initialize();
        Application.ThreadException += (_, e) => { Storage.Log(e.Exception); MessageBox.Show("処理中にエラーが発生しました。\n" + e.Exception.Message, AppInfo.Title, MessageBoxButtons.OK, MessageBoxIcon.Error); };
        AppDomain.CurrentDomain.UnhandledException += (_, e) => { if(e.ExceptionObject is Exception ex) Storage.Log(ex); };
        try
        {
            if (args.Contains("--register-only")||args.Contains("--register-quiet")) { Storage.RegisterAssociation(); if(!args.Contains("--register-quiet"))MessageBox.Show("対応ファイルの候補にMD-CSV Split Editorを登録しました。既定のアプリはWindowsの設定で拡張子ごとに選んでください。", AppInfo.Title); return; }
            if(args.Contains("--unregister-quiet")){Maintenance.Unregister();return;}
            if(args.Contains("--repair")){Maintenance.Repair();return;}
            var record=Array.IndexOf(args,"--record-installer");if(record>=0){if(record+1>=args.Length)throw new IOException("修復用ファイルがありません。");Maintenance.RecordInstaller(args[record+1]);return;}
        }
        catch(Exception ex){Storage.Log(ex);MessageBox.Show(ex.Message,AppInfo.Title,MessageBoxButtons.OK,MessageBoxIcon.Warning);Environment.ExitCode=1;return;}
        using var mutex = new Mutex(true, "Local\\" + PipeName, out var first);
        if (!first)
        {
            try { var message=PipeMessagePolicy.Encode(args.Select(a=>a.StartsWith("--")?a:Path.GetFullPath(a)).ToArray()); using var client = new NamedPipeClientStream(".", PipeName, PipeDirection.Out); client.Connect(5000); using var writer = new StreamWriter(client); writer.WriteLine(message); }
            catch (Exception ex) { MessageBox.Show("起動中のMD-CSV Split Editorへファイルを渡せませんでした。\n" + ex.Message, AppInfo.Title); }
            return;
        }
        using var context = new EditorContext(args); Application.Run(context); context.Updates.Dispose(); mutex.ReleaseMutex();
    }
}

internal sealed class EditorContext : ApplicationContext
{
    public bool ConfirmLargeFile(string path, IWin32Window? owner = null) => Storage.ApproveLargeFile(path, size =>
        MessageBox.Show(owner, $"このファイルは約{size / 1024.0 / 1024.0:N1} MiBあります。\n読み込みや編集に時間がかかり、メモリを多く使用する場合があります。\n\n開きますか？", "大きなファイルを開く", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) == DialogResult.Yes);
    public RecentFiles Recent { get; } = new(Path.Combine(Storage.Root,"recent.json"));
    public UpdateService Updates { get; } = new();
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
    public EditorContext(string[] args)
    {
        updateWatchdog.Tick+=(_,_)=>{if(preparingUpdate)AbortUpdate("更新の準備が完了しなかったため中止しました。編集を続けられます。");};
        var restored = false;
        var sessionWarnings = new List<string>();
        var sessions = new Dictionary<string,SessionSnapshot>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in Directory.GetFiles(Storage.SessionPath, "*.json"))
        {
            try
            {
                if (!Guid.TryParseExact(Path.GetFileNameWithoutExtension(file), "N", out _)) throw new IOException("タブの復元情報の名前が正しくありません。");
                sessions.Add(file, SessionStore.Read(file));
            }
            catch (Exception ex) { Storage.Log(ex); sessionWarnings.Add("保存されたタブの情報を読み取れませんでした。\n" + ex.Message); }
        }
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
            catch (Exception ex) { Storage.Log(ex); sessionWarnings.Add("保存されたタブの情報を読み取れませんでした。\n" + ex.Message); }
        }
        var files = args.Where(a => !a.StartsWith("--") && File.Exists(a)).ToArray();
        if (files.Length > 0) RouteFiles(files, lastActive);
        else if (!restored) AddWindow();
        if(Windows.Count==0)AddWindow();
        if (sessionWarnings.Count > 0) MessageBox.Show("前回のタブの一部を開けませんでした。\n\n" + string.Join("\n\n", sessionWarnings), AppInfo.Title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
        pipeTask = ListenPipe();
    }
    protected override void Dispose(bool disposing)
    {
        if(disposing&&!contextDisposed)
        {
            contextDisposed=true;
            updateWatchdog.Stop();updateWatchdog.Dispose();cancellation.Cancel();
            // The pipe listener may still be unwinding from an asynchronous read.
            // Dispose its token source only after that operation has finished.
            if(pipeTask is null || pipeTask.IsCompleted)cancellation.Dispose();
            else _=pipeTask.ContinueWith(_=>cancellation.Dispose(),TaskScheduler.Default);
        }
        base.Dispose(disposing);
    }
    public EditorWindow AddWindow(RecoveryData? initial = null, bool recovered = false, string? recoveryFile = null, string? sessionFile = null)
    {
        if(preparingUpdate)AbortUpdate();
        var window = new EditorWindow(this, initial, recovered, recoveryFile, sessionFile); Windows.Add(window); lastActive = window;
        window.Activated += (_, _) => lastActive = window;
        window.FormClosed += (_, _) => { if(preparingUpdate)AbortUpdate(); Windows.Remove(window); if (lastActive == window) lastActive = Windows.LastOrDefault(); if (Windows.Count == 0) { cancellation.Cancel(); ExitThread(); } };
        window.Show(); return window;
    }
    public void NewFile(EditorWindow origin, string? name = null)
    {
        var document = TextFileTypes.NewDocument(name);
        if (Settings.OpenPolicy == "windows") AddWindow(new RecoveryData { Documents = [document], ActiveId = document.Id }); else origin.Emit(new { type = "new-document", document });
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
                    existing.Window.BringForward(); existing.Window.Emit(new { type = "activate-document", id = existing.Doc.Id });
                    if (forceEncoding is not null) existing.Window.Emit(new { type = "encoding-open-existing", id = existing.Doc.Id, name = existing.Doc.Name });
                    continue;
                }
                if (!ConfirmLargeFile(path, origin ?? lastActive)) continue;
                var doc = Storage.ReadFile(path, forceEncoding: forceEncoding); Recent.Touch(path);
                var target = Settings.OpenPolicy == "windows" || (origin ?? lastActive) is null ? AddWindow(new RecoveryData { Documents = [doc] }) : origin ?? lastActive!;
                if (!target.Documents.ContainsKey(doc.Id)) target.AddDocument(doc);
                target.BringForward();
            }
            catch (Exception ex) { Storage.Log(ex); MessageBox.Show("ファイルを開けませんでした。\n" + candidate + "\n\n" + ex.Message, AppInfo.Title, MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        }
    }
    public async Task UpdateSettings(AppSettings settings)
    {
        settings.NormalizePresentation();
        settings.WelcomeShown |= Settings.WelcomeShown;
        settings.UpdateCheckDays=Math.Clamp(settings.UpdateCheckDays,-1,365);
        settings.FontSize = Math.Clamp(settings.FontSize, 11, 28); settings.Ratio = Math.Clamp(settings.Ratio, .22, .78); settings.Limit = Math.Clamp(settings.Limit, 32, 100000);
        settings.OpenPolicy = settings.OpenPolicy == "windows" ? "windows" : "tabs";
        Settings = settings; await Storage.AtomicText(Storage.SettingsPath, JsonSerializer.Serialize(settings, Storage.Json));
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
                target.BeginInvoke(() => { var files = args.Where(a => !a.StartsWith("--") && File.Exists(a)).ToArray(); if (files.Length > 0) RouteFiles(files, lastActive); else target.BringForward(); });
            }
            catch (OperationCanceledException) { if(cancellation.IsCancellationRequested) break; }
            catch (Exception ex) { Storage.Log(ex); await Task.Delay(250); }
        }
    }
}
