using System.Net;
using System.Text;
using System.Text.Json;
using System.Security.Cryptography;
namespace MdSplit;
internal static class UpdateChecks
{
    private sealed class Handler(Func<Uri,HttpResponseMessage> reply):HttpMessageHandler
    {
        public readonly List<string> Calls=[];
        public bool SentCredentials;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken token){Calls.Add(request.RequestUri!.AbsoluteUri);SentCredentials|=request.Headers.Authorization is not null||request.Headers.Contains("Cookie");return Task.FromResult(reply(request.RequestUri));}
    }
    private sealed class PendingHandler:HttpMessageHandler
    {
        public readonly TaskCompletionSource<HttpResponseMessage> Response=new(TaskCreationOptions.RunContinuationsAsynchronously);
        public int Calls;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken token){Calls++;return Response.Task.WaitAsync(token);}
    }
    public static async Task Run(string root,Action<bool,string> assert)
    {
        using var rsa=RSA.Create(3072);var key=rsa.ExportSubjectPublicKeyInfoPem();var installer=Encoding.UTF8.GetBytes("verified installer bytes");
        var running=UpdateSecurity.ParseVersion(BuildIdentity.Version);var future=$"{running.Major}.{running.Minor+1}.0";var wrong=$"{running.Major}.{running.Minor+2}.0";
        var manifest=new UpdateManifest{Version=future,Repository=BuildIdentity.Repository,AssetName=BuildIdentity.SetupName(future),Size=installer.Length,Sha256=Convert.ToHexString(SHA256.HashData(installer))};
        var data=JsonSerializer.SerializeToUtf8Bytes(manifest,Storage.Json);var signature=rsa.SignData(data,HashAlgorithmName.SHA256,RSASignaturePadding.Pss);
        var prefix="https://github.com/"+BuildIdentity.Repository+"/releases/download/v"+future+"/";
        string Release(string? version=null)=>JsonSerializer.Serialize(new{tag_name="v"+(version??future),draft=false,prerelease=false,body="release notes",assets=new[]{new{name="update-manifest.json",size=(long)data.Length,browser_download_url=prefix+"update-manifest.json",digest=""},new{name="update-manifest.sig",size=(long)signature.Length,browser_download_url=prefix+"update-manifest.sig",digest=""},new{name=manifest.AssetName,size=manifest.Size,browser_download_url=prefix+manifest.AssetName,digest="sha256:"+manifest.Sha256}}});
        HttpResponseMessage Bytes(byte[] bytes)=>new(HttpStatusCode.OK){Content=new ByteArrayContent(bytes)};
        HttpResponseMessage Reply(Uri uri){if(uri.Host=="api.github.com")return Bytes(Encoding.UTF8.GetBytes(Release()));if(uri.AbsolutePath.EndsWith("update-manifest.json"))return Bytes(data);if(uri.AbsolutePath.EndsWith("update-manifest.sig"))return Bytes(signature);return Bytes(installer);}
        var handler=new Handler(Reply);using(var service=new UpdateService(handler,Path.Combine(root,"update-test"),key))
        {
            var disabled=JsonSerializer.SerializeToElement(await service.Check(-1,false),Storage.Json);assert(disabled.GetProperty("status").GetString()=="notDue"&&handler.Calls.Count==0,"disabled startup updates make no network request");
            var result=JsonSerializer.SerializeToElement(await service.Check(7,true),Storage.Json);assert(result.GetProperty("available").GetBoolean()&&!handler.Calls.Contains(prefix+manifest.AssetName),"checking verifies metadata without downloading the executable");
            assert(!handler.SentCredentials&&handler.Calls[0]=="https://api.github.com/repos/"+BuildIdentity.Repository+"/releases/latest","updates use the anonymous public GitHub release API without credentials");
            var rejected=false;try{await service.Download(wrong,_=>{});}catch(IOException){rejected=true;}assert(rejected,"download must match the version confirmed in the dialog");
            double percent=0;await service.Download(future,p=>percent=p);var file=await service.VerifiedInstaller();assert(percent==100&&File.ReadAllBytes(file).SequenceEqual(installer),"only a signed and hashed installer becomes ready to run");
            await File.WriteAllTextAsync(file,"changed");rejected=false;try{await service.VerifiedInstaller();}catch(IOException){rejected=true;}assert(rejected,"installer is hashed again immediately before use");
        }
        handler=new Handler(uri=>uri.Host=="api.github.com"?Bytes(Encoding.UTF8.GetBytes(Release("0.2.0"))):throw new Exception("Unexpected download"));using(var service=new UpdateService(handler,Path.Combine(root,"old-update"),key)){var result=JsonSerializer.SerializeToElement(await service.Check(7,true),Storage.Json);assert(!result.GetProperty("available").GetBoolean()&&handler.Calls.Count==1,"an older GitHub release never causes an executable download");}
        handler=new Handler(uri=>uri.Host=="api.github.com"?Bytes(Encoding.UTF8.GetBytes(Release(BuildIdentity.Version))):throw new Exception("Unexpected download"));using(var service=new UpdateService(handler,Path.Combine(root,"same-update"),key)){var result=JsonSerializer.SerializeToElement(await service.Check(7,true),Storage.Json);assert(!result.GetProperty("available").GetBoolean()&&handler.Calls.Count==1,"the installed version is not offered as an update");}
        handler=new Handler(uri=>uri.Host=="api.github.com"?Bytes(Encoding.UTF8.GetBytes(Release())):new(HttpStatusCode.Redirect){Headers={Location=new Uri("https://attacker.example/file.exe")}});using(var service=new UpdateService(handler,Path.Combine(root,"redirect-update"),key)){var result=JsonSerializer.SerializeToElement(await service.Check(7,true),Storage.Json);assert(result.GetProperty("status").GetString()=="invalid"&&handler.Calls.All(u=>!u.Contains("attacker.example")),"unsafe redirects are rejected before connecting to another host");}
        var bad=signature.ToArray();bad[0]^=1;handler=new Handler(uri=>uri.AbsolutePath.EndsWith("update-manifest.sig")?Bytes(bad):Reply(uri));using(var service=new UpdateService(handler,Path.Combine(root,"bad-signature"),key)){var result=JsonSerializer.SerializeToElement(await service.Check(7,true),Storage.Json);assert(result.GetProperty("status").GetString()=="invalid"&&!handler.Calls.Contains(prefix+manifest.AssetName),"failed signatures prevent executable download");}
        foreach(var malformed in new[]{"{", "{}", "{\"draft\":\"no\",\"prerelease\":false}", new string('x', 1024*1024+1)})
        {
            var directory=Path.Combine(root,"invalid-update-"+Guid.NewGuid().ToString("N"));handler=new Handler(_=>Bytes(Encoding.UTF8.GetBytes(malformed)));using var service=new UpdateService(handler,directory,key);
            var result=JsonSerializer.SerializeToElement(await service.Check(7,true),Storage.Json);
            assert(!result.GetProperty("available").GetBoolean()&&result.GetProperty("status").GetString()=="invalid"&&!File.Exists(Path.Combine(directory,"state.json")),"invalid release metadata is reported without recording a successful update check");
        }
        foreach(var status in new[]{HttpStatusCode.NotFound,HttpStatusCode.Forbidden,HttpStatusCode.TooManyRequests,HttpStatusCode.ServiceUnavailable})
        {
            var directory=Path.Combine(root,"http-error-"+(int)status);handler=new Handler(_=>new(status));using var service=new UpdateService(handler,directory,key);
            var result=JsonSerializer.SerializeToElement(await service.Check(7,false),Storage.Json);assert(!result.GetProperty("available").GetBoolean()&&result.GetProperty("status").GetString() is "unpublished" or "offline","HTTP "+(int)status+" returns a failed check without an exception");
            assert(!File.Exists(Path.Combine(directory,"state.json")),"HTTP "+(int)status+" does not postpone the next launch by recording success");
            await service.Check(7,true);assert(handler.Calls.Count==2,"manual retry remains available after HTTP "+(int)status);
        }
        handler=new Handler(_=>throw new HttpRequestException("offline"));using(var service=new UpdateService(handler,Path.Combine(root,"offline-update"),key)){var result=JsonSerializer.SerializeToElement(await service.Check(0,false),Storage.Json);assert(result.GetProperty("status").GetString()=="offline","network disconnection returns a failed check");}
        var pending=new PendingHandler();using(var service=new UpdateService(pending,Path.Combine(root,"pending-update"),key))
        {
            var first=service.Check(0,false);assert(!first.IsCompleted,"pending network check yields control to its caller");
            var other=await service.Check(0,true);assert(JsonSerializer.SerializeToElement(other,Storage.Json).GetProperty("status").GetString()=="busy"&&pending.Calls==1,"another check does not queue behind an active transfer");
            pending.Response.SetResult(new(HttpStatusCode.NotFound));await first;
            var retry=JsonSerializer.SerializeToElement(await service.Check(0,true),Storage.Json);assert(retry.GetProperty("status").GetString()=="unpublished"&&pending.Calls==2,"failed check releases its gate for a later retry");
        }
    }
}
