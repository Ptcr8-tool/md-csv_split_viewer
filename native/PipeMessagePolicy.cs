using System.Text;
using System.Text.Json;

namespace MdSplit;

// Bounds and validates the command sent between instances; no file is opened here.
internal static class PipeMessagePolicy
{
    internal const int MaxArguments = 100;
    internal const int MaxPathLength = 32767;
    internal const int MaxMessageLength = 128 * 1024;

    public static string Encode(string[] args)
    {
        if (!Valid(args)) throw new IOException("一度に渡せるファイル数またはパスの長さを超えました。");
        var json = JsonSerializer.Serialize(args);
        if (json.Length > MaxMessageLength) throw new IOException("起動中の画面へ渡すファイル一覧が大きすぎます。");
        return json;
    }

    public static string[] Decode(string json)
    {
        if (json.Length > MaxMessageLength) throw new IOException("ファイル一覧が大きすぎます。");
        var args = JsonSerializer.Deserialize<string?[]>(json);
        if (args is null || !Valid(args)) throw new IOException("ファイル一覧の形式が正しくありません。");
        return args.Select(x => x!).ToArray();
    }

    private static bool Valid(string?[] args) => args.Length <= MaxArguments &&
        args.All(x => x is not null && x.Length <= MaxPathLength && !x.Any(char.IsControl));

    public static async Task<string?> ReadLine(StreamReader reader, CancellationToken token)
    {
        var result = new StringBuilder(); var buffer = new char[4096];
        while (true)
        {
            var count = await reader.ReadAsync(buffer.AsMemory(), token);
            if (count == 0) return result.Length == 0 ? null : result.ToString();
            for (var i = 0; i < count; i++)
            {
                if (buffer[i] == '\n') return result.Length > 0 && result[^1] == '\r' ? result.ToString(0, result.Length - 1) : result.ToString();
                // Allow the CR in a maximum-length Windows CRLF-terminated message.
                if (result.Length >= MaxMessageLength + 1) throw new IOException("ファイル一覧が大きすぎます。");
                result.Append(buffer[i]);
            }
        }
    }
}
