using MdSplit;
using System.Text.Json;

internal static class RecoveryChecks
{
    internal static async Task Run(string root, Action<bool,string> assert)
    {
        var file=Path.Combine(root,"incremental-recovery.json");
        var a=new DocumentData { Id=Guid.NewGuid().ToString(),Name="a.md",Text="changed",SavedText="saved",Path=Path.Combine(root,"missing.md") };
        var b=new DocumentData { Id=Guid.NewGuid().ToString(),Name="b.csv",Text="b",SavedText="b" };
        var old=new RecoveryData { Documents=[a,b],Mode="discord",ActiveId=b.Id };
        await Storage.AtomicText(file,JsonSerializer.Serialize(old,Storage.Json));
        var legacy=RecoveryStore.Read(file)!;
        assert(legacy.Documents.Count==2&&legacy.Documents[0].Text=="changed"&&legacy.Mode=="discord","legacy full recovery remains readable even when the original file is missing");

        var store=new RecoveryStore(file);
        await store.Write(old,[a.Id,b.Id]);
        var first=RecoveryStore.Read(file)!;
        assert(first.Documents.Count==2&&first.Documents[0].Path==a.Path&&first.Documents[0].SavedText=="saved","first incremental snapshot retains baseline and path");
        var docsPath=file+".documents";
        var before=Directory.GetFiles(docsPath,"*.json").ToHashSet();
        b.Text="edited";b.Encoding="utf16le";
        await store.Write(new RecoveryData { Documents=[b],ActiveId=a.Id,Mode="normal" },[a.Id,b.Id]);
        var after=Directory.GetFiles(docsPath,"*.json").ToHashSet();
        assert(after.Count==2&&after.Intersect(before).Count()==1,"only edited document gets a new recovery generation");
        var second=RecoveryStore.Read(file)!;
        assert(second.Documents[0].Text=="changed"&&second.Documents[1].Text=="edited"&&second.Documents[1].Encoding=="utf16le"&&second.ActiveId==a.Id,"incremental recovery preserves unchanged tab and changed metadata");

        b.Text="uncommitted";
        var rejected=false;
        try { await store.Write(new RecoveryData { Documents=[b] },[a.Id,b.Id,Guid.NewGuid().ToString()]); }
        catch(IOException) { rejected=true; }
        assert(rejected&&RecoveryStore.Read(file)!.Documents[1].Text=="edited","failed commit keeps previous manifest and contents");
        await store.Write(new RecoveryData { Documents=[b],Reason="update",ActiveId=b.Id },[b.Id]);
        var last=RecoveryStore.Read(file)!;
        assert(last.Documents.Count==1&&last.Documents[0].Text=="uncommitted"&&last.Reason=="update","close and update commit tab order and reason");
        assert(Directory.GetFiles(docsPath,"*.json").Length==1,"obsolete and failed generations are cleaned only after commit");

        var bad=Path.Combine(root,"bad-recovery.json");
        await Storage.AtomicText(bad,"{\"version\":2,\"documents\":[{\"id\":\""+a.Id+"\",\"file\":\"../../secret.json\"}]}");
        rejected=false;try { RecoveryStore.Read(bad); } catch(IOException) { rejected=true; }
        assert(rejected,"manifest refuses path traversal");
        RecoveryStore.Delete(file);
        assert(!File.Exists(file)&&!Directory.Exists(docsPath),"normal close removes recovery manifest and generation directory");
    }
}
