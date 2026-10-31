using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Diagnostics;
namespace MdSplit;
internal static class FeatureChecks
{
    public static async Task Run(string root,Action<bool,string> assert)
    {
        var atomicFile=Path.Combine(root,"atomic-document.md");
        await Storage.AtomicText(atomicFile,"old text");
        await Storage.AtomicText(atomicFile,"new text");
        assert(await File.ReadAllTextAsync(atomicFile)=="new text" && !Directory.EnumerateFiles(root,"atomic-document.md.mdsplit-*.tmp").Any(),"atomic save creates and replaces content without leaving temporary files");
        // Some Windows installations disallow symlink creation; exercise link
        // refusal whenever the OS and current user can create a test link.
        var link=Path.Combine(root,"atomic-link.md");
        try { File.CreateSymbolicLink(link,atomicFile); }
        catch(UnauthorizedAccessException) { }
        catch(PlatformNotSupportedException) { }
        catch(IOException) { }
        if(File.Exists(link))
        {
            var linkRejected=false;
            try { await Storage.AtomicText(link,"should not replace"); } catch(IOException) { linkRejected=true; }
            assert(linkRejected && await File.ReadAllTextAsync(atomicFile)=="new text" && (File.GetAttributes(link)&FileAttributes.ReparsePoint)!=0,"atomic save refuses a symlink without modifying its target");
        }
        var preview=Path.Combine(root,"preview-image.bin");
        await File.WriteAllBytesAsync(preview,new byte[]{1,2,3});
        assert((await Storage.ReadPreviewImageAsync(preview)).SequenceEqual(new byte[]{1,2,3}),"preview image bytes are read asynchronously");
        using(var image=File.Open(preview,FileMode.Create,FileAccess.Write,FileShare.None))image.SetLength((long)Storage.MaxPreviewImageBytes+1);
        var oversizedImageRejected=false;
        try { await Storage.ReadPreviewImageAsync(preview); } catch(IOException) { oversizedImageRejected=true; }
        assert(oversizedImageRejected,"preview images over the size cap are rejected before loading");
        var recent=new RecentFiles(Path.Combine(root,"history","recent.json"));
        for(var i=0;i<25;i++)recent.Touch(Path.Combine(root,$"note-{i}.md"));
        assert(recent.List().Count==20&&recent.List()[0].Name=="note-24.md","recent files capped at 20 and ordered newest first");
        recent.Touch(Path.Combine(root,"note-15.md"));assert(recent.List().Count==20&&recent.List()[0].Name=="note-15.md","opening again moves a file to the top without duplication");
        var saved=Path.Combine(root,"note-15.md");await File.WriteAllTextAsync(saved,"keep");assert(recent.Resolve(recent.List()[0].Id)==saved&&recent.List()[0].Exists,"history resolves only a retained id and reports missing files");
        var rejected=false;try{recent.Resolve("../../unknown.md");}catch(IOException){rejected=true;}assert(rejected,"arbitrary recent-file paths are not accepted");recent.Clear();assert(recent.List().Count==0&&File.Exists(saved),"clearing history leaves the file intact");
        var legacy=Path.Combine(root,"legacy");var target=Path.Combine(root,"install","Data");Directory.CreateDirectory(Path.Combine(legacy,"Images","doc"));Directory.CreateDirectory(Path.Combine(legacy,"Recovery"));Directory.CreateDirectory(target);
        assert(Storage.ResolveImage(new DocumentData{Path=Path.Combine(root,"note.md")},"file://untrusted.example/share/image.png")==null,"Markdown images cannot initiate UNC network authentication");
        assert(Storage.ResolveImage(new DocumentData{Path=Path.Combine(root,"note.md")},"%5C%5Cuntrusted.example%5Cshare%5Cimage.png")==null,"encoded network image paths are rejected after decoding");
        await File.WriteAllTextAsync(Path.Combine(legacy,"settings.json"),"{\"colorTheme\":\"red\"}");await File.WriteAllTextAsync(Path.Combine(legacy,"Images","doc","image.png"),"image");await File.WriteAllTextAsync(Path.Combine(legacy,"Recovery","window.json"),"{}");Storage.MigrateData(legacy,target);
        assert(File.Exists(Path.Combine(target,"Images","doc","image.png"))&&File.Exists(Path.Combine(target,"Recovery","window.json")),"legacy migration retains recovery and unsaved image files when setup already created Data");
        await File.WriteAllTextAsync(Path.Combine(legacy,"settings.json"),"old");Storage.MigrateData(legacy,target);assert((await File.ReadAllTextAsync(Path.Combine(target,"settings.json"))).Contains("red"),"migration does not overwrite current settings");
        var defaultsOnly=Path.Combine(root,"legacy-defaults");var defaultsTarget=Path.Combine(root,"defaults-target");Directory.CreateDirectory(Path.Combine(defaultsOnly,"Recovery"));await File.WriteAllTextAsync(Path.Combine(defaultsOnly,"Recovery","unsaved.json"),"{}");Storage.MigrateData(defaultsOnly,defaultsTarget);assert(File.Exists(Path.Combine(defaultsTarget,"Recovery","unsaved.json"))&&JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(Path.Combine(defaultsTarget,"settings.json")),Storage.Json)!.UpdateCheckDays==7,"legacy unsaved documents migrate even when preferences were never changed");
        JsonElement Search(SearchRequest r)=>JsonSerializer.SerializeToElement(SearchEngine.Run(r),Storage.Json);
        var searchCache=new SearchTextCache();var cacheDoc=Guid.NewGuid().ToString();var otherDoc=Guid.NewGuid().ToString();var cacheToken=Guid.NewGuid().ToString();var otherToken=Guid.NewGuid().ToString();
        searchCache.Put(cacheDoc,cacheToken,"a\r\nb");assert(searchCache.Get(cacheDoc,cacheToken)=="a\r\nb","search cache retains exact text and line endings");
        assert(searchCache.Get(otherDoc,cacheToken) is null&&searchCache.Get(cacheDoc,otherToken) is null,"search cache refuses mismatched document and revision tokens");
        searchCache.Put(otherDoc,otherToken,"");assert(searchCache.Get(cacheDoc,cacheToken) is null&&searchCache.Get(otherDoc,otherToken)=="","search cache evicts previous document and supports empty content");
        searchCache.Remove(otherDoc);assert(searchCache.Get(otherDoc,otherToken) is null,"closing a document clears its search cache");
        var replaced=Search(new(){Text="a=123 b=45\r\n__keep__\n",Pattern=@"(?<==)(\d+)",Replacement="[$1]",Regex=true,Action="all"});assert(replaced.GetProperty("text").GetString()=="a=[123] b=[45]\r\n__keep__\n","native regex replacement preserves context and unrelated line endings");
        assert(Search(new(){Text="old old",Pattern="old",Replacement="",Action="all"}).GetProperty("text").GetString()==" ","empty replacement deletes text");
        assert(Search(new(){Text="a b",Pattern=@"(\w+)",Replacement=@"\1\t$1\r\n",Regex=true,Action="all"}).GetProperty("text").GetString()=="a\ta\r\n b\tb\r\n","replacement backreferences and escape sequences work");
        assert(Search(new(){Text="a\nb",Pattern="^",Replacement="> ",Regex=true,Action="all"}).GetProperty("text").GetString()=="> a\n> b","zero-width regex replacement terminates");
        var watch=Stopwatch.StartNew();rejected=false;try{Search(new(){Text=new string('a',30000)+"!",Pattern="(a+)+$",Regex=true});}catch(IOException){rejected=true;}assert(rejected&&watch.ElapsedMilliseconds<3000,"catastrophic regex backtracking is interrupted");
        rejected=false;try{Search(new(){Text="x",Pattern="[",Regex=true});}catch(IOException){rejected=true;}assert(rejected,"malformed regex reports a controlled error");
        foreach(var value in new[]{"file:///C:/bad.exe","javascript:alert(1)","ms-settings:defaultapps","https://user:pass@example.com/","https://example.com/\n"})assert(!SafeLinks.IsBrowserUrl(value),"unsafe browser link rejected: "+value.Split(':')[0]);
        assert(SafeLinks.IsBrowserUrl("https://example.com/path?q=1")&&SafeLinks.IsBrowserUrl("http://example.com/"),"ordinary HTTP and HTTPS links are accepted");
        var now=DateTimeOffset.UtcNow;assert(!UpdateSecurity.IsDue(-1,null,now)&&UpdateSecurity.IsDue(0,now,now)&&!UpdateSecurity.IsDue(7,now.AddDays(-6),now)&&UpdateSecurity.IsDue(7,now.AddDays(-8),now),"update check choices include disabled, every launch and elapsed days");
        assert(UpdateSecurity.ParseVersion("0.10.0")>UpdateSecurity.ParseVersion("0.3.0"),"versions compare numerically");
        rejected=false;try{UpdateSecurity.ParseVersion("../0.4.0");}catch(IOException){rejected=true;}assert(rejected,"version strings cannot form paths");
        var running=UpdateSecurity.ParseVersion(BuildIdentity.Version);var future=$"{running.Major}.{running.Minor+1}.0";var wrong=$"{running.Major}.{running.Minor+2}.0";var tag="v"+future;
        using var rsa=RSA.Create(3072);var key=rsa.ExportSubjectPublicKeyInfoPem();var bytes=Encoding.UTF8.GetBytes("setup");var manifest=new UpdateManifest{Repository=BuildIdentity.Repository,Version=future,AssetName=BuildIdentity.SetupName(future),Sha256=Convert.ToHexString(SHA256.HashData(bytes)),Size=bytes.Length};
        byte[] Content()=>JsonSerializer.SerializeToUtf8Bytes(manifest,Storage.Json);var data=Content();var signature=rsa.SignData(data,HashAlgorithmName.SHA256,RSASignaturePadding.Pss);var verified=UpdateSecurity.VerifyManifest(data,signature,tag,key);assert(verified.Version==future,"signed update metadata verifies with the pinned key");
        var tampered=data.ToArray();tampered[^2]^=1;rejected=false;try{UpdateSecurity.VerifyManifest(tampered,signature,tag,key);}catch(IOException){rejected=true;}assert(rejected,"changed update metadata is rejected before parsing");
        using(var other=RSA.Create(3072)){rejected=false;try{UpdateSecurity.VerifyManifest(data,signature,tag,other.ExportSubjectPublicKeyInfoPem());}catch(IOException){rejected=true;}assert(rejected,"a different signing key is rejected");}
        foreach(var invalid in new[]{"repository","asset","version"}){var original=JsonSerializer.Deserialize<UpdateManifest>(data,Storage.Json)!;if(invalid=="repository")manifest.Repository="attacker/project";if(invalid=="asset")manifest.AssetName="../../bad.exe";if(invalid=="version")manifest.Version=wrong;var changed=Content();rejected=false;try{UpdateSecurity.VerifyManifest(changed,rsa.SignData(changed,HashAlgorithmName.SHA256,RSASignaturePadding.Pss),tag,key);}catch(IOException){rejected=true;}assert(rejected,"signed metadata still requires the expected "+invalid);manifest=original;}
        assert(UpdateSecurity.IsAssetUrl("https://github.com/"+BuildIdentity.Repository+"/releases/download/"+tag+"/"+manifest.AssetName,tag,manifest.AssetName),"only the configured release asset path is accepted");
        foreach(var value in new[]{"http://github.com/a","https://github.com.evil.example/a","https://example.com/a","https://github.com:444/a","file:///C:/a"})assert(!UpdateSecurity.IsDownloadHop(new Uri(value)),"untrusted update redirect rejected: "+value.Split('/')[0]);
        var file=Path.Combine(root,"setup.exe");await File.WriteAllBytesAsync(file,bytes);await UpdateSecurity.VerifyFile(file,manifest);using(var cancelled=new CancellationTokenSource()){cancelled.Cancel();var stopped=false;try{await UpdateSecurity.VerifyFile(file,manifest,cancelled.Token);}catch(OperationCanceledException){stopped=true;}assert(stopped,"installer verification observes cancellation before a file becomes ready");}await File.WriteAllTextAsync(file,"wrong");rejected=false;try{await UpdateSecurity.VerifyFile(file,manifest);}catch(IOException){rejected=true;}assert(rejected,"the installer is not accepted after its content changes");
        assert(UpdateSecurity.PublicKey().Contains("PUBLIC KEY"),"release verification key is embedded in the executable");
        rejected=false;try{Maintenance.ValidateTarget(Path.GetPathRoot(root)!);}catch(IOException){rejected=true;}assert(rejected,"drive roots cannot be installation or deletion targets");
    }
}
