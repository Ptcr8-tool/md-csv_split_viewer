using System.Text;

namespace MdSplit;

// Each read is bounded, but page indexes cover the entire 64-bit file length.
// This path never opens a file for writing.
internal static class BinaryPreview
{
    internal const int PageBytes = 64 * 1024;
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
        var count = 0;
        while (count < sample.Length)
        {
            var n = stream.Read(sample, count, sample.Length - count);
            if (n == 0) break;
            count += n;
        }
        if (count != sample.Length) Array.Resize(ref sample, count);
        try { TextCodec.Decode(sample); return false; }
        catch (BinaryContentException) { return true; }
        catch (DecoderFallbackException) { return false; }
    }

    internal static long PageCount(long length)
    {
        if (length < 0) throw new ArgumentOutOfRangeException(nameof(length));
        // Avoid length + PageBytes - 1, which overflows for a large file.
        return Math.Max(1, length / PageBytes + (length % PageBytes == 0 ? 0 : 1));
    }

    internal static long PageForOffset(long offset, long length)
    {
        if (offset < 0) throw new ArgumentOutOfRangeException(nameof(offset));
        var count = PageCount(length);
        return Math.Min(offset / PageBytes, count - 1);
    }

    internal static (byte[] Bytes, long Length, long Page, long Offset, long Pages) ReadPage(string path, long requestedPage)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        return ReadPage(stream, requestedPage);
    }

    internal static (byte[] Bytes, long Length, long Page, long Offset, long Pages) ReadPage(Stream stream, long requestedPage)
    {
        var length = stream.Length;
        var pages = PageCount(length);
        var page = Math.Clamp(requestedPage, 0, pages - 1);
        var offset = page * (long)PageBytes;
        stream.Seek(offset, SeekOrigin.Begin);
        var bytes = new byte[(int)Math.Min(length - offset, PageBytes)];
        // A file can shrink concurrently. Display only bytes actually read.
        var count = 0;
        while (count < bytes.Length)
        {
            var n = stream.Read(bytes, count, bytes.Length - count);
            if (n == 0) break;
            count += n;
        }
        if (count != bytes.Length) Array.Resize(ref bytes, count);
        return (bytes, length, page, offset, pages);
    }

    internal static string Format(byte[] bytes, long offset = 0)
    {
        if (offset < 0) throw new ArgumentOutOfRangeException(nameof(offset));
        var result = new StringBuilder((bytes.Length / 16 + 1) * 78);
        for (var at = 0; at < bytes.Length; at += 16)
        {
            result.Append((offset + at).ToString("X8")).Append("  ");
            var count = Math.Min(16, bytes.Length - at);
            for (var i = 0; i < 16; i++)
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
