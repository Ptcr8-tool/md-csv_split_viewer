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
    public List<DocumentData> InitialDocuments { get; } = [];
    public List<JsonElement> Events { get; } = [];
    public void AddDocument(DocumentData doc)
    {
        Documents.Add(doc.Id,doc);
        if(FailAdd)throw new IOException("synthetic add failure");
    }
    public void ForgetTransferred(string id){Documents.Remove(id);InitialDocuments.RemoveAll(d=>d.Id==id);}
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
        foreach(var doc in initial.Documents){window.Documents.Add(doc.Id,doc);window.InitialDocuments.Add(doc);}
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
    private static DocumentData Fixture(){var id=Guid.NewGuid().ToString();return new(){Id=id,Name="original.md",Path=@"C:\safe\"+id+".md",
        SavedText="saved original",Text="old text",Encoding="utf8",SavedEncoding="utf8",Fingerprint="trusted-fingerprint"};
    }
    private static DocumentData Input(DocumentData doc)=>new(){Id=doc.Id,Name="forged.md",Path=@"C:\\unsafe\\forged.md",
        SavedText="forged saved baseline",Fingerprint="forged-fingerprint",Text="unsaved edits",Encoding="utf8",PreviewViewMode="preview"};
    private static bool HasEvent(EditorWindow w,string type)=>w.Events.Any(e=>e.GetProperty("type").GetString()==type);

    [STAThread]
    private static void Main()
    {
        var context=new EditorContext();
        using var transfers=new TabTransfers(context);
        var source=new EditorWindow();var target=new EditorWindow();context.Windows.Add(source);context.Windows.Add(target);var trusted=Fixture();
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
        Assert(transfers.Cancel(source,token)=="committed","cancel reports a committed transfer even when its event is missed");
        typeof(TabTransfers).GetMethod("Expire",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic)!.Invoke(transfers,null);
        Assert(transfers.Cancel(source,token)=="committed","committed outcomes survive expiry until source acknowledgement");
        Assert(!transfers.Finalized(new EditorWindow(),token)&&transfers.Finalized(source,token),"unrelated windows cannot acknowledge completed cleanup");
        Assert(transfers.Cancel(target,token)=="committed","source acknowledgement alone cannot hide a committed outcome from the target");
        Assert(transfers.Finalized(target,token),"target acknowledges its committed outcome");

        var original=Fixture();source.Documents.Add(original.Id,original);var cancel=Token();transfers.Prepare(source,cancel,Input(original),null);transfers.Accept(target,cancel);
        Assert(transfers.Cancel(new EditorWindow(),cancel)=="unavailable","unregistered windows cannot cancel a transfer");
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

        context.OnShow=null;var delayedDoc=Fixture();source.Documents.Add(delayedDoc.Id,delayedDoc);
        var delayed=Token();transfers.Prepare(source,delayed,Input(delayedDoc),null);transfers.Detach(source,delayed);
        var notBootstrapped=context.Windows.Last();
        Assert(transfers.Cancel(source,delayed)=="cancelled"&&notBootstrapped.InitialDocuments.Count==0&&source.Documents.ContainsKey(delayedDoc.Id),"cancelling a detached window before bootstrap removes its initial copy");

        var rejectContext=new EditorContext();using var rejections=new TabTransfers(rejectContext);
        var sender=new EditorWindow();var receiver=new EditorWindow();var stranger=new EditorWindow();
        rejectContext.Windows.Add(sender);rejectContext.Windows.Add(receiver);rejectContext.Windows.Add(stranger);
        var doc=Fixture();sender.Documents.Add(doc.Id,doc);
        Assert(!rejections.Reject(new EditorWindow(),Token()),"an unregistered window cannot reject a token");
        Assert(!rejections.Reject(receiver,"not-a-token"),"invalid rejection tokens are refused");
        var early=Token();
        Assert(rejections.Reject(receiver,early),"target can reject before prepare arrives");
        Reject(()=>rejections.Prepare(sender,early,Input(doc),null),"early rejection prevents a delayed prepare");
        Assert(sender.Documents.ContainsKey(doc.Id),"early rejection preserves the original document");
        var ready=Token();rejections.Prepare(sender,ready,Input(doc),null);
        Assert(!rejections.Reject(sender,ready),"source cannot use target rejection");
        Assert(rejections.Reject(receiver,ready)&&HasEvent(sender,"tab-transfer-aborted"),"target rejection immediately unlocks source");
        Assert(rejections.Reject(receiver,ready),"repeating rejection by the same target is idempotent");
        Reject(()=>rejections.Prepare(sender,ready,Input(doc),null),"a rejected token cannot be reused");
        var earlyCancel=Token();Assert(rejections.Cancel(sender,earlyCancel)=="cancelled","cancellation before prepare reserves the token");
        Reject(()=>rejections.Prepare(sender,earlyCancel,Input(doc),null),"a late prepare cannot revive a cancelled transfer");
        var failedRollback=Token();rejections.Prepare(sender,failedRollback,Input(doc),null);rejections.Accept(receiver,failedRollback);receiver.FailEmit=true;
        Assert(rejections.Cancel(sender,failedRollback)=="unavailable"&&sender.Documents.ContainsKey(doc.Id)&&receiver.Documents.ContainsKey(doc.Id),"failed rollback notification does not unlock the source");
        receiver.FailEmit=false;sender.FailEmit=true;Assert(rejections.Cancel(sender,failedRollback)=="cancelled"&&sender.Documents.ContainsKey(doc.Id)&&!receiver.Documents.ContainsKey(doc.Id),"cancel reports cancellation even if the source notification is lost");sender.FailEmit=false;
        var staged=Token();rejections.Prepare(sender,staged,Input(doc),null);rejections.Accept(receiver,staged);
        Assert(!rejections.Reject(stranger,staged)&&receiver.Documents.ContainsKey(doc.Id)&&sender.Documents.ContainsKey(doc.Id),"another window cannot reject an already-staged transfer");
        Assert(rejections.Reject(receiver,staged)&&!receiver.Documents.ContainsKey(doc.Id)&&sender.Documents.ContainsKey(doc.Id),"actual target can reject a staged transfer and roll it back");
        Assert(rejections.Reject(receiver,staged),"staged rejection is idempotent");
        var completed=Token();rejections.Prepare(sender,completed,Input(doc),null);rejections.Accept(receiver,completed);rejections.Complete(receiver,completed);
        Assert(!rejections.Reject(stranger,completed)&&receiver.Documents.ContainsKey(doc.Id),"retired capability cannot affect a completed transfer");
        var capacityContext=new EditorContext();using var capacity=new TabTransfers(capacityContext);var requester=new EditorWindow();capacityContext.Windows.Add(requester);
        var filled=true;for(var i=0;i<256;i++)filled &= capacity.Reject(requester,Token());
        Assert(filled,"bounded early rejection accepts up to its token limit");
        Assert(!capacity.Reject(requester,Token()),"early rejection storage is bounded");
        Console.WriteLine(checks+" tab transfer checks passed.");
    }
}
