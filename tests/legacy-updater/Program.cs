using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;

// Run inside an installation made from the hash-pinned v1.0.3 setup. Load the
// actual shipped updater and its embedded verifier pins; only the release API
// and asset transport are replaced with an in-memory, local fixture.
if (args.Length != 5) throw new ArgumentException("Expected installer, proof, version, scratch directory and version override.");
var setup = Path.GetFullPath(args[0]);
var proof = Path.GetFullPath(args[1]);
var version = args[2];
var scratch = Path.GetFullPath(args[3]);
var overrideVersion = args[4] == "-" ? null : args[4];
var setupName = $"MD-Split-{version}-Setup.exe";
var proofName = setupName + ".sigstore.json";
var prefix = $"https://github.com/Ptcr8-tool/md-csv_split_viewer/releases/download/v{version}/";
static string Hash(string path) { using var stream = File.OpenRead(path); return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant(); }
var setupHash = Hash(setup);
var proofHash = Hash(proof);
var release = JsonSerializer.Serialize(new {
    tag_name = "v" + version, draft = false, prerelease = false, body = "Compatibility fixture",
    assets = new[] {
        new { name = setupName, size = new FileInfo(setup).Length, browser_download_url = prefix + setupName, digest = "sha256:" + setupHash },
        new { name = proofName, size = new FileInfo(proof).Length, browser_download_url = prefix + proofName, digest = "sha256:" + proofHash }
    }
});
var oldApp = Assembly.LoadFrom(Path.Combine(AppContext.BaseDirectory, "MD-Split.dll"));
var identity = oldApp.GetType("MdSplit.BuildIdentity", throwOnError: true)!;
if ((string?)identity.GetField("Version", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)?.GetRawConstantValue() != "1.0.3")
    throw new InvalidOperationException("The installed updater is not v1.0.3.");
var type = oldApp.GetType("MdSplit.UpdateService", throwOnError: true)!;
using var handler = new FixtureHandler(release, setup, proof, setupName, proofName);
var ctor = type.GetConstructors(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic).Single();
using var service = (IDisposable)ctor.Invoke(new object?[] { handler, scratch, null, null, overrideVersion });
var check = (Task)type.GetMethod("Check")!.Invoke(service, new object?[] { 0, true })!;
await check;
var result = check.GetType().GetProperty("Result")!.GetValue(check);
if (!JsonSerializer.SerializeToElement(result).GetProperty("available").GetBoolean())
    throw new InvalidOperationException("The v1.0.3 updater did not offer the fixture release.");
await (Task)type.GetMethod("Download")!.Invoke(service, new object?[] { version, (Action<double>)(_ => { }) })!;
var verified = (Task<string>)type.GetMethod("VerifiedInstaller")!.Invoke(service, null)!;
if (Hash(await verified) != setupHash) throw new InvalidOperationException("The verified installer changed.");
Console.WriteLine("PASS: the installed v1.0.3 updater accepted the release metadata, downloaded the fixture and verified its real GitHub provenance with its own bundled pins.");

internal sealed class FixtureHandler(string release, string setup, string proof, string setupName, string proofName) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        var uri = request.RequestUri ?? throw new InvalidOperationException("Missing request URL.");
        HttpContent content = uri.Host == "api.github.com" ? new StringContent(release)
            : uri.AbsolutePath.EndsWith("/" + proofName, StringComparison.Ordinal) ? new StreamContent(File.OpenRead(proof))
            : uri.AbsolutePath.EndsWith("/" + setupName, StringComparison.Ordinal) ? new StreamContent(File.OpenRead(setup))
            : throw new InvalidOperationException("Unexpected updater request.");
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = content });
    }
}
