using MdSplit;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
var root=Path.Combine(Path.GetTempPath(),"md-split-native-checks-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
var count=0;
void Assert(bool condition,string name){if(!condition)throw new Exception("FAIL: "+name);Console.WriteLine("PASS: "+name);count++;}
try
{
    var preferences = new AppSettings { ColorTheme="parchment-texture", Theme="light", SoftBreaks=false, ShowLineBreaks=true, ShowFullWidthSpaces=true, ShowTabs=true, ShowSpaces=true };
    var preferenceFile = Path.Combine(root,"settings.json"); await Storage.AtomicText(preferenceFile,JsonSerializer.Serialize(preferences,Storage.Json));
    var preferencesRead = JsonSerializer.Deserialize<AppSettings>(await File.ReadAllTextAsync(preferenceFile),Storage.Json)!;
    Assert(preferencesRead.ColorTheme==preferences.ColorTheme&&preferencesRead.Theme=="light"&&!preferencesRead.SoftBreaks&&preferencesRead.ShowLineBreaks&&preferencesRead.ShowFullWidthSpaces&&preferencesRead.ShowTabs&&preferencesRead.ShowSpaces,"theme and whitespace preferences survive native save and reload");
    var legacy = JsonSerializer.Deserialize<AppSettings>("{\"theme\":\"system\",\"fontSize\":17}",Storage.Json)!;
    Assert(legacy.Theme=="system"&&legacy.ColorTheme=="black"&&legacy.SoftBreaks&&!legacy.ShowTabs&&legacy.FontSize==17,"old settings retain their values and receive new defaults");
    Assert(!legacy.WelcomeShown && legacy.ViewMode == "split" && legacy.WhitespaceStyles.Count == 4, "old settings keep first-use guidance available and receive split-view defaults");
    var visualSettings = new AppSettings { ViewMode = "preview", WelcomeShown = true, WhitespaceStyles = new()
    {
        ["tab"] = new() { Color = "#12AbEf", Opacity = .2 }, ["space"] = new() { Color = "red; background:url(x)", Opacity = double.NaN },
        ["wideSpace"] = new() { Color = "#abcdef", Opacity = 3 }, ["unknown"] = new()
    } }.NormalizePresentation();
    var visualReload = JsonSerializer.Deserialize<AppSettings>(JsonSerializer.Serialize(visualSettings, Storage.Json), Storage.Json)!;
    Assert(visualReload.ViewMode == "preview" && visualReload.WelcomeShown && visualReload.WhitespaceStyles["tab"].Color == "#12AbEf" && visualReload.WhitespaceStyles["tab"].Opacity == .2, "pane mode, first-use state and individual whitespace styling survive settings round trip");
    Assert(visualReload.WhitespaceStyles.Count == 4 && visualReload.WhitespaceStyles["space"].Color == "#87909a" && visualReload.WhitespaceStyles["space"].Opacity == .3 && visualReload.WhitespaceStyles["wideSpace"].Opacity == 1, "invalid whitespace styles are replaced or bounded before storage");
    Assert(new AppSettings { ViewMode = "invalid", WhitespaceStyles = null! }.NormalizePresentation().ViewMode == "split", "invalid or missing presentation preferences safely receive defaults");
    Assert(legacy.DefaultViewMode == "last", "old settings default to remembering the last selected pane mode");
    Assert(new AppSettings { DefaultViewMode = "invalid" }.NormalizePresentation().DefaultViewMode == "last", "invalid default pane preferences fall back to remembering the last mode");
    var defaultViewReload = JsonSerializer.Deserialize<AppSettings>(JsonSerializer.Serialize(new AppSettings { DefaultViewMode = "source", ViewMode = "preview" }, Storage.Json), Storage.Json)!.NormalizePresentation();
    Assert(defaultViewReload.DefaultViewMode == "source" && defaultViewReload.ViewMode == "preview", "explicit default pane mode and last selected mode round trip independently");
    var typeMigration = new AppSettings { DefaultViewMode="preview", ViewMode="source", Sync=false, OutlineVisible=false }.NormalizePresentation();
    Assert(typeMigration.FileTypeSettings.Count == 4 && typeMigration.FileTypeSettings["markdown"].DefaultViewMode == "preview" && typeMigration.FileTypeSettings["csv"].ViewMode == "source" && typeMigration.FileTypeSettings["csv"].Sync == false, "legacy pane preferences migrate independently to each supported file kind");
    var typed = new AppSettings { FileTypeSettings = new()
    {
        ["markdown"] = new() { ViewMode="preview", DefaultViewMode="last", Sync=false, OutlineVisible=false },
        ["csv"] = new() { ViewMode="source", DefaultViewMode="split", Sync=true, OutlineVisible=true },
        ["html"] = new() { Sync=true, OutlineVisible=true }, ["unknown"] = new() { Sync=true }
    } }.NormalizePresentation();
    var typedReload = JsonSerializer.Deserialize<AppSettings>(JsonSerializer.Serialize(typed, Storage.Json), Storage.Json)!.NormalizePresentation();
    Assert(typedReload.FileTypeSettings["markdown"].ViewMode == "preview" && typedReload.FileTypeSettings["csv"].ViewMode == "source" && typedReload.FileTypeSettings["csv"].DefaultViewMode == "split" && typedReload.FileTypeSettings["csv"].Sync == true && typedReload.FileTypeSettings["markdown"].Sync == false, "file-kind pane defaults, last choices and sync preferences survive native round trip independently");
    Assert(typedReload.FileTypeSettings.Count == 4 && typedReload.FileTypeSettings["csv"].OutlineVisible == false && typedReload.FileTypeSettings["html"].OutlineVisible == true && typedReload.FileTypeSettings["html"].Sync == false, "HTML outline and supported settings survive the native round trip, unsupported features remain disabled");
    var invalidTyped = new AppSettings { ViewMode="source", DefaultViewMode="preview", Sync=false, FileTypeSettings = new() { ["csv"] = new() { ViewMode="bogus", DefaultViewMode="bogus" } } }.NormalizePresentation();
    Assert(invalidTyped.FileTypeSettings["csv"].ViewMode == "source" && invalidTyped.FileTypeSettings["csv"].DefaultViewMode == "preview" && invalidTyped.FileTypeSettings["csv"].Sync == false, "invalid typed preferences fall back to retained legacy values");
    var documentsFolder = Path.Combine(root, "Documents"); var profileFolder = Path.Combine(root, "Profile");
    Directory.CreateDirectory(documentsFolder); Directory.CreateDirectory(profileFolder);
    Assert(Storage.ExistingSaveDirectory(documentsFolder, profileFolder) == documentsFolder, "new and Save As dialogs prefer the user's Documents folder");
    Assert(Storage.ExistingSaveDirectory(Path.Combine(root, "missing"), profileFolder) == profileFolder && Storage.ExistingSaveDirectory("", "") == "", "missing Documents folder falls back without choosing the install directory");
    string? navigation = null; var navigationCalls = 0;
    UiContent.Navigate(url => { navigation = url; navigationCalls++; });
    Assert(navigationCalls == 1 && navigation == "https://app.mdsplit.local/index.html", "startup navigates to an actual file, not a directory");
    Assert(UiContent.IsRootUrl("https://app.mdsplit.local/"), "root URL is detected for redirect");
    Assert(!UiContent.IsRootUrl(UiContent.EntryUrl), "entry file is not redirected again");
    Assert(!UiContent.IsRootUrl("https://app.mdsplit.local.example/") && !UiContent.IsRootUrl("http://app.mdsplit.local/"), "root redirect is limited to the application origin");
    Assert(PaneWindowPolicy.TryGetPane(UiContent.EntryUrl + "?pane=source", out var sourcePane) && sourcePane == "source" && PaneWindowPolicy.TryGetPane(UiContent.EntryUrl + "?pane=preview", out var previewPane) && previewPane == "preview", "native pane windows accept only the two app views");
    foreach (var candidate in new[] { "https://example.com/index.html?pane=source", "https://app.mdsplit.local.example/index.html?pane=source", "http://app.mdsplit.local/index.html?pane=source", UiContent.EntryUrl + "?pane=source&url=https://example.com", UiContent.EntryUrl + "?pane=source#fragment", UiContent.EntryUrl + "?pane=other", "file:///index.html?pane=source", UiContent.EntryUrl })
        Assert(!PaneWindowPolicy.TryGetPane(candidate, out _), "native pane request rejects unsafe or unrecognized URL: " + candidate);
    var missing = false; try { UiContent.GetFolder(root); } catch(FileNotFoundException ex) { missing = ex.Message.Contains("修復") && !ex.Message.Contains("ZIP"); }
    Assert(missing, "missing UI file fails before creating a web view");
    var web = Path.Combine(root, "アプリ 空白", "wwwroot"); Directory.CreateDirectory(web); await File.WriteAllTextAsync(Path.Combine(web,"index.html"), "<!doctype html><title>MD Split</title>");
    Assert(UiContent.GetFolder(Path.GetDirectoryName(web)!) == web, "UI content folder supports spaces and Japanese paths");
    var logRoot = Path.Combine(root, "log-check"); var fakeProfile = Path.Combine(root, "private-profile");
    for (var i = 0; i < 100; i++) Storage.LogAt(logRoot, new IOException(fakeProfile + "/file " + new string('x', 32700)), fakeProfile);
    var logs = Directory.GetFiles(logRoot, "errors.log*");
    Assert(logs.Length <= 3 && logs.Length >= 2 && logs.All(x => new FileInfo(x).Length <= Storage.MaxLogBytes), "exception logs rotate within their size and count limits");
    Assert(logs.All(x => !File.ReadAllText(x).Contains(fakeProfile)) && File.ReadAllText(Path.Combine(logRoot, "errors.log")).Contains("[user]"), "error log redacts the user profile path");
    foreach(var format in new[]{"utf8","utf8bom","utf16le","utf16be","shiftjis"})
    {
        var original="---\r\ntitle: 日本語\n---\r\n\r\n__そのまま__  \r\n\n~~~js\r\n  keep( 1 );\r\n~~~";
        var path=Path.Combine(root,"空白 を含む "+format+".md");var bytes=Storage.Encode(original,format);await File.WriteAllBytesAsync(path,bytes);
        var doc=Storage.ReadFile(path);Assert(doc.Text==original && doc.Encoding==format && Storage.Encode(doc.Text,doc.Encoding).SequenceEqual(bytes),"byte round trip: "+format);
    }
    var atomic=Path.Combine(root,"atomic.md");await Storage.AtomicText(atomic,"first");await Storage.AtomicText(atomic,"日本語 second");Assert(await File.ReadAllTextAsync(atomic)=="日本語 second"&&!Directory.GetFiles(root,"*.tmp").Any(),"atomic replacement leaves no temp file");
    var noBom=Path.Combine(root,"utf16-no-bom.md");await File.WriteAllBytesAsync(noBom,new UnicodeEncoding(false,false,true).GetBytes("明示した文字コード"));Assert(Storage.ReadFile(noBom,forceEncoding:"utf16le").Text=="明示した文字コード","explicit decoding of UTF-16 without BOM");
    var before=Storage.ReadFile(atomic);await File.WriteAllTextAsync(atomic,"external change");Assert(Storage.ReadFile(atomic).Fingerprint!=before.Fingerprint,"external change alters fingerprint");
    var docImage=new DocumentData{Path=Path.Combine(root,"note.md")};
    Assert(Storage.ResolveImage(docImage,"note.assets/a%20b.png")==Path.Combine(root,"note.assets","a b.png"),"relative image path decoding");
    var escaped=Storage.UrlPath("note #%.assets/画像 (1).png");Assert(!escaped.Contains('#')&&!escaped.Contains(' ')&&Storage.ResolveImage(docImage,escaped)==Path.Combine(root,"note #%.assets","画像 (1).png"),"portable image URL escaping and path round trip");
    Assert(Storage.ResolveImage(docImage,"mdsplit-asset://"+Guid.NewGuid()+"/a.png")==null,"staged image cannot use another document's id");
    var originalHtml="<p><strong>日本語🙂</strong> text</p>";var clipboard=ClipboardHtml.Build(originalHtml);var all=Encoding.UTF8.GetBytes(clipboard);int Offset(string name)=>int.Parse(Regex.Match(clipboard,name+@":(\d+)").Groups[1].Value);
    Assert(Encoding.UTF8.GetString(all[Offset("StartFragment")..Offset("EndFragment")])==originalHtml,"HTML clipboard offsets are UTF-8 byte offsets");
    var state=new RecoveryData{Documents=[new DocumentData{Text="未保存🙂\r\n",SavedText="元の文章",Encoding="utf8bom"}],Mode="discord"};var recovery=Path.Combine(root,"recovery.json");await Storage.AtomicText(recovery,JsonSerializer.Serialize(state,Storage.Json));var restored=JsonSerializer.Deserialize<RecoveryData>(await File.ReadAllTextAsync(recovery),Storage.Json)!;
    Assert(restored.Documents[0].Text==state.Documents[0].Text && restored.Documents[0].SavedText=="元の文章"&&restored.Mode=="discord","recovery preserves unsaved text and saved baseline");
    var big=Path.Combine(root,"big.md");using(var stream=File.Create(big))stream.SetLength(65L*1024*1024);var rejected=false;try{Storage.ReadFile(big);}catch(IOException){rejected=true;}Assert(rejected,"oversized file checked before loading");
    var confirmations=0;
    Assert(!Storage.ApproveLargeFile(big,size=>{confirmations++;return false;})&&!Storage.FileSizeApproved(big,new FileInfo(big).Length),"large file denial leaves file unapproved");
    Assert(Storage.ApproveLargeFile(big,size=>{confirmations++;return true;})&&Storage.FileSizeApproved(big,new FileInfo(big).Length),"large file can be approved explicitly");
    Assert(Storage.ApproveLargeFile(big,size=>{confirmations++;return false;})&&confirmations==2,"same approved size does not prompt again");
    using(var stream=File.OpenWrite(big))stream.SetLength(66L*1024*1024);
    Assert(!Storage.ApproveLargeFile(big,size=>{confirmations++;return false;})&&confirmations==3,"file growth requires renewed approval");
    var encodingFailed=false;try{Storage.Encode("🙂","shiftjis");}catch(EncoderFallbackException){encodingFailed=true;}Assert(encodingFailed,"unrepresentable Shift JIS text fails without silent replacement");
    await TextCodecChecks.Run(root,Assert);
    await TextFileChecks.Run(root,Assert);
    DocumentAuthorityChecks.Run(root,Assert);
    await RecoveryChecks.Run(root,Assert);
    await SessionChecks.Run(root,Assert);
    SearchConformanceChecks.Run(Assert);
    await PipeMessageChecks.Run(Assert);
    await CsvViewChecks.Run(root,Assert);
    await FeatureChecks.Run(root,Assert);
    await UpdateChecks.Run(root,Assert);
    Console.WriteLine($"{count} native checks passed.");
}
finally{Directory.Delete(root,true);}
