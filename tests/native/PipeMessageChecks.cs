using System.Text;
using System.Text.Json;
using MdSplit;

internal static class PipeMessageChecks
{
    public static async Task Run(Action<bool,string> assert)
    {
        var args = new[] { @"C:\Documents\文章 と 絵文字🙂.md", @"C:\Documents\表.csv", "--option" };
        var json = PipeMessagePolicy.Encode(args);
        assert(PipeMessagePolicy.Decode(json).SequenceEqual(args), "single-instance pipe preserves Windows paths, spaces, Unicode and options");
        using (var reader = new StreamReader(new MemoryStream(Encoding.UTF8.GetBytes(json + "\r\n"))))
            assert(await PipeMessagePolicy.ReadLine(reader, CancellationToken.None) == json, "single-instance pipe handles the Windows CRLF sender");
        using (var reader = new StreamReader(new MemoryStream(Encoding.UTF8.GetBytes(json + "\n"))))
            assert(await PipeMessagePolicy.ReadLine(reader, CancellationToken.None) == json, "single-instance pipe handles LF sender");
        static bool Reject(string value)
        {
            try { PipeMessagePolicy.Decode(value); return false; }
            catch (Exception ex) when (ex is IOException or JsonException) { return true; }
        }
        assert(Reject("[null]") && Reject("{}") && Reject("[\"a\\nb\"]"), "malformed, null and control-character pipe arguments are rejected");
        assert(Reject(JsonSerializer.Serialize(Enumerable.Repeat("a", PipeMessagePolicy.MaxArguments + 1).ToArray())), "too many pipe arguments are rejected");
        assert(Reject(JsonSerializer.Serialize(new[] {new string('a', PipeMessagePolicy.MaxPathLength + 1)})), "overlong pipe paths are rejected");
        using (var reader = new StreamReader(new MemoryStream(Encoding.UTF8.GetBytes(new string('x', PipeMessagePolicy.MaxMessageLength + 2)))))
        {
            var rejected = false; try { await PipeMessagePolicy.ReadLine(reader, CancellationToken.None); } catch (IOException) { rejected = true; }
            assert(rejected, "oversized pipe input is rejected while reading instead of growing without limit");
        }
    }
}
