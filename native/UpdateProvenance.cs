using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;

namespace MdSplit;

// The verifier and the TUF-validated trust roots are bundled at build time.
// Their hashes are embedded in the application, rather than read from the
// writable directory alongside the verifier.
internal static class UpdateProvenance
{
    public const int MaxBundleSize=4*1024*1024;
    private const string RepositoryId="1440570920";
    private const string Workflow=BuildIdentity.Repository+"/.github/workflows/windows-release.yml";

    public static async Task Verify(string installer,string bundle,UpdateManifest manifest,CancellationToken token)
    {
        using var resource=typeof(UpdateProvenance).Assembly.GetManifestResourceStream("MdSplit.UpdateVerifierPins.json")
            ??throw new IOException("更新の検証ツールがありません。公式セットアップで修復してください。");
        using var reader=new StreamReader(resource);var pins=await reader.ReadToEndAsync(token);
        await VerifyWithPins(installer,bundle,manifest,Path.Combine(AppContext.BaseDirectory,"update-verifier"),pins,token);
    }

    // Also called by the release test with the actual attested setup.
    internal static Task VerifyWithPins(string installer,string bundle,UpdateManifest manifest,string verifierDirectory,string pinsJson,CancellationToken token)=>
        VerifyCore(installer,bundle,manifest,verifierDirectory,pinsJson,"refs/tags/v"+manifest.Version,token);
#if MDSPLIT_TESTS
    // Pull-request tests use their own ref; this method is not compiled into the application.
    internal static Task VerifyWithTestRef(string installer,string bundle,UpdateManifest manifest,string verifierDirectory,string pinsJson,string sourceRef,CancellationToken token)=>
        VerifyCore(installer,bundle,manifest,verifierDirectory,pinsJson,sourceRef,token);
#endif
    private static async Task VerifyCore(string installer,string bundle,UpdateManifest manifest,string verifierDirectory,string pinsJson,string sourceRef,CancellationToken token)
    {
        try
        {
            using var pins=JsonDocument.Parse(pinsJson);var root=pins.RootElement;
            if(root.GetProperty("repository").GetString()!=BuildIdentity.Repository||root.GetProperty("repository_id").ToString()!=RepositoryId||root.GetProperty("workflow").GetString()!=Workflow)throw new IOException("更新の検証情報が正しくありません。");
            var gh=Path.GetFullPath(Path.Combine(verifierDirectory,"gh.exe"));var trust=Path.GetFullPath(Path.Combine(verifierDirectory,"trusted_root.jsonl"));
            await CheckTool(gh,root.GetProperty("gh_sha256").GetString(),100L*1024*1024,token);
            await CheckTool(trust,root.GetProperty("trusted_root_sha256").GetString(),2*1024*1024,token);
            UpdateSecurity.ParseVersion(manifest.Version);
            var privateConfig=Directory.CreateTempSubdirectory("md-split-verify-");
            try
            {
                var start=new ProcessStartInfo(gh){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,WorkingDirectory=privateConfig.FullName};
                foreach(var argument in new[]{"attestation","verify",Path.GetFullPath(installer),"--bundle",Path.GetFullPath(bundle),"--custom-trusted-root",trust,"--repo",BuildIdentity.Repository,"--signer-workflow",Workflow,"--source-ref",sourceRef,"--deny-self-hosted-runners","--cert-oidc-issuer","https://token.actions.githubusercontent.com","--format","json"})start.ArgumentList.Add(argument);
                var environment=new Dictionary<string,string>();foreach(var key in new[]{"SYSTEMROOT","WINDIR","TEMP","TMP","LOCALAPPDATA"})if(Environment.GetEnvironmentVariable(key) is string value)environment[key]=value;
                start.Environment.Clear();foreach(var pair in environment)start.Environment[pair.Key]=pair.Value;
                start.Environment["GH_CONFIG_DIR"]=privateConfig.FullName;start.Environment["GH_NO_UPDATE_NOTIFIER"]="1";start.Environment["GH_NO_EXTENSION_UPDATE_NOTIFIER"]="1";start.Environment["GH_PROMPT_DISABLED"]="1";start.Environment["GH_HOST"]="github.com";
                using var process=Process.Start(start)??throw new IOException("更新の検証を開始できませんでした。");
                using var timeout=CancellationTokenSource.CreateLinkedTokenSource(token);timeout.CancelAfter(TimeSpan.FromSeconds(90));
                var output=process.StandardOutput.ReadToEndAsync(timeout.Token);var errors=process.StandardError.ReadToEndAsync(timeout.Token);
                try{await process.WaitForExitAsync(timeout.Token);await Task.WhenAll(output,errors);}
                catch(OperationCanceledException){try{process.Kill(true);}catch(InvalidOperationException){}throw;}
                if(process.ExitCode!=0||output.Result.Length>MaxBundleSize)throw new IOException("更新の署名または配布元を確認できません。");
                if(!VerifiedResultMatches(output.Result,manifest.Sha256))throw new IOException("更新の証明に含まれる配布元またはファイルが一致しません。");
            }
            finally{try{privateConfig.Delete(true);}catch(IOException e){Storage.Log(e);}catch(UnauthorizedAccessException e){Storage.Log(e);}}
        }
        catch(Exception e)when(e is JsonException or KeyNotFoundException or InvalidOperationException or FormatException or System.ComponentModel.Win32Exception)
        {throw new IOException("更新の署名検証を完了できませんでした。",e);}
    }

    private static async Task CheckTool(string path,string? expected,long max,CancellationToken token)
    {
        var file=new FileInfo(path);
        if(!file.Exists||file.Length<1||file.Length>max||(file.Attributes&FileAttributes.ReparsePoint)!=0||expected is null||!System.Text.RegularExpressions.Regex.IsMatch(expected,@"\A[0-9a-f]{64}\z"))throw new IOException("更新の検証ツールを確認できません。");
        await using var input=File.OpenRead(path);var hash=Convert.ToHexString(await SHA256.HashDataAsync(input,token));
        if(!hash.Equals(expected,StringComparison.OrdinalIgnoreCase))throw new IOException("更新の検証ツールが変更されています。");
    }

    internal static bool VerifiedResultMatches(string json,string expectedHash)
    {
        using var doc=JsonDocument.Parse(json);if(doc.RootElement.ValueKind!=JsonValueKind.Array)return false;
        foreach(var item in doc.RootElement.EnumerateArray())
        {
            if(!item.TryGetProperty("verificationResult",out var result)||!result.TryGetProperty("signature",out var signature)||!signature.TryGetProperty("certificate",out var certificate)||!certificate.TryGetProperty("sourceRepositoryIdentifier",out var id)||id.ToString()!=RepositoryId)continue;
            if(!result.TryGetProperty("verifiedTimestamps",out var timestamps)||timestamps.ValueKind!=JsonValueKind.Array||timestamps.GetArrayLength()==0||!result.TryGetProperty("statement",out var statement)||!statement.TryGetProperty("subject",out var subjects)||subjects.ValueKind!=JsonValueKind.Array)continue;
            foreach(var subject in subjects.EnumerateArray())if(subject.TryGetProperty("digest",out var digest)&&digest.TryGetProperty("sha256",out var sha)&&string.Equals(sha.GetString(),expectedHash,StringComparison.OrdinalIgnoreCase))return true;
        }
        return false;
    }
}
