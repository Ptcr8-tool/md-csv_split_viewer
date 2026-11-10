using System.Text.Json;
namespace MdSplit;

// A drag contains only an unguessable, one-use token. Document bytes stay in
// this process, and the source remains authoritative until the target has
// accepted and persisted its recovery snapshot.
internal sealed class TabTransfers : IDisposable
{
    private sealed class Transfer
    {
        public required string Token { get; init; }
        public required EditorWindow Source { get; init; }
        public required DocumentData Document { get; init; }
        public JsonElement? State { get; init; }
        public EditorWindow? Target { get; set; }
        public DateTimeOffset Expires { get; init; }
    }
    private readonly EditorContext context;
    private readonly Dictionary<string,Transfer> pending = new(StringComparer.Ordinal);
    private readonly Dictionary<string,(DateTimeOffset Until,EditorWindow? Rejecter,bool Committed)> rejected = new(StringComparer.Ordinal);
    // Committed outcomes cannot expire while the source UI might still need
    // to distinguish them from a pre-prepare cancellation.
    private readonly Dictionary<string,(EditorWindow Source,EditorWindow Target,bool SourceDone,bool TargetDone)> completed = new(StringComparer.Ordinal);
    private const int MaxRejectedTokens=256;
    private readonly System.Windows.Forms.Timer timer = new(){Interval=1000};
    internal TabTransfers(EditorContext context){this.context=context;timer.Tick+=(_,_)=>Expire();timer.Start();}
    private Transfer Require(string? token)
    {
        if(token is null || !Guid.TryParse(token,out _) || !pending.TryGetValue(token,out var item) || item.Expires<=DateTimeOffset.UtcNow)
            throw new IOException(UiLanguage.T("タブの移動情報が見つかりません。もう一度操作してください。", "The tab transfer information was not found. Try again."));
        return item;
    }
    internal object Prepare(EditorWindow source,string? token,DocumentData input,JsonElement? state)
    {
        Expire();
        if(token is null||!Guid.TryParse(token,out _)||(pending.ContainsKey(token)||completed.ContainsKey(token)))throw new IOException(UiLanguage.T("タブの移動情報が正しくありません。", "The tab transfer information is invalid."));
        if(rejected.TryGetValue(token,out var rejectUntil))
        {
            if(rejectUntil.Until>DateTimeOffset.UtcNow)throw new IOException(UiLanguage.T("移動先がタブを受け付けられませんでした。", "The destination could not accept the tab."));
            rejected.Remove(token);
        }
        if(pending.Count+rejected.Count+completed.Count>=MaxRejectedTokens)throw new IOException(UiLanguage.T("タブの移動が集中しています。しばらく待ってから再試行してください。", "Too many tab transfers are in progress. Wait and try again."));
        if(source.IsSessionClosing||!source.CanTransferTabs)throw new IOException(UiLanguage.T("ウィンドウの操作が終わってから移動してください。", "Wait for the window operation to finish before moving the tab."));
        if(pending.Values.Any(p=>p.Source==source&&p.Document.Id==input.Id))throw new IOException(UiLanguage.T("このタブは移動中です。", "This tab is being moved."));
        var document=DocumentAuthority.Merge(source.Documents,input);
        if(state is { } value && value.GetRawText().Length>16*1024*1024)throw new IOException(UiLanguage.T("タブの編集履歴が大きすぎます。", "The tab edit history is too large."));
        pending.Add(token,new Transfer{Token=token,Source=source,Document=document,State=state?.Clone(),Expires=DateTimeOffset.UtcNow.AddMinutes(2)});
        return new{token};
    }
    internal bool Accept(EditorWindow target,string? token)
    {
        var item=Require(token);
        if(item.Source==target||item.Target is not null||target.IsSessionClosing||!target.CanTransferTabs)throw new IOException(UiLanguage.T("このウィンドウには移動できません。", "The tab cannot be moved to this window."));
        if(target.Documents.ContainsKey(item.Document.Id)||target.Documents.Values.Any(d=>d.Path is not null&&item.Document.Path is not null&&string.Equals(d.Path,item.Document.Path,StringComparison.OrdinalIgnoreCase)))throw new IOException(UiLanguage.T("同じ文書が既に開かれています。", "The same document is already open."));
        item.Target=target;
        try{target.AddDocument(item.Document);target.Emit(new{type="tab-transfer-pending",token=item.Token,id=item.Document.Id,state=item.State});return true;}
        catch{Abort(item);throw;}
    }
    internal bool Detach(EditorWindow source,string? token)
    {
        var item=Require(token);
        if(item.Source!=source||item.Target is not null||source.IsSessionClosing)throw new IOException(UiLanguage.T("タブの移動を開始できません。", "Could not start the tab transfer."));
        try
        {
            var target=context.AddWindow(new RecoveryData{Documents=[item.Document],ActiveId=item.Document.Id},beforeShow:window=>item.Target=window);
            target.Emit(new{type="tab-transfer-pending",token=item.Token,id=item.Document.Id,state=item.State});return true;
        }
        catch{Abort(item);throw;}
    }
    internal bool Complete(EditorWindow target,string? token)
    {
        var item=Require(token);
        if(item.Target!=target||item.Source.IsSessionClosing||target.IsSessionClosing||!target.Documents.ContainsKey(item.Document.Id))
            throw new IOException(UiLanguage.T("タブの移動先を確認できません。", "Could not confirm the tab transfer destination."));
        // Target confirms its recovery is durable before this commit.
        target.RecheckTransferred(item.Document.Id);
        item.Source.Emit(new{type="tab-transfer-complete",token=item.Token,id=item.Document.Id});
        item.Source.ForgetTransferred(item.Document.Id);
        pending.Remove(item.Token);
        completed[item.Token]=(item.Source,target,false,false);
        return true;
    }
    // Return the actual terminal state, including when the host notification was
    // lost. A pre-prepare cancellation reserves the token against a late prepare.
    internal string Cancel(EditorWindow requester,string? token)
    {
        if(token is null||!Guid.TryParse(token,out _)||requester.IsDisposed||!context.Windows.Contains(requester))return "unavailable";
        if(pending.TryGetValue(token,out var item))
        {
            if(item.Source!=requester&&item.Target!=requester)throw new IOException(UiLanguage.T("タブの移動元が一致しません。", "The tab transfer source does not match."));
            return Abort(item)?"cancelled":"unavailable";
        }
        if(completed.TryGetValue(token,out var done))return done.Source==requester||done.Target==requester?"committed":"unavailable";
        Expire();
        if(rejected.TryGetValue(token,out var old))return old.Committed?"committed":"cancelled";
        if(pending.Count+rejected.Count+completed.Count>=MaxRejectedTokens)return "unavailable";
        rejected[token]=(DateTimeOffset.UtcNow.AddMinutes(2),null,false);
        return "cancelled";
    }
    // The token is a capability: another registered editor may reject a drag
    // it received, but cannot cancel a transfer already staged in another target.
    // A bounded, short-lived tombstone handles rejection racing ahead of Prepare.
    internal bool Reject(EditorWindow requester,string? token)
    {
        if(token is null||!Guid.TryParse(token,out _)||requester.IsDisposed||!context.Windows.Contains(requester))return false;
        if(pending.TryGetValue(token,out var item))
        {
            if(item.Source==requester||(item.Target is not null&&item.Target!=requester))return false;
            if(!Abort(item))return false;
            rejected[token]=(DateTimeOffset.UtcNow.AddMinutes(2),requester,false);return true;
        }
        if(completed.ContainsKey(token))return false;
        Expire();
        if(rejected.TryGetValue(token,out var old))return old.Rejecter==requester;
        if(pending.Count+rejected.Count+completed.Count>=MaxRejectedTokens)return false;
        rejected[token]=(DateTimeOffset.UtcNow.AddMinutes(2),requester,false);return true;
    }
    internal bool Finalized(EditorWindow window,string? token)
    {
        if(token is null||!completed.TryGetValue(token,out var item)||(item.Source!=window&&item.Target!=window))return false;
        item.SourceDone |= item.Source==window;
        item.TargetDone |= item.Target==window;
        if(item.SourceDone&&item.TargetDone)completed.Remove(token);else completed[token]=item;
        return true;
    }
    internal object? PendingForTarget(EditorWindow target)
    {
        var item=pending.Values.FirstOrDefault(x=>x.Target==target);
        return item is null?null:new{token=item.Token,id=item.Document.Id};
    }
    internal void WindowClosed(EditorWindow window)
    {
        foreach(var item in pending.Values.Where(x=>x.Source==window||x.Target==window).ToArray())Abort(item);
        foreach(var pair in completed.Where(x=>x.Value.Source==window||x.Value.Target==window).ToArray())Finalized(window,pair.Key);
    }
    private void Expire()
    {
        var now=DateTimeOffset.UtcNow;
        foreach(var item in pending.Values.Where(x=>x.Expires<=now).ToArray())Abort(item);
        foreach(var token in rejected.Where(x=>x.Value.Until<=now).Select(x=>x.Key).ToArray())rejected.Remove(token);
    }
    private bool Abort(Transfer item)
    {
        if(!pending.ContainsKey(item.Token))return true;
        if(item.Target is {IsDisposed:false} target)
        {
            // Do not release the source if the target could not be told to
            // discard its provisional copy. Retry on the next cancellation.
            if(!target.IsSessionClosing)try{target.Emit(new{type="tab-transfer-rollback",token=item.Token,id=item.Document.Id});}
            catch(Exception ex){Storage.Log(ex);return false;}
            target.ForgetTransferred(item.Document.Id);
        }
        pending.Remove(item.Token);
        rejected[item.Token]=(DateTimeOffset.UtcNow.AddMinutes(2),null,false);
        if(!item.Source.IsDisposed)try{item.Source.RecheckTransferred(item.Document.Id);item.Source.Emit(new{type="tab-transfer-aborted",token=item.Token,id=item.Document.Id});}catch(Exception ex){Storage.Log(ex);}
        return true;
    }
    public void Dispose(){timer.Stop();timer.Dispose();}
}
