using MdSplit;

internal static class SessionChecks
{
    internal static async Task Run(string root, Action<bool,string> assert)
    {
        var path = Path.Combine(root,"session-file.csv"); File.WriteAllText(path,"old,data\n");
        var disk = Storage.ReadFile(path);
        var blank = TextFileTypes.NewDocument("無題.txt"); blank.Text = "discarded private content";
        var missingPath = Path.Combine(root,"gone.md");
        var missing = new DocumentData { Path=missingPath,Name="gone.md" };
        var trusted = new Dictionary<string,DocumentData> { [disk.Id]=disk, [blank.Id]=blank, [missing.Id]=missing };
        var order = new List<string> { disk.Id, blank.Id, missing.Id };
        var all = SessionStore.Capture("all",order,blank.Id,"discord",trusted)!;
        var active = SessionStore.Capture("active",order,blank.Id,"normal",trusted)!;
        assert(SessionStore.Capture("clear",order,blank.Id,"normal",trusted)!.Documents.Count==0,"clear exit does not persist tabs");
        assert(all.Documents.Count==3&&all.ActiveId==blank.Id&&all.Mode=="discord"&&active.Documents.Count==1&&active.Documents[0].Id==blank.Id,"all or active exit captures ordered trusted tabs and prior active tab");
        var sessionFile=Path.Combine(root,"sessions","test.json"); SessionStore.Write(sessionFile,all);
        var content=File.ReadAllText(sessionFile);
        assert(!content.Contains("discarded private content")&&!content.Contains("old,data"),"clean-exit file includes no unsaved or saved document text");
        File.WriteAllText(path,"new,disk\n");
        var warnings=new List<string>(); var restored=SessionStore.Restore(SessionStore.Read(sessionFile),new HashSet<string>(StringComparer.OrdinalIgnoreCase),new HashSet<string>(StringComparer.Ordinal),_=>true,warnings.Add);
        assert(restored.Documents.Count==2&&restored.Documents[0].Text=="new,disk\n"&&restored.Documents[1].Name=="無題.txt"&&restored.Documents[1].Text=="","session reloads current disk content and restores untitled as empty");
        assert(restored.ActiveId==blank.Id&&warnings.Count==1&&warnings[0].Contains(missingPath),"missing file warns while remaining tabs and active selection restore");
        var seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase){Path.GetFullPath(path)};
        var duplicates=SessionStore.Restore(all,seen,new HashSet<string>(StringComparer.Ordinal),_=>true,_=>{});
        assert(duplicates.Documents.All(d=>d.Path!=path),"session does not duplicate a file already restored from recovery");
        var recoveredIds=new HashSet<string>(StringComparer.Ordinal){blank.Id};
        var duplicateBlank=SessionStore.Restore(all,new HashSet<string>(StringComparer.OrdinalIgnoreCase),recoveredIds,_=>true,_=>{});
        assert(duplicateBlank.Documents.All(d=>d.Id!=blank.Id),"session skips an untitled document already restored from crash recovery");
        var crashFile=Path.Combine(root,"session-crash.json"); var crashStore=new RecoveryStore(crashFile);
        var failed=false;try { await SessionStore.CommitRecovery(crashStore,new RecoveryData{Documents=[disk]},[disk.Id,blank.Id],sessionFile,root,Path.GetDirectoryName(sessionFile)); } catch(IOException) { failed=true; }
        assert(failed&&File.Exists(sessionFile),"failure before the first recovery commit retains the clean session for restart");
        await SessionStore.CommitRecovery(crashStore,new RecoveryData{Documents=[disk,blank]},[disk.Id,blank.Id],sessionFile,root,Path.GetDirectoryName(sessionFile));
        assert(!File.Exists(sessionFile)&&RecoveryStore.Read(crashFile)!.Documents.Count==2,"clean session is consumed only after all tabs have an atomic recovery snapshot");
        var closedId=Guid.NewGuid().ToString("N"); var closedFile=Path.Combine(root,closedId+".json");
        var oldStore=new RecoveryStore(closedFile); disk.Text="discarded change";
        await oldStore.Write(new RecoveryData { Documents=[disk] },[disk.Id]);
        var predecessorId=Guid.NewGuid().ToString("N"); var markerDir=Path.Combine(root,"markers"); var predecessor=Path.Combine(markerDir,predecessorId+".json");
        SessionStore.Write(predecessor,all);
        var marker=SessionStore.Capture("clear",order,blank.Id,"normal",trusted)!; marker.ClosedRecoveryId=closedId;marker.PreviousSessionId=predecessorId;
        var markerFile=Path.Combine(markerDir,Guid.NewGuid().ToString("N")+".json");SessionStore.Write(markerFile,marker);
        var markerRead=SessionStore.Read(markerFile);
        assert(SessionStore.ClosedRecoveryIds([markerRead]).Contains(closedId)&&SessionStore.SupersededSessionIds([markerRead]).Contains(predecessorId),"committed close marker suppresses discarded recovery and supersedes previous session after a crash");
        SessionStore.Consume(markerFile,root,markerDir);
        assert(!File.Exists(closedFile)&&!File.Exists(predecessor)&&!File.Exists(markerFile),"marker cleanup deletes obsolete recovery and superseded session before itself");
        var threw=false;try { SessionStore.Capture("all",[Guid.NewGuid().ToString()],blank.Id,"normal",trusted); } catch(IOException) { threw=true; }
        assert(threw,"session cannot capture a document ID not authorized by the native window");
        assert(new AppSettings {SessionPolicy="bad",StartupFormat="bad"}.NormalizePresentation().SessionPolicy=="clear"&&new AppSettings {StartupFormat="bad"}.NormalizePresentation().StartupFormat=="md","invalid session preferences use safe defaults");
    }
}
