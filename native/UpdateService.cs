using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
namespace MdSplit;
internal sealed class UpdateService:IDisposable
{
    private readonly HttpClient client;
    private readonly string updateRoot;
    private readonly string? verificationKey;
    private readonly string installedVersion;
    private readonly Func<string,string,UpdateManifest,CancellationToken,Task> verifyProvenance;
    private readonly SemaphoreSlim gate=new(1,1);
    private bool checkedThisRun;
    private CancellationTokenSource? downloadCancellation;
    private Candidate? candidate;
    private Candidate? downloaded;
    private sealed record Candidate(UpdateManifest Manifest,string Url,string Path,string? BundleUrl=null,long BundleSize=0,string? BundleHash=null);
    private string StateFile=>Path.Combine(updateRoot,"state.json");
    public UpdateService(HttpMessageHandler? handler=null,string? directory=null,string? publicKey=null,Func<string,string,UpdateManifest,CancellationToken,Task>? provenanceVerifier=null,string? installedVersionForTest=null)
    {
        updateRoot=directory??Path.Combine(Storage.Root,"Updates");verificationKey=publicKey;verifyProvenance=provenanceVerifier??UpdateProvenance.Verify;installedVersion=installedVersionForTest??BuildIdentity.Version;
        // Public releases only: do not send Windows credentials or retain cookies.
        client=new(handler??new HttpClientHandler{AllowAutoRedirect=false,UseDefaultCredentials=false,UseCookies=false,AutomaticDecompression=DecompressionMethods.GZip|DecompressionMethods.Deflate}){Timeout=TimeSpan.FromMinutes(20)};
        client.DefaultRequestHeaders.UserAgent.ParseAdd("MD-Split/"+BuildIdentity.Version);client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));client.DefaultRequestHeaders.Add("X-GitHub-Api-Version","2022-11-28");
    }
    private DateTimeOffset? LastCheck(){try{return JsonSerializer.Deserialize<DateTimeOffset>(File.ReadAllText(StateFile));}catch{return null;}}
    private Task Stamp()=>Storage.AtomicText(StateFile,JsonSerializer.Serialize(DateTimeOffset.UtcNow));
    public async Task<object> Check(int days,bool manual)
    {
        if(!await gate.WaitAsync(0))return new{available=false,status="busy"};try
        {
            if(!manual&&(checkedThisRun||!UpdateSecurity.IsDue(days,LastCheck(),DateTimeOffset.UtcNow)))return new{available=false,status="notDue"};checkedThisRun=true;
            candidate=null;
            using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(35));
            try
            {
                using var response=await client.GetAsync("https://api.github.com/repos/"+BuildIdentity.Repository+"/releases/latest",HttpCompletionOption.ResponseHeadersRead,timeout.Token);
                if(response.StatusCode==HttpStatusCode.NotFound)return new{available=false,status="unpublished"};response.EnsureSuccessStatusCode();var json=await ReadBounded(response,1024*1024,timeout.Token);using var release=JsonDocument.Parse(json);var root=release.RootElement;
                if(root.GetProperty("draft").GetBoolean()||root.GetProperty("prerelease").GetBoolean())return new{available=false,status="current"};
                var tag=root.GetProperty("tag_name").GetString()??"";if(!tag.StartsWith('v'))throw new IOException(UiLanguage.T("更新のタグが正しくありません。", "The update tag is invalid."));var version=UpdateSecurity.ParseVersion(tag[1..]);
                if(version<=UpdateSecurity.ParseVersion(installedVersion)){await Stamp();return new{available=false,status="current"};}
                var assets=root.GetProperty("assets");JsonElement Asset(string name){var entries=assets.EnumerateArray().Where(a=>a.GetProperty("name").GetString()==name).ToArray();if(entries.Length!=1)throw new IOException(UiLanguage.T("更新に必要なファイルが揃っていません。", "Required update files are missing."));return entries[0];}
                string Url(JsonElement asset,string name){var url=asset.GetProperty("browser_download_url").GetString()??"";if(!UpdateSecurity.IsAssetUrl(url,tag,name))throw new IOException(UiLanguage.T("更新の配布先が正しくありません。", "The update download location is invalid."));return url;}
                var versionText=tag[1..];var setupName=BuildIdentity.SetupName(versionText);var bundleName=setupName+".sigstore.json";
                UpdateManifest manifest;string setupUrl;var directory=Path.Combine(updateRoot,versionText);Directory.CreateDirectory(directory);
                if(assets.EnumerateArray().Any(a=>a.GetProperty("name").GetString()==bundleName))
                {
                    var setup=Asset(setupName);var bundle=Asset(bundleName);
                    string Digest(JsonElement asset){var text=asset.GetProperty("digest").GetString()??"";if(!System.Text.RegularExpressions.Regex.IsMatch(text,@"\Asha256:[0-9a-fA-F]{64}\z"))throw new IOException(UiLanguage.T("更新のハッシュ情報が正しくありません。", "The update hash information is invalid."));return text[7..];}
                    var size=setup.GetProperty("size").GetInt64();var bundleSize=bundle.GetProperty("size").GetInt64();if(size<1||size>UpdateSecurity.MaxInstallerSize||bundleSize<1||bundleSize>UpdateProvenance.MaxBundleSize)throw new IOException(UiLanguage.T("更新ファイルのサイズが正しくありません。", "The update file size is invalid."));
                    manifest=new UpdateManifest{Repository=BuildIdentity.Repository,Version=versionText,AssetName=setupName,Size=size,Sha256=Digest(setup)};setupUrl=Url(setup,setupName);
                    candidate=new(manifest,setupUrl,Path.Combine(directory,setupName),Url(bundle,bundleName),bundleSize,Digest(bundle));
                }
                else
                {
                    // Continue to accept older RSA-signed releases, but never bypass their signature.
                    const string manifestName="update-manifest.json",signatureName="update-manifest.sig";
                    var manifestBytes=await DownloadSmall(Url(Asset(manifestName),manifestName),32768,timeout.Token);var signature=await DownloadSmall(Url(Asset(signatureName),signatureName),1024,timeout.Token);
                    manifest=UpdateSecurity.VerifyManifest(manifestBytes,signature,tag,verificationKey);var setup=Asset(manifest.AssetName);setupUrl=Url(setup,manifest.AssetName);
                    if(setup.GetProperty("size").GetInt64()!=manifest.Size)throw new IOException(UiLanguage.T("更新ファイルのサイズ情報が一致しません。", "The update file size information does not match."));
                    if(setup.TryGetProperty("digest",out var digest)&&digest.ValueKind==JsonValueKind.String&&digest.GetString() is {Length:>0} hash&&!hash.Equals("sha256:"+manifest.Sha256,StringComparison.OrdinalIgnoreCase))throw new IOException(UiLanguage.T("更新ファイルの検証情報が一致しません。", "The update verification information does not match."));
                    await Storage.AtomicBytes(Path.Combine(directory,manifestName),manifestBytes);await Storage.AtomicBytes(Path.Combine(directory,signatureName),signature);
                    candidate=new(manifest,setupUrl,Path.Combine(directory,manifest.AssetName));
                }
                await Stamp();var notes=root.TryGetProperty("body",out var body)&&body.ValueKind==JsonValueKind.String?body.GetString()??"":"";if(notes.Length>16000)notes=notes[..16000];
                return new{available=true,version=manifest.Version,bytes=manifest.Size,notes};
            }
            catch(OperationCanceledException){return new{available=false,status="offline"};}
            catch(HttpRequestException){return new{available=false,status="offline"};}
            catch(Exception ex) when(ex is JsonException or KeyNotFoundException or InvalidOperationException or FormatException or IOException)
            {
                // Invalid or unverifiable release metadata must not block editing or become an update candidate.
                candidate=null;Storage.Log(ex);return new{available=false,status="invalid"};
            }
        }finally{gate.Release();}
    }
    private async Task<byte[]> DownloadSmall(string url,int max,CancellationToken token){using var response=await GetAsset(url,token);return await ReadBounded(response,max,token);}
    private static async Task<byte[]> ReadBounded(HttpResponseMessage response,int max,CancellationToken token)
    {
        if(response.Content.Headers.ContentLength>max)throw new IOException(UiLanguage.T("更新情報が大きすぎます。", "The update information is too large."));await using var input=await response.Content.ReadAsStreamAsync(token);using var output=new MemoryStream();var buffer=new byte[16384];int count;while((count=await input.ReadAsync(buffer,token))>0){if(output.Length+count>max)throw new IOException(UiLanguage.T("更新情報が大きすぎます。", "The update information is too large."));await output.WriteAsync(buffer.AsMemory(0,count),token);}return output.ToArray();
    }
    private async Task<HttpResponseMessage> GetAsset(string value,CancellationToken token)
    {
        var uri=new Uri(value);for(var hop=0;hop<6;hop++)
        {
            if(!UpdateSecurity.IsDownloadHop(uri))throw new IOException(UiLanguage.T("許可されていない更新の配布先です。", "The update download location is not permitted."));var response=await client.GetAsync(uri,HttpCompletionOption.ResponseHeadersRead,token);
            if(response.StatusCode is HttpStatusCode.MovedPermanently or HttpStatusCode.Redirect or HttpStatusCode.SeeOther or HttpStatusCode.TemporaryRedirect or HttpStatusCode.PermanentRedirect){var location=response.Headers.Location;response.Dispose();if(location is null)throw new IOException(UiLanguage.T("更新の転送先が空です。", "The update redirect location is empty."));uri=location.IsAbsoluteUri?location:new Uri(uri,location);continue;}
            if(!response.IsSuccessStatusCode){var status=response.StatusCode;response.Dispose();throw new HttpRequestException(UiLanguage.T("更新ファイルを取得できませんでした。", "Could not download the update file."),null,status);}return response;
        }throw new IOException(UiLanguage.T("更新の転送回数が多すぎます。", "Too many update redirects."));
    }
    public async Task Download(string expectedVersion,Action<double> progress)
    {
        await gate.WaitAsync();string? partial=null;try
        {
            downloaded=null;using var cancellation=new CancellationTokenSource(TimeSpan.FromMinutes(20));downloadCancellation=cancellation;var token=cancellation.Token;
            var item=candidate??throw new IOException(UiLanguage.T("先に更新を確認してください。", "Check for updates first."));if(item.Manifest.Version!=expectedVersion)throw new IOException(UiLanguage.T("更新の対象が変わりました。もう一度更新を確認してください。", "The update has changed. Check for updates again."));
            if(File.Exists(item.Path))
            {
                var intact=true;try{await UpdateSecurity.VerifyFile(item.Path,item.Manifest,token);}catch(IOException){File.Delete(item.Path);intact=false;}
                // A valid cached setup is not re-downloaded merely because its proof failed.
                if(intact){await VerifyCandidate(item,item.Path,token);token.ThrowIfCancellationRequested();downloaded=item;progress(100);return;}
            }
            using var response=await GetAsset(item.Url,token);
            if(response.Content.Headers.ContentLength is long length&&length!=item.Manifest.Size)throw new IOException(UiLanguage.T("更新ファイルのサイズが一致しません。", "The update file size does not match."));
            partial=item.Path+"."+Guid.NewGuid().ToString("N")+".part";await using(var input=await response.Content.ReadAsStreamAsync(token))await using(var output=new FileStream(partial,FileMode.CreateNew,FileAccess.Write,FileShare.None,131072,true))
            {
                var buffer=new byte[131072];long total=0;var last=Environment.TickCount64;int count;while((count=await input.ReadAsync(buffer,token))>0){total+=count;if(total>item.Manifest.Size||total>UpdateSecurity.MaxInstallerSize)throw new IOException(UiLanguage.T("更新ファイルが大きすぎます。", "The update file is too large."));await output.WriteAsync(buffer.AsMemory(0,count),token);if(Environment.TickCount64-last>200){progress(total*100.0/item.Manifest.Size);last=Environment.TickCount64;}}await output.FlushAsync(token);
            }
            await VerifyCandidate(item,partial,token);token.ThrowIfCancellationRequested();File.Move(partial,item.Path,true);partial=null;downloaded=item;progress(100);
        }
        catch(OperationCanceledException){throw new IOException(UiLanguage.T("更新のダウンロードを中止しました。", "The update download was cancelled."));}
        finally{downloadCancellation=null;try{if(partial is not null&&File.Exists(partial))File.Delete(partial);}catch(Exception e)when(e is IOException or UnauthorizedAccessException){Storage.Log(e);}finally{gate.Release();}}
    }
    private async Task VerifyCandidate(Candidate item,string path,CancellationToken token)
    {
        await UpdateSecurity.VerifyFile(path,item.Manifest,token);
        if(item.BundleUrl is null)return;
        var bytes=await DownloadSmall(item.BundleUrl,UpdateProvenance.MaxBundleSize,token);
        if(bytes.LongLength!=item.BundleSize||!Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes)).Equals(item.BundleHash,StringComparison.OrdinalIgnoreCase))throw new IOException(UiLanguage.T("更新の証明ファイルが一致しません。", "The update attestation file does not match."));
        var bundle=path+"."+Guid.NewGuid().ToString("N")+".sigstore.json";
        try{await File.WriteAllBytesAsync(bundle,bytes,token);await verifyProvenance(path,bundle,item.Manifest,token);await UpdateSecurity.VerifyFile(path,item.Manifest,token);}
        finally{try{File.Delete(bundle);}catch(IOException e){Storage.Log(e);}catch(UnauthorizedAccessException e){Storage.Log(e);}}
    }
    public void Cancel()=>downloadCancellation?.Cancel();
    public async Task<string> VerifiedInstaller(){var item=downloaded??throw new IOException(UiLanguage.T("更新がダウンロードされていません。", "The update has not been downloaded."));if(UpdateSecurity.ParseVersion(item.Manifest.Version)<=UpdateSecurity.ParseVersion(installedVersion))throw new IOException(UiLanguage.T("古い版への更新はできません。", "Updating to an older version is not supported."));await UpdateSecurity.VerifyFile(item.Path,item.Manifest);return item.Path;}
    public void Dispose(){downloadCancellation?.Cancel();client.Dispose();}
}

