using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
namespace MdSplit;
internal static class BuildIdentity
{
    public const string Version="1.0.0";
    public const string Repository="Ptcr8-tool/md-csv_split_viewer";
    public static string SetupName(string version)=>$"MD-Split-{version}-Setup.exe";
}
internal sealed class UpdateManifest
{
    public string Repository{get;set;}="";
    public string Version{get;set;}="";
    public string AssetName{get;set;}="";
    public string Sha256{get;set;}="";
    public long Size{get;set;}
}
internal static class UpdateSecurity
{
    public const long MaxInstallerSize=1500L*1024*1024;
    public static bool IsDue(int days,DateTimeOffset? last,DateTimeOffset now)=>days>=0&&(days==0||last is null||last>now||now-last>=TimeSpan.FromDays(days));
    public static Version ParseVersion(string value)
    {
        if(!Regex.IsMatch(value,@"^(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})$",RegexOptions.CultureInvariant,TimeSpan.FromMilliseconds(50))||!System.Version.TryParse(value,out var version))throw new IOException("更新のバージョン表記が正しくありません。");return version;
    }
    public static string PublicKey(){using var stream=typeof(UpdateSecurity).Assembly.GetManifestResourceStream("MdSplit.UpdatePublicKey.pem")??throw new IOException("更新の検証鍵が見つかりません。");using var reader=new StreamReader(stream);return reader.ReadToEnd();}
    public static UpdateManifest VerifyManifest(byte[] content,byte[] signature,string tag,string? key=null)
    {
        if(content.Length>32768||signature.Length>1024)throw new IOException("更新情報が大きすぎます。");
        using var rsa=RSA.Create();rsa.ImportFromPem(key??PublicKey());if(rsa.KeySize<3072||!rsa.VerifyData(content,signature,HashAlgorithmName.SHA256,RSASignaturePadding.Pss))throw new IOException("更新情報の署名を確認できません。更新を中止しました。");
        var manifest=JsonSerializer.Deserialize<UpdateManifest>(content,Storage.Json)??throw new IOException("更新情報が空です。");ParseVersion(manifest.Version);
        if(manifest.Repository!=BuildIdentity.Repository||tag!="v"+manifest.Version||manifest.AssetName!=BuildIdentity.SetupName(manifest.Version)||manifest.Size<1||manifest.Size>MaxInstallerSize||!Regex.IsMatch(manifest.Sha256,@"\A[0-9a-fA-F]{64}\z"))throw new IOException("更新情報が配布元と一致しません。");return manifest;
    }
    public static bool IsAssetUrl(string value,string tag,string name)=>Uri.TryCreate(value,UriKind.Absolute,out var uri)&&uri.Scheme=="https"&&uri.IsDefaultPort&&uri.Host=="github.com"&&uri.UserInfo.Length==0&&uri.Query.Length==0&&uri.Fragment.Length==0&&uri.AbsolutePath=="/"+BuildIdentity.Repository+"/releases/download/"+tag+"/"+name;
    public static bool IsDownloadHop(Uri uri)=>uri.Scheme=="https"&&uri.IsDefaultPort&&uri.UserInfo.Length==0&&uri.Fragment.Length==0&&(uri.Host is "github.com" or "release-assets.githubusercontent.com" or "objects.githubusercontent.com");
    public static async Task VerifyFile(string path,UpdateManifest manifest,CancellationToken cancellationToken=default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if(!File.Exists(path)||new FileInfo(path).Length!=manifest.Size)throw new IOException("更新ファイルのサイズが一致しません。");
        await using var stream=File.OpenRead(path);var hash=Convert.ToHexString(await SHA256.HashDataAsync(stream,cancellationToken));if(!hash.Equals(manifest.Sha256,StringComparison.OrdinalIgnoreCase))throw new IOException("更新ファイルのハッシュが一致しません。実行せずに中止しました。");
    }
}
