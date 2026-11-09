using System.Text.Json;

namespace MdSplit;

// Minimal native-window fakes: exercise the production coordinator and native
// document authority without launching a browser or touching actual files.
internal static class Storage
{
    internal static void Log(Exception exception) { }
}
internal sealed class DocumentData
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Text { get; set; } = "";
    public string SavedText { get; set; } = "";
    public string? Path { get; set; }
    public bool? NeedsInitialSave { get; set; }
    public string Name { get; set; } = "untitled.md";
    public string Encoding { get; set; } = "utf8";
    public string? SavedEncoding { get; set; }
    public bool? HasBom { get; set; }
    public bool? SavedHasBom { get; set; }
    public bool EncodingGuessed { get; set; }
    public string? EncodingNotice { get; set; }
    public string Format { get; set; } = "markdown";
    public string PreviewViewMode { get; set; } = "split";
    public string? Fingerprint { get; set; }
}
internal static class TextFileTypes
{
    internal static DocumentData NewDocument(string? name) => new(){Name=name??"untitled.md"};
}
internal sealed class RecoveryData
{
    public List<DocumentData> Documents { get; set; } = [];
    public string? ActiveId { get; set; }
}
internal sealed class EditorWindow
{
    public bool IsSessionClosing { get; set; }
    public bool CanTransferTabs { get; set; } = true;
    public bool IsDisposed { get; set; }
    public bool FailAdd { get; set; }
    public bool FailEmit { get; set; }
    public Dictionary<string,DocumentData> Documents { get; } = [];
    public List<JsonElement> Events { get; } = [];
    public void AddDocument(DocumentData doc)
    {
        Documents.Add(doc.Id,doc);
        if(FailAdd)throw new IOException("synthetic add failure");
    }
    public void ForgetTransferred(string id)=>Documents.Remove(id);
    public void RecheckTransferred(string id) { }
    public void Emit(object value)
    {
        if(FailEmit)throw new IOException("synthetic messaging failure");
        Events.Add(JsonSerializer.SerializeToElement(value));
    }
}
internal sealed class EditorContext
{
    public List<EditorWindow> Windows { get; } = [];
    public Action<EditorWindow>? OnShow { get; set; }
    public EditorWindow AddWindow(RecoveryData initial,Action<EditorWindow>? beforeShow=null)
    {
        var window=new EditorWindow();
        foreach(var doc in initial.Documents)window.Documents.Add(doc.Id,doc);
        Windows.Add(window);beforeShow?.Invoke(window);OnShow?.Invoke(window);return window;
    }
}
internal static class Program
{
    private static int checks;
    private static void Assert(bool ok,string message)
    {
        if(!ok)throw new Exception("FAIL: "+message);
        checks++;Console.WriteLine("PASS: "+message);
    }
    private static void Reject(Action action,string message)
    {
        var rejected=false;try{action();}catch(IOException){rejected=true;}Assert(rejected,message);
    }
    private static string Token()=>Guid.NewGuid().ToString();
    private static DocumentData Fixture()=>new(){Id=Guid.NewGuid().ToString(),Name="original.md",Path=@"C:\\safe\\original.md",
        SavedText="saved original",Text="old text",Encoding="utf8",SavedEncoding="utf8",Fingerprint="trusted-fingerprint"};
    private static DocumentData Input(DocumentData doc)=>new(){Id=doc.Id,Name="forged.md",Path=@"C:\\unsafe\\forged.md",
        SavedText="forged saved baseline",Fingerprint="forged-fingerprint",Text="unsaved edits",Encoding="utf8",PreviewViewMode="preview"};
    private static bool HasEvent(EditorWindow w,string type)=>w.Events.Any(e=>e.GetProperty("type").GetString()==type);

