using System.Text;

namespace MdSplit;

// Binary files are opened read-only. Views and searches use bounded buffers;
// neither operation needs to load the entire file into memory.
internal static class BinaryPreview
{
    internal const int BytesPerLine = 16;
    internal const int SearchBlockBytes = 128 * 1024;
    private const int ProbeBytes = 8 * 1024;
    private static readonly HashSet<string> BinaryExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".mp4", ".mov", ".mkv", ".avi", ".webm", ".mp3", ".wav", ".flac",
        ".pdf", ".zip", ".7z", ".rar", ".exe", ".dll", ".png", ".jpg", ".jpeg", ".gif"
    };

    internal static bool IsKnownBinaryExtension(string path) => BinaryExtensions.Contains(Path.GetExtension(path));

    internal static bool IsNetworkPath(string path) => path.StartsWith(@"\\") || path.StartsWith("//");

    internal static bool IsProbablyBinary(string path)
    {
        // Do not add another synchronous network access to the startup path.
        // Files on shares still fall back to the normal decoder below.
        if (IsNetworkPath(path)) return false;
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        var sample = new byte[(int)Math.Min(stream.Length, ProbeBytes)];
        var count = ReadUpTo(stream, sample, sample.Length);
        if (count != sample.Length) Array.Resize(ref sample, count);
        try { TextCodec.Decode(sample); return false; }
        catch (BinaryContentException) { return true; }
        catch (DecoderFallbackException) { return false; }
    }

    internal static long LineCount(long length)
    {
        if (length < 0) throw new ArgumentOutOfRangeException(nameof(length));
        return length == 0 ? 1 : 1 + (length - 1) / BytesPerLine;
    }

    internal static long LastTopLine(long length, int visibleLines) =>
        Math.Max(0, LineCount(length) - Math.Max(1, visibleLines));

    // The scrollbar has a fixed number of positions; use decimal arithmetic so
    // even the largest file offsets do not overflow while dragging its thumb.
    internal static int ScrollValue(long line, long lastLine, int maximum)
    {
        if (lastLine <= 0 || maximum <= 0) return 0;
        return (int)decimal.Round((decimal)Math.Clamp(line, 0, lastLine) * maximum / lastLine);
    }

    internal static long ScrollLine(int value, long lastLine, int maximum)
    {
        if (lastLine <= 0 || maximum <= 0) return 0;
        return (long)decimal.Round((decimal)Math.Clamp(value, 0, maximum) * lastLine / maximum);
    }

    internal static (byte[] Bytes, long Length, long TopLine, long Offset, long TotalLines)
        ReadWindow(string path, long requestedLine, int visibleLines)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        return ReadWindow(stream, requestedLine, visibleLines);
    }

    internal static (byte[] Bytes, long Length, long TopLine, long Offset, long TotalLines)
        ReadWindow(Stream stream, long requestedLine, int visibleLines)
    {
        var rows = Math.Clamp(visibleLines, 1, 4096);
        var length = stream.Length;
        var totalLines = LineCount(length);
        var topLine = Math.Clamp(requestedLine, 0, LastTopLine(length, rows));
        var offset = topLine * BytesPerLine;
        var bytes = new byte[(int)Math.Min(length - offset, (long)rows * BytesPerLine)];
        stream.Seek(offset, SeekOrigin.Begin);
        var count = ReadUpTo(stream, bytes, bytes.Length);
        // A file can shrink while open. Display only bytes actually read.
        if (count != bytes.Length) Array.Resize(ref bytes, count);
        return (bytes, length, topLine, offset, totalLines);
    }

    private static int ReadUpTo(Stream stream, byte[] bytes, int wanted)
    {
        var count = 0;
        while (count < wanted)
        {
            var n = stream.Read(bytes, count, wanted - count);
            if (n == 0) break;
            count += n;
        }
        return count;
    }

    // "start" is a byte offset: inclusive for forward search, exclusive for
    // backwards search. Overlap between blocks preserves matches that straddle
    // a block boundary. Returns the absolute byte offset, or -1 if not found.
    internal static long Find(string path, byte[] pattern, long start, bool backwards,
        CancellationToken cancellation, Action<long, long>? progress = null)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete, SearchBlockBytes,
            backwards ? FileOptions.RandomAccess : FileOptions.SequentialScan);
        return Find(stream, pattern, start, backwards, cancellation, progress);
    }

    internal static long Find(Stream stream, byte[] pattern, long start, bool backwards,
        CancellationToken cancellation, Action<long, long>? progress = null)
    {
        ArgumentNullException.ThrowIfNull(pattern);
        if (pattern.Length == 0) throw new ArgumentException(UiLanguage.T("検索文字を入力してください。", "Enter a search term."), nameof(pattern));
        if (pattern.Length > 1024 * 1024) throw new ArgumentException(UiLanguage.T("検索文字が長すぎます。", "The search term is too long."), nameof(pattern));
        cancellation.ThrowIfCancellationRequested();
        var length = stream.Length;
        var candidates = length < pattern.Length ? 0 : length - pattern.Length + 1;
        var cursor = Math.Clamp(start, 0, candidates);
        var target = backwards ? cursor : candidates - cursor;
        long scanned = 0;
        var buffer = new byte[SearchBlockBytes + pattern.Length - 1];
        while (backwards ? cursor > 0 : cursor < candidates)
        {
            cancellation.ThrowIfCancellationRequested();
            var block = (int)Math.Min(SearchBlockBytes, backwards ? cursor : candidates - cursor);
            var blockStart = backwards ? cursor - block : cursor;
            stream.Seek(blockStart, SeekOrigin.Begin);
            var wanted = block + pattern.Length - 1;
            var count = ReadUpTo(stream, buffer, wanted);
            var span = buffer.AsSpan(0, count);
            var index = backwards ? span.LastIndexOf(pattern) : span.IndexOf(pattern);
            if (index >= 0 && index < block) return blockStart + index;
            scanned += block;
            progress?.Invoke(scanned, target);
            cursor = backwards ? blockStart : cursor + block;
        }
        return -1;
    }

    internal static string Format(byte[] bytes, long offset = 0)
    {
        if (offset < 0) throw new ArgumentOutOfRangeException(nameof(offset));
        var result = new StringBuilder((bytes.Length / BytesPerLine + 1) * 78);
        for (var at = 0; at < bytes.Length; at += BytesPerLine)
        {
            result.Append((offset + at).ToString("X8")).Append("  ");
            var count = Math.Min(BytesPerLine, bytes.Length - at);
            for (var i = 0; i < BytesPerLine; i++)
                if (i < count) result.Append(bytes[at + i].ToString("X2")).Append(' ');
                else result.Append("   ");
            result.Append(" |");
            for (var i = 0; i < count; i++)
                result.Append(bytes[at + i] is >= 32 and < 127 ? (char)bytes[at + i] : '.');
            result.AppendLine("|");
        }
        return result.ToString();
    }
}
