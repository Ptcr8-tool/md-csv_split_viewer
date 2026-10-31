using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Net;

namespace MdSplit;

internal sealed class EditorWindow : Form
{
    private const string AppOrigin = UiContent.Origin;
    private readonly EditorContext context;
    private readonly WebView2 web = new() { Dock = DockStyle.Fill };
    private readonly string recoveryFile;
    private readonly RecoveryStore recoveryStore;
    private readonly SemaphoreSlim recoveryGate = new(1,1);
    private readonly RecoveryData initial;
    private readonly SearchTextCache searchTextCache = new();
    private readonly bool recovered;
    private bool ready, allowClose, pollBusy, preserveRecovery;
    private SessionSnapshot? pendingSession;
    private string? sourceSessionFile;
    private readonly string cleanSessionFile = Path.Combine(Storage.SessionPath, Guid.NewGuid().ToString("N") + ".json");
    internal bool IsSessionClosing => allowClose || IsDisposed || Disposing;
    private readonly Queue<object> queued = new();
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 1800 };
    private readonly Dictionary<string, DateTime> writeTimes = [];
    private readonly Dictionary<string, DateTime> pollRetryAfter = [];
    private readonly System.Collections.Concurrent.ConcurrentDictionary<string, byte> pollInFlight = new(StringComparer.Ordinal);
    private readonly Dictionary<string, (string? PreviousFingerprint, DocumentData Changed)> pendingExternal = [];
    private readonly HashSet<PanePopup> paneWindows = [];
    public Dictionary<string, DocumentData> Documents { get; } = [];
    public EditorWindow(EditorContext context, RecoveryData? initial = null, bool recovered = false, string? recoveryFile = null, string? sessionFile = null)
    {
        this.context = context; this.initial = initial ?? new(); this.recovered = recovered; this.sourceSessionFile = sessionFile; this.recoveryFile=recoveryFile??Path.Combine(Storage.RecoveryPath,Guid.NewGuid().ToString("N")+".json");recoveryStore=new RecoveryStore(this.recoveryFile);preserveRecovery=recovered;
        Text = AppInfo.Title; Width = 1300; Height = 860; MinimumSize = new Size(800, 560); StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(245, 245, 241); AutoScaleMode = AutoScaleMode.Dpi;
        var icon = Path.Combine(AppContext.BaseDirectory, "app.ico"); if (File.Exists(icon)) Icon = new Icon(icon);
        foreach (var d in this.initial.Documents) Track(d);
        Controls.Add(web); Shown += async (_, _) => await InitializeWeb();
        FormClosing += (_, e) => { if (!allowClose && ready) { e.Cancel = true; Emit(new { type = "close-request" }); } else ClosePaneWindows(); };
        FormClosed += (_, _) => { timer.Stop(); timer.Dispose(); ClosePaneWindows(); web.Dispose(); if(!preserveRecovery) RecoveryStore.Delete(recoveryFile); };
        timer.Tick += async (_, _) => await PollFiles();
    }
    public void CloseForUpdate(){preserveRecovery=true;allowClose=true;Close();}
    public void BringForward() { if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal; Show(); Activate(); }
    public void AddDocument(DocumentData doc) { Track(doc); if (ready) Emit(new { type = "files-opened", documents = new[] { doc } }); else if (!initial.Documents.Any(d => d.Id == doc.Id)) initial.Documents.Add(doc); }
    public void Emit(object message) { if (!ready) { queued.Enqueue(message); return; } if (!IsDisposed) web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(message, Storage.Json)); }
    private void Track(DocumentData doc)
    {
        if (!Guid.TryParse(doc.Id, out _)) throw new IOException("文書IDが正しくありません。");
        Documents[doc.Id] = doc;
        // The first background poll will establish the timestamp without blocking
        // the editor when the document is on a slow or unavailable drive.
        if (doc.Path is not null && !writeTimes.ContainsKey(doc.Id)) writeTimes[doc.Id] = DateTime.MinValue;
    }
    private async Task InitializeWeb()
    {
        try
        {
            var contentFolder = UiContent.GetFolder(AppContext.BaseDirectory);
            var runtime=Path.Combine(AppContext.BaseDirectory,"WebView2Runtime");if(!File.Exists(Path.Combine(runtime,"msedgewebview2.exe")))throw new IOException("同梱の表示環境が見つかりません。セットアップの「修復」を実行してください。");
            var environment = await CoreWebView2Environment.CreateAsync(runtime, Path.Combine(Storage.Root, "WebView2"),new CoreWebView2EnvironmentOptions { AdditionalBrowserArguments="--disable-background-networking --disable-component-update", IsCustomCrashReportingEnabled=true });
            await web.EnsureCoreWebView2Async(environment);
            var core = web.CoreWebView2;
            PrepareWebView(core, contentFolder);
            AttachEditorAccelerators(web, core);
            AttachWebViewHandlers(core, environment, contentFolder);
            UiContent.Navigate(core.Navigate); timer.Start();
        }
        catch (WebView2RuntimeNotFoundException)
        {
            MessageBox.Show(this,"同梱のWebView2 Runtimeを起動できません。セットアップの「修復」を実行してください。",AppInfo.Title,MessageBoxButtons.OK,MessageBoxIcon.Warning);
            allowClose = true; Close();
        }
        catch (Exception ex) { Storage.Log(ex); MessageBox.Show(this, "起動できませんでした。\n" + ex.Message, AppInfo.Title, MessageBoxButtons.OK, MessageBoxIcon.Error); allowClose = true; Close(); }
    }
    private static void PrepareWebView(CoreWebView2 core, string contentFolder)
    {
        core.SetVirtualHostNameToFolderMapping(UiContent.HostName, contentFolder, CoreWebView2HostResourceAccessKind.DenyCors);
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsWebMessageEnabled = true;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreHostObjectsAllowed = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
    }
    private static void AttachEditorAccelerators(WebView2 view, CoreWebView2 core)
    {
        // WinForms forwards controller accelerator events through KeyDown, including iframe focus.
        view.KeyDown += (_, e) =>
        {
            var command = EditorAccelerators.CommandFor((int)e.KeyCode, e.Control, e.Alt, e.Shift);
            if (command is null) return;
            e.Handled = true; e.SuppressKeyPress = true;
            // Accelerator callbacks block the browser process; post commands after returning.
            view.BeginInvoke(() =>
            {
                if (view.IsDisposed || view.Disposing) return;
                try { core.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "editor-command", command }, Storage.Json)); }
                catch (Exception ex) { Storage.Log(ex); }
            });
        };
    }
    private void AttachWebViewHandlers(CoreWebView2 core, CoreWebView2Environment environment, string contentFolder, PanePopup? popup = null)
    {
        core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
        core.NavigationStarting += (_, e) =>
        {
            if (popup is not null)
            {
                e.Cancel = !PaneWindowPolicy.TryGetPane(e.Uri, out var pane) || pane != popup.Pane;
                return;
            }
            if (UiContent.IsRootUrl(e.Uri))
            {
                e.Cancel = true;
                BeginInvoke(() => { if (!IsDisposed) UiContent.Navigate(core.Navigate); });
                return;
            }
            if (!e.Uri.StartsWith(AppOrigin, StringComparison.OrdinalIgnoreCase)) e.Cancel = true;
        };
        core.NavigationCompleted += (_, e) =>
        {
            if (e.IsSuccess || e.WebErrorStatus == CoreWebView2WebErrorStatus.OperationCanceled) return;
            Storage.Log(new IOException($"UI navigation failed: {core.Source}; error={e.WebErrorStatus}; contentFolder={contentFolder}"));
            if (popup is not null) { popup.ForceClose(); NotifyPane(new { type = "pane-window-error", pane = popup.Pane, message = "別ウィンドウを読み込めませんでした。" }); }
            else if (!ready && !allowClose)
                MessageBox.Show(this, "画面を読み込めませんでした。\nエラー: " + e.WebErrorStatus + "\n\n詳しい原因をエラーログへ記録しました。", AppInfo.Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
        };
        core.NewWindowRequested += async (_, e) =>
        {
            e.Handled = true;
            if (PaneWindowPolicy.TryGetPane(e.Uri, out var pane))
            {
                if (popup is not null || !e.IsUserInitiated || IsDisposed || allowClose || !ready) return;
                using var deferral = e.GetDeferral();
                PanePopup? child = null;
                try
                {
                    child = new PanePopup(pane, Icon);
                    paneWindows.Add(child);
                    child.FormClosed += (_, _) =>
                    {
                        paneWindows.Remove(child);
                        NotifyPane(new { type = "pane-window-closed", pane });
                    };
                    // Do not navigate this WebView: NewWindow must receive an untouched view.
                    _ = child.Handle;
                    await child.Web.EnsureCoreWebView2Async(environment);
                    if (IsDisposed || allowClose || child.IsDisposed) { child.Dispose(); return; }
                    PrepareWebView(child.Web.CoreWebView2, contentFolder);
                    AttachEditorAccelerators(child.Web, child.Web.CoreWebView2);
                    e.NewWindow = child.Web.CoreWebView2;
                    // Resource handlers belong to the new web contents, after NewWindow is set.
                    AttachWebViewHandlers(child.Web.CoreWebView2, environment, contentFolder, child);
                    child.Show(this);
                }
                catch (Exception ex)
                {
                    Storage.Log(ex);
                    child?.Dispose();
                    if (child is not null) paneWindows.Remove(child);
                    NotifyPane(new { type = "pane-window-error", pane, message = "別ウィンドウを開けませんでした。" });
                }
            }
            else if (e.IsUserInitiated && !e.Uri.StartsWith(AppOrigin, StringComparison.OrdinalIgnoreCase) && SafeLinks.IsBrowserUrl(e.Uri))
            {
                try { Process.Start(new ProcessStartInfo(e.Uri) { UseShellExecute = true }); }
                catch (Exception ex) { Storage.Log(ex); }
            }
        };
        core.AddWebResourceRequestedFilter("https://assets.mdsplit.local/*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += (_, e) => ServeImage(environment, e);
        core.WebMessageReceived += async (_, e) =>
        {
            if (!e.Source.StartsWith(AppOrigin, StringComparison.OrdinalIgnoreCase) || popup is { IsDisposed: true }) return;
            string? id = null;
            try
            {
                using var json = JsonDocument.Parse(e.WebMessageAsJson);
                var root = json.RootElement; id = root.GetProperty("id").GetString();
                var method = root.GetProperty("method").GetString()!;
                object? result;
                if (popup is not null && method == "window.title") { popup.Text = root.GetProperty("args").GetProperty("title").GetString(); result = true; }
                else if (popup is not null && method == "window.close") { popup.BeginInvoke(popup.ForceClose); result = true; }
                else if (method == "print.show") { core.ShowPrintUI(); result = true; }
                else if (popup is not null && method is "bootstrap" or "recovery.write" or "update.ready") throw new IOException("別ウィンドウは元の編集ウィンドウを通して操作してください。");
                else if (method == "file.drop")
                {
                    // Accept native-backed File objects rather than paths supplied in JSON.
                    // File objects created by script have no native path and cannot open arbitrary files.
                    var files = e.AdditionalObjects.OfType<CoreWebView2File>().ToArray();
                    if (files.Length == 0 || files.Length != e.AdditionalObjects.Count || files.Any(file => string.IsNullOrWhiteSpace(file.Path)))
                        throw new IOException("ドロップしたファイルの場所を取得できません。開くボタンから選択してください。");
                    context.RouteFiles(files.Select(file => file.Path), this);
                    result = true;
                }
                else result = await HandleMessage(method, root.GetProperty("args"));
                if (!IsDisposed && popup is not { IsDisposed: true }) core.PostWebMessageAsJson(JsonSerializer.Serialize(new { replyTo = id, result }, Storage.Json));
            }
            catch (Exception ex)
            {
                Storage.Log(ex);
                var message = ex is EncoderFallbackException ? "選択した文字コードでは保存できない文字が含まれています。下部の文字コードをUTF-8へ変更して保存してください。" : ex is DecoderFallbackException ? "この文字コードでは読み込めません。別の文字コードを指定してください。" : ex.Message;
                if (id is not null && !IsDisposed && popup is not { IsDisposed: true }) core.PostWebMessageAsJson(JsonSerializer.Serialize(new { replyTo = id, error = message }, Storage.Json));
            }
        };
        core.WindowCloseRequested += (_, _) => { if (popup is not null && !popup.IsDisposed) popup.Close(); };
        core.ProcessFailed += (_, _) =>
        {
            if (popup is not null)
            {
                if (!popup.IsDisposed) popup.ForceClose();
                NotifyPane(new { type = "pane-window-error", pane = popup.Pane, message = "別ウィンドウの表示が終了しました。元の編集内容は保持されています。" });
                return;
            }
            preserveRecovery = true; ready = false; ClosePaneWindows();
            MessageBox.Show(this, "表示プロセスが終了しました。アプリを開き直すと復元データを読み込めます。", AppInfo.Title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
        };
    }
    private void ClosePaneWindows()
    {
        foreach (var popup in paneWindows.ToArray()) if (!popup.IsDisposed) popup.ForceClose();
        paneWindows.Clear();
    }
    private void NotifyPane(object message)
    {
        if (IsDisposed || Disposing || allowClose || !ready) return;
        try { Emit(message); } catch (Exception ex) { Storage.Log(ex); }
    }
    private sealed class PanePopup : Form
    {
        private bool allowClose;
        public string Pane { get; }
        public WebView2 Web { get; } = new() { Dock = DockStyle.Fill };
        public PanePopup(string pane, Icon? icon)
        {
            Pane = pane;
            Text = pane == "source" ? $"Markdown原文 — {AppInfo.Title}" : $"展開表示 — {AppInfo.Title}";
            Width = 850; Height = 820; MinimumSize = new Size(480, 360);
            StartPosition = FormStartPosition.CenterParent; AutoScaleMode = AutoScaleMode.Dpi;
            if (icon is not null) Icon = (Icon)icon.Clone();
            Controls.Add(Web);
            FormClosing += (_, e) =>
            {
                if (allowClose || Web.CoreWebView2 is null) return;
                try
                {
                    e.Cancel = true;
                    Web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "pane-close-request", pane = Pane }, Storage.Json));
                }
                catch (Exception ex) { Storage.Log(ex); e.Cancel = false; }
            };
            FormClosed += (_, _) => Web.Dispose();
        }
        public void ForceClose() { allowClose = true; Close(); }
    }
    private async Task<object?> HandleMessage(string method, JsonElement args)
    {
        switch (method)
        {
            case "bootstrap":
                var showWelcome = await context.ClaimWelcome(initial.Documents.Count == 0);
                ready = true; preserveRecovery=false;
                // Deliver queued opens only after the page has applied its initial documents.
                _ = Task.Delay(200).ContinueWith(_ => { if(!IsDisposed) BeginInvoke(() => { while(queued.Count>0) Emit(queued.Dequeue()); }); });
                return new { settings = context.Settings, documents = initial.Documents, mode = initial.Mode, activeId = initial.ActiveId, recoveryReason=initial.Reason, recovered, showWelcome };
            case "window.title": Text = args.GetProperty("title").GetString(); return true;
            case "window.focus": BringForward(); return true;
            case "document.register":
                DocumentAuthority.RegisterUnsaved(Documents, args.GetProperty("id").GetString(), args.TryGetProperty("name", out var documentName) ? documentName.GetString() : null);
                return true;
            case "document.close":
                var closeId = args.GetProperty("id").GetString();
                DocumentAuthority.Require(Documents, closeId);
                Documents.Remove(closeId!); writeTimes.Remove(closeId!); pollRetryAfter.Remove(closeId!); pendingExternal.Remove(closeId!); searchTextCache.Remove(closeId);
                return true;
            case "file.accept-change":
                var changedId = args.GetProperty("id").GetString();
                var changedFingerprint = args.GetProperty("fingerprint").GetString();
                var currentDoc = DocumentAuthority.Require(Documents, changedId);
                if (!pendingExternal.TryGetValue(changedId!, out var pending) || pending.Changed.Fingerprint != changedFingerprint || currentDoc.Fingerprint != pending.PreviousFingerprint || !string.Equals(currentDoc.Path, pending.Changed.Path, StringComparison.OrdinalIgnoreCase))
                    throw new IOException("ファイルの変更状態が更新されました。開き直してください。");
                Track(pending.Changed); pendingExternal.Remove(changedId!); return true;
            case "file.new": context.NewFile(this, args.TryGetProperty("name", out var newName) ? newName.GetString() : null); return true;
            case "file.open":
                var openEncoding = args.TryGetProperty("encoding", out var requestedEncoding) ? requestedEncoding.GetString() : null;
                using (var dialog = new OpenFileDialog { Filter = TextFileTypes.OpenFilter, Multiselect = true, RestoreDirectory = true, Title = "テキスト・ソースファイルを開く" })
                    if(dialog.ShowDialog(this) == DialogResult.OK) context.RouteFiles(dialog.FileNames, this, openEncoding);
                return null;
            case "recent.list": return context.Recent.List();
            case "recent.open": context.RouteFiles([context.Recent.Resolve(args.GetProperty("id").GetString()!)],this);return true;
            case "recent.clear": context.Recent.Clear();return true;
            case "search.run":
                var request=args.Deserialize<SearchRequest>(Storage.Json)??new();
                if(args.TryGetProperty("docId",out var searchDocument)&&args.TryGetProperty("cacheToken",out var searchToken))
                {
                    var docId=searchDocument.GetString()??"";var token=searchToken.GetString()??"";
                    if(!Guid.TryParse(docId,out _)||!Guid.TryParse(token,out _))throw new IOException("検索対象が正しくありません。");
                    if(args.TryGetProperty("text",out _))searchTextCache.Put(docId,token,request.Text);
                    else { var cached=searchTextCache.Get(docId,token);if(cached is null)return new{cacheMiss=true};request.Text=cached; }
                }
                return await Task.Run(()=>SearchEngine.Run(request));
            case "update.check": var checkDays=context.Settings.UpdateCheckDays;var manualCheck=args.TryGetProperty("manual",out var manual)&&manual.GetBoolean();return await Task.Run(()=>context.Updates.Check(checkDays,manualCheck));
            case "update.download": await context.Updates.Download(args.GetProperty("version").GetString()!,percent=>{if(!IsDisposed)Emit(new{type="update-progress",percent});});return true;
            case "update.cancel": context.Updates.Cancel();return true;
            case "update.prepare": await context.BeginUpdate();return true;
            case "update.ready": await context.ReadyForUpdate(this,args.GetProperty("ready").GetBoolean(),args.TryGetProperty("session",out var updateSession)?updateSession.GetString():null);return true;
            case "file.save": return await SaveDocument(args);
            case "csv.view.save":
                if (!Documents.TryGetValue(args.GetProperty("id").GetString()!, out var csvSaveDoc) || csvSaveDoc.Path is null) throw new IOException("先にCSV・TSVを保存してください。");
                var csvViewPath = CsvViewStore.SidecarPath(csvSaveDoc.Path);
                var csvView = CsvViewStore.ValidateView(args.GetProperty("view"));
                if (File.Exists(csvViewPath) && MessageBox.Show(this, $"{Path.GetFileName(csvViewPath)}\n\n表示設定を上書きしますか？", "CSVの表示設定", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return null;
                await CsvViewStore.Save(csvSaveDoc.Path, csvView);
                return new { fileName = Path.GetFileName(csvViewPath) };
            case "csv.view.load":
                if (!Documents.TryGetValue(args.GetProperty("id").GetString()!, out var csvLoadDoc) || csvLoadDoc.Path is null) throw new IOException("先にCSV・TSVを保存してください。");
                return CsvViewStore.Load(csvLoadDoc.Path);
            case "file.reopen":
                if(!Documents.TryGetValue(args.GetProperty("id").GetString()!,out var existing)||existing.Path is null)throw new IOException("元ファイルが見つかりません。");
                if(!context.ConfirmLargeFile(existing.Path,this))return null;
                var reopened=Storage.ReadFile(existing.Path,existing.Id,args.GetProperty("encoding").GetString());Track(reopened);pendingExternal.Remove(existing.Id);return reopened;
            case "settings.set": var s = args.Deserialize<AppSettings>(Storage.Json) ?? new(); await context.UpdateSettings(s); return s;
            case "session.save":
                var sessionIds = args.GetProperty("documentIds").Deserialize<List<string>>(Storage.Json) ?? throw new IOException("タブ一覧が正しくありません。");
                pendingSession = SessionStore.Capture(args.GetProperty("policy").GetString(), sessionIds,
                    args.TryGetProperty("activeId", out var sessionActive) ? sessionActive.GetString() : null,
                    args.TryGetProperty("mode", out var sessionMode) ? sessionMode.GetString() : null, Documents);
                return true;
            case "recovery.write":
                var recovery = args.Deserialize<RecoveryData>(Storage.Json) ?? new();
                var recoveryOrder = args.TryGetProperty("documentIds", out var idsElement)
                    ? idsElement.Deserialize<List<string>>(Storage.Json) ?? throw new IOException("復元データが正しくありません。")
                    : recovery.Documents.Select(d => d.Id).ToList();
                await recoveryGate.WaitAsync();
                try
                {
                    if (!IsDisposed)
                    {
                        foreach (var id in recoveryOrder) DocumentAuthority.Require(Documents, id);
                        // Accept text and presentation only; native retains paths and saved baselines.
                        recovery.Documents = recovery.Documents.Select(d => DocumentAuthority.Merge(Documents, d)).ToList();
                        foreach (var d in recovery.Documents) Track(d);
                        // Keep the previous clean session until a complete crash
                        // snapshot has actually committed, including all tabs.
                        if (await SessionStore.CommitRecovery(recoveryStore, recovery, recoveryOrder, sourceSessionFile)) sourceSessionFile = null;
                    }
                    if(IsDisposed&&!preserveRecovery)RecoveryStore.Delete(recoveryFile);
                }
                finally { recoveryGate.Release(); }
                return true;
            case "image.import":
                var imageInput = args.GetProperty("document").Deserialize<DocumentData>(Storage.Json) ?? throw new IOException("文書が見つかりません。");
                var imageDoc = DocumentAuthority.Merge(Documents, imageInput);
                if (!TextFileTypes.IsMarkdown(imageDoc.Path ?? imageDoc.Name)) throw new IOException("画像の挿入はMarkdown文書で利用できます。");
                Track(imageDoc);
                var originalName = Path.GetFileName(args.GetProperty("name").GetString() ?? "image.png");
                var ext = Path.GetExtension(originalName).ToLowerInvariant(); if (!new[] { ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg" }.Contains(ext)) ext = ".png";
                var bytes = Convert.FromBase64String(args.GetProperty("base64").GetString()!); if(bytes.Length > 32*1024*1024) throw new IOException("画像は1枚32MBまでです。");
                var filename = "image-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N")[..6] + ext;
                var directory = imageDoc.Path is null ? Storage.StagingDirectory(imageDoc.Id) : Storage.AssetsDirectory(imageDoc.Path);
                await Storage.AtomicBytes(Path.Combine(directory, filename), bytes);
                return new { url = imageDoc.Path is null ? "mdsplit-asset://" + imageDoc.Id + "/" + filename : Storage.UrlPath(Path.GetFileName(directory) + "/" + filename) };
            case "clipboard.text": if(args.GetProperty("text").GetString() is {Length:>0} text) Clipboard.SetText(text); else Clipboard.Clear(); return true;
            case "clipboard.readText": return Clipboard.ContainsText() ? Clipboard.GetText(TextDataFormat.UnicodeText) : null;
            case "clipboard.rich":
                var data = new DataObject(); var html = args.GetProperty("html").GetString() ?? "";
                data.SetData(DataFormats.Html, ClipboardHtml.Build(html));
                data.SetText(args.GetProperty("text").GetString() ?? "", TextDataFormat.UnicodeText); Clipboard.SetDataObject(data, true); return true;
            case "clipboard.image":
                using (var stream = new MemoryStream(Convert.FromBase64String(args.GetProperty("base64").GetString()!)))
                using (var bitmap = new Bitmap(stream)) Clipboard.SetImage(new Bitmap(bitmap)); return true;
            case "file.export":
                using (var dialog = new SaveFileDialog { FileName = Path.GetFileName(args.GetProperty("name").GetString()), InitialDirectory = Storage.DefaultSaveDirectory(), Title = "ファイルを保存" })
                    if (dialog.ShowDialog(this) == DialogResult.OK) { await Storage.AtomicBytes(dialog.FileName!, Convert.FromBase64String(args.GetProperty("base64").GetString()!)); return true; }
                return false;
            case "shell.open": var url = args.GetProperty("url").GetString()!; if(!SafeLinks.IsBrowserUrl(url))throw new IOException("このリンクは開けません。"); Process.Start(new ProcessStartInfo(url){UseShellExecute=true}); return true;
            case "association.register": Storage.RegisterAssociation(); Process.Start(new ProcessStartInfo(Storage.CurrentDefaultAppsSettingsUri()){UseShellExecute=true}); return true;
            case "window.close":
                allowClose = true;
                try
                {
                    // Every normal close commits a marker excluding its old
                    // recovery. Only the last window records restorable tabs.
                    var finalWindow = !context.Windows.Any(w => !w.IsSessionClosing);
                    var marker = finalWindow && pendingSession is not null ? pendingSession : new SessionSnapshot();
                    marker.ClosedRecoveryId = Path.GetFileNameWithoutExtension(recoveryFile);
                    marker.PreviousSessionId = sourceSessionFile is null ? null : Path.GetFileNameWithoutExtension(sourceSessionFile);
                    SessionStore.Write(cleanSessionFile, marker);
                }
                catch { try { if (File.Exists(cleanSessionFile)) File.Delete(cleanSessionFile); } catch (Exception ex) { Storage.Log(ex); } allowClose = false; throw; }
                BeginInvoke(Close); return true;
            default: throw new IOException("この操作は利用できません。");
        }
    }
    private async Task<object?> SaveDocument(JsonElement args)
    {
        var input = args.GetProperty("document").Deserialize<DocumentData>(Storage.Json) ?? throw new IOException("文書が見つかりません。");
        var doc = DocumentAuthority.Merge(Documents, input);
        var saveAs = args.GetProperty("saveAs").GetBoolean(); var destination = doc.Path;
        if (saveAs || destination is null)
        {
            var saveSpec = TextFileTypes.SaveDialogFor(doc.Name);
            using var dialog = new SaveFileDialog { FileName = saveSpec.FileName, InitialDirectory = Storage.DefaultSaveDirectory(), DefaultExt = saveSpec.DefaultExtension, Filter = saveSpec.Filter, FilterIndex = saveSpec.FilterIndex, AddExtension = true, RestoreDirectory = true, Title = "名前を付けて保存", OverwritePrompt = false };
            if(dialog.ShowDialog(this) != DialogResult.OK)return null;
            destination = TextFileTypes.ResolveSavePath(doc.Name, dialog.FileName, dialog.FilterIndex);
            if (File.Exists(destination) && MessageBox.Show(this, "このファイルは既にあります。上書きしますか？\n\n" + destination, "名前を付けて保存", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return null;
        }
        destination = Path.GetFullPath(destination);
        if(string.Equals(destination, doc.Path, StringComparison.OrdinalIgnoreCase) && File.Exists(destination) && doc.Fingerprint is not null)
        {
            var currentHash = Storage.Hash(await File.ReadAllBytesAsync(destination));
            if(currentHash != doc.Fingerprint && MessageBox.Show(this,"このファイルは別のアプリでも変更されています。現在の編集内容で上書きしますか？\n\n「いいえ」で保存を中止できます。", "ファイルの変更を確認",MessageBoxButtons.YesNo,MessageBoxIcon.Warning) != DialogResult.Yes) return null;
        }
        var replacements = new List<object>(); var text = doc.Text;
        var destinationChanged=!string.Equals(destination,doc.Path,StringComparison.OrdinalIgnoreCase);
        if (TextFileTypes.ShouldMigrateImages(doc, destination))
        {
            var refs = args.TryGetProperty("images", out var imageReferences) ? imageReferences.Deserialize<List<ImageReference>>(Storage.Json) ?? [] : [];
            foreach(var image in refs.OrderByDescending(i=>i.From))
            {
                if(image.From<0 || image.To>text.Length || image.To<image.From || image.UrlFrom<=0 || image.UrlFrom<image.From || image.UrlTo<image.UrlFrom || image.UrlTo>image.To)continue;
                var local = Storage.ResolveImage(doc,image.Url); if(local is null || !File.Exists(local))continue;
                if(!destinationChanged&&!image.Url.StartsWith("mdsplit-asset://",StringComparison.OrdinalIgnoreCase))continue;
                string newUrl;
                var managed = image.Url.StartsWith("mdsplit-asset://",StringComparison.OrdinalIgnoreCase) || (doc.Path is not null && Path.GetFullPath(local).StartsWith(Storage.AssetsDirectory(doc.Path)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase));
                if(managed)
                {
                    var dir = Storage.AssetsDirectory(destination);Directory.CreateDirectory(dir);var target = Path.Combine(dir,Path.GetFileName(local));
                    if(!string.Equals(local,target,StringComparison.OrdinalIgnoreCase))
                    {
                        if(File.Exists(target) && !File.ReadAllBytes(target).SequenceEqual(File.ReadAllBytes(local))) target=Path.Combine(dir,Path.GetFileNameWithoutExtension(local)+"-"+Guid.NewGuid().ToString("N")[..6]+Path.GetExtension(local));
                        File.Copy(local,target,true);
                    }
                    newUrl=Storage.UrlPath(Path.GetFileName(dir)+"/"+Path.GetFileName(target));
                }
                else {var relative=Path.GetRelativePath(Path.GetDirectoryName(destination)!,local);newUrl=Path.IsPathFullyQualified(relative)?new Uri(local).AbsoluteUri:Storage.UrlPath(relative);}
                if(image.UrlFrom>=image.From&&image.UrlTo<=image.To&&image.UrlTo>image.UrlFrom){
                    if(text[image.UrlFrom-1]!='<'&&(newUrl.Any(char.IsWhiteSpace)||newUrl.Contains('(')||newUrl.Contains(')')))newUrl="<"+newUrl+">";
                    text=text[..image.UrlFrom]+newUrl+text[image.UrlTo..];replacements.Add(new {oldUrl=image.Url,newUrl});
                }
            }
        }
        var bytes=await Storage.EncodeDocument(text,doc);await Storage.AtomicBytes(destination,bytes);
        if (doc.Encoding != doc.SavedEncoding) { doc.EncodingGuessed = false; doc.EncodingNotice = null; }
        doc.Encoding = TextCodec.CanonicalId(doc.Encoding);
        var outputBom = TextCodec.HasMatchingBom(bytes, doc.Encoding);
        doc.Text=text;doc.SavedText=text;doc.SavedEncoding=doc.Encoding;doc.HasBom=outputBom;doc.SavedHasBom=outputBom;doc.Path=destination;doc.Name=Path.GetFileName(destination);doc.Format=TextFileTypes.FormatFor(destination);doc.Fingerprint=Storage.Hash(bytes);Track(doc);pendingExternal.Remove(doc.Id);writeTimes[doc.Id]=File.GetLastWriteTimeUtc(destination);context.Recent.Touch(destination);
        return new {doc.Path,doc.Name,text,doc.Encoding,doc.Fingerprint,doc.HasBom,doc.SavedHasBom,doc.EncodingGuessed,doc.EncodingNotice,doc.Format,replacements};
    }
    private async void ServeImage(CoreWebView2Environment environment, CoreWebView2WebResourceRequestedEventArgs e)
    {
        var deferral=e.GetDeferral();
        try
        {
            var uri = new Uri(e.Request.Uri); var parts=uri.AbsolutePath.TrimStart('/').Split('/',2);
            if(parts.Length!=2||!Documents.TryGetValue(parts[0],out var doc))throw new IOException();
            var path=Storage.ResolveImage(doc,Uri.UnescapeDataString(parts[1])); if(path is null)throw new IOException();
            var mime=Path.GetExtension(path).ToLowerInvariant() switch { ".png"=>"image/png", ".jpg" or ".jpeg"=>"image/jpeg", ".gif"=>"image/gif", ".webp"=>"image/webp", ".bmp"=>"image/bmp", ".svg"=>"image/svg+xml", _=>throw new IOException() };
            var bytes=await Task.Run(()=>Storage.ReadPreviewImageAsync(path));
            e.Response=environment.CreateWebResourceResponse(new MemoryStream(bytes),200,"OK","Content-Type: "+mime+"\r\nAccess-Control-Allow-Origin: https://app.mdsplit.local\r\nContent-Security-Policy: default-src 'none'; sandbox\r\n");
        }
        catch { e.Response=environment.CreateWebResourceResponse(null,404,"Not Found",""); }
        finally { deferral.Complete(); }
    }
    private async Task PollFiles()
    {
        if(!ready||pollBusy||IsDisposed)return;pollBusy=true;
        try
        {
            // Start each check independently. A stalled remote drive must not hold
            // up the other tabs or the UI. Timed-out paths back off before retry.
            await Task.WhenAll(Documents.Values.ToArray().Select(CheckFile));
        }
        finally{pollBusy=false;}
    }
    private async Task CheckFile(DocumentData document)
    {
        if(document.Path is null || pollRetryAfter.GetValueOrDefault(document.Id)>DateTime.UtcNow)return;
        var id=document.Id;var path=document.Path;var baseline=document.Fingerprint;var previous=writeTimes.GetValueOrDefault(id);
        // A timed-out filesystem call cannot be cancelled reliably. Do not launch
        // another call for the same document until the previous worker exits.
        if(!pollInFlight.TryAdd(id,0))return;
        var snapshot=new DocumentData{Id=id,Path=path,Encoding=document.Encoding,SavedEncoding=document.SavedEncoding,
            EncodingGuessed=document.EncodingGuessed,EncodingNotice=document.EncodingNotice,PreviewViewMode=document.PreviewViewMode};
        var io=Task.Run(()=>
        {
            var info=new FileInfo(path);
            if(!info.Exists)return (exists:false,time:DateTime.MinValue,large:false,changed:(DocumentData?)null);
            var time=info.LastWriteTimeUtc;
            if(time==previous)return (exists:true,time,large:false,changed:(DocumentData?)null);
            if(!Storage.FileSizeApproved(path,info.Length))return (exists:true,time,large:true,changed:(DocumentData?)null);
            return (exists:true,time,large:false,changed:(DocumentData?)Storage.ReloadDocument(snapshot));
        });
        _=io.ContinueWith(t=>{if(t.IsFaulted)_=t.Exception;pollInFlight.TryRemove(id,out _);},TaskScheduler.Default);
        try
        {
            var result=await io.WaitAsync(TimeSpan.FromSeconds(3));
            if(IsDisposed||!Documents.TryGetValue(id,out var current)||current.Path!=path||current.Fingerprint!=baseline||writeTimes.GetValueOrDefault(id)!=previous)return;
            if(!result.exists){pollRetryAfter[id]=DateTime.UtcNow.AddSeconds(30);return;}
            pollRetryAfter.Remove(id);
            if(result.time==previous)return;
            writeTimes[id]=result.time;
            if(result.large){Emit(new {type="large-file-changed",id});return;}
            if(result.changed is not null&&result.changed.Fingerprint!=baseline)
            {pendingExternal[id]=(baseline,result.changed);Emit(new {type="file-changed",document=result.changed});}
        }
        catch(Exception ex)
        {
            if(!IsDisposed&&Documents.ContainsKey(id))pollRetryAfter[id]=DateTime.UtcNow.AddSeconds(30);
            Storage.Log(ex);
        }
    }
}