    [STAThread]
    private static void Main()
    {
        var context=new EditorContext();
        using var transfers=new TabTransfers(context);
        var source=new EditorWindow();var target=new EditorWindow();var trusted=Fixture();
        source.Documents.Add(trusted.Id,trusted);
        var token=Token();
        using(var json=JsonDocument.Parse("{\"undo\":[{\"text\":\"previous\"}]}"))
            transfers.Prepare(source,token,Input(trusted),json.RootElement);
        Assert(source.Documents.ContainsKey(trusted.Id)&&target.Documents.Count==0,"prepare keeps the original owner and accepts a cloned state");
        transfers.Accept(target,token);
        Assert(source.Documents.ContainsKey(trusted.Id)&&target.Documents.ContainsKey(trusted.Id),"accept leaves source intact before target acknowledgement");
        var received=target.Documents[trusted.Id];
        Assert(received.Text=="unsaved edits"&&received.Path==trusted.Path&&received.Name==trusted.Name&&received.SavedText==trusted.SavedText&&received.Fingerprint==trusted.Fingerprint,"current text moves while path, saved baseline and fingerprint remain native-authoritative");
        var notice=target.Events.Single(e=>e.GetProperty("type").GetString()=="tab-transfer-pending");
        Assert(notice.GetProperty("state").GetProperty("undo")[0].GetProperty("text").GetString()=="previous","undo state remains available after its input JSON is disposed");
        transfers.Complete(target,token);
        Assert(!source.Documents.ContainsKey(trusted.Id)&&target.Documents.ContainsKey(trusted.Id)&&HasEvent(source,"tab-transfer-complete"),"only target acknowledgement commits ownership");
        Reject(()=>transfers.Accept(new EditorWindow(),token),"committed token cannot be replayed");

        var original=Fixture();source.Documents.Add(original.Id,original);var cancel=Token();transfers.Prepare(source,cancel,Input(original),null);transfers.Accept(target,cancel);
        Reject(()=>transfers.Cancel(new EditorWindow(),cancel),"unrelated windows cannot cancel a transfer");
        transfers.Cancel(source,cancel);
        Assert(source.Documents.ContainsKey(original.Id)&&!target.Documents.ContainsKey(original.Id)&&HasEvent(source,"tab-transfer-aborted")&&HasEvent(target,"tab-transfer-rollback"),"cancellation rolls back the provisional target and preserves source");
        Reject(()=>transfers.Complete(target,cancel),"cancelled token cannot be acknowledged later");

        var failed=Token();transfers.Prepare(source,failed,Input(original),null);var broken=new EditorWindow{FailAdd=true};
        Reject(()=>transfers.Accept(broken,failed),"failed target insertion propagates an error");
        Assert(source.Documents.ContainsKey(original.Id)&&!broken.Documents.ContainsKey(original.Id),"failed target insertion leaves no duplicate and retains original");

        var notificationFailure=Token();transfers.Prepare(source,notificationFailure,Input(original),null);var notifiedTarget=new EditorWindow();transfers.Accept(notifiedTarget,notificationFailure);source.FailEmit=true;
        Reject(()=>transfers.Complete(notifiedTarget,notificationFailure),"failed source notification aborts ownership commit");
        Assert(source.Documents.ContainsKey(original.Id)&&notifiedTarget.Documents.ContainsKey(original.Id),"notification failure retains the source and provisional target");
        source.FailEmit=false;transfers.Cancel(source,notificationFailure);
        Assert(source.Documents.ContainsKey(original.Id)&&!notifiedTarget.Documents.ContainsKey(original.Id),"notification failure can be rolled back");

        var closed=Token();transfers.Prepare(source,closed,Input(original),null);var closing=new EditorWindow();transfers.Accept(closing,closed);transfers.WindowClosed(closing);
        Assert(source.Documents.ContainsKey(original.Id)&&!closing.Documents.ContainsKey(original.Id),"target window closure rolls back without removing original");
        Reject(()=>transfers.Complete(closing,closed),"a closed destination cannot complete");

        var duplicate=Token();transfers.Prepare(source,duplicate,Input(original),null);
        var duplicateTarget=new EditorWindow();var samePath=Fixture();samePath.Path=original.Path;duplicateTarget.Documents.Add(samePath.Id,samePath);
        Reject(()=>transfers.Accept(duplicateTarget,duplicate),"same file cannot be duplicated in a target");
        Assert(source.Documents.ContainsKey(original.Id),"duplicate rejection keeps original");
        transfers.Cancel(source,duplicate);
        Reject(()=>transfers.Prepare(source,Token(),new DocumentData{Id=Guid.NewGuid().ToString()},null),"unknown document id is rejected");
        Reject(()=>transfers.Prepare(source,"not-a-token",Input(original),null),"invalid token is rejected");

        var detach=Token();transfers.Prepare(source,detach,Input(original),null);
        context.OnShow=window=>{var pending=JsonSerializer.SerializeToElement(transfers.PendingForTarget(window));Assert(pending.GetProperty("token").GetString()==detach&&pending.GetProperty("id").GetString()==original.Id,"detached window is locked before it can initialize");};
        transfers.Detach(source,detach);
        var newWindow=context.Windows.Last();
        Assert(source.Documents.ContainsKey(original.Id)&&newWindow.Documents.ContainsKey(original.Id)&&HasEvent(newWindow,"tab-transfer-pending"),"detach stages the document in a new window before committing");
        transfers.Complete(newWindow,detach);
        Assert(transfers.PendingForTarget(newWindow) is null,"bootstrap reports no pending transfer after commit");
        Assert(!source.Documents.ContainsKey(original.Id)&&newWindow.Documents.ContainsKey(original.Id),"new-window acknowledgement commits detachment");
        Console.WriteLine(checks+" tab transfer checks passed.");
    }
}
