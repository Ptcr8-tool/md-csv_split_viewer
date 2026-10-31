using System.Text;
using System.Text.Json;
using MdSplit;

internal static class TextCodecChecks
{
    public static async Task Run(string root, Action<bool, string> assert)
    {
        using (var shared = JsonDocument.Parse(File.ReadAllText(SharedFixturePath(), Encoding.UTF8)))
        {
            foreach (var vector in shared.RootElement.EnumerateArray())
            {
                var name = vector.GetProperty("name").GetString()!;
                var bytes = vector.GetProperty("bytes").EnumerateArray().Select(v => v.GetByte()).ToArray();
                var forced = vector.TryGetProperty("forced", out var force) ? force.GetString() : null;
                if (vector.TryGetProperty("error", out _))
                {
                    assert(Throws<IOException>(() => TextCodec.Decode(bytes, forced)), "shared browser/native detection: " + name);
                    continue;
                }
                var decoded = TextCodec.Decode(bytes, forced);
                assert(decoded.Text == vector.GetProperty("text").GetString() &&
                    decoded.Encoding == vector.GetProperty("encoding").GetString() &&
                    decoded.EncodingGuessed == vector.GetProperty("guessed").GetBoolean() &&
                    decoded.HasBom == vector.GetProperty("bom").GetBoolean(), "shared browser/native detection: " + name);
            }
        }
        var emojiCsv = "名前,本文\r\n\"友人\",\"家族 👨‍👩‍👧‍👦 🇯🇵 ❤️\r\n笑顔 😀\"\r\n";
        var emojiBytes = TextCodec.Encode(emojiCsv, "utf8bom", true);
        var emojiDecoded = TextCodec.Decode(emojiBytes);
        assert(emojiDecoded.Text == emojiCsv && emojiDecoded.Encoding == "utf8bom" && emojiDecoded.HasBom &&
            TextCodec.Encode(emojiDecoded.Text, emojiDecoded.Encoding, emojiDecoded.HasBom).SequenceEqual(emojiBytes),
            "automatically open and save UTF-8 BOM CSV with complex emoji and quoted line breaks without loss");
        var fixtures = new Dictionary<string, string>
        {
            ["utf8"] = "日本語🙂\r\nASCII\n", ["utf8bom"] = "日本語🙂\r\nASCII\n",
            ["utf16le"] = "日本語🙂\r\nASCII\n", ["utf16be"] = "日本語🙂\r\nASCII\n",
            ["utf32le"] = "日本語🙂\r\nASCII\n", ["utf32be"] = "日本語🙂\r\nASCII\n",
            ["shiftjis"] = "日本語の文章\r\nASCII\t~!", ["eucjp"] = "日本語の文章\r\nASCII\t~!", ["iso2022jp"] = "日本語の文章\r\nASCII\t~!",
            ["windows1252"] = "café élève € —", ["gb18030"] = "简体中文𠀀🙂", ["big5"] = "繁體中文 臺灣", ["korean949"] = "한글 문서"
        };
        foreach (var (id, original) in fixtures)
        {
            var bytes = TextCodec.Encode(original, id);
            var decoded = TextCodec.Decode(bytes, id);
            assert(decoded.Text == original && !decoded.EncodingGuessed && TextCodec.Encode(decoded.Text, decoded.Encoding, decoded.HasBom).SequenceEqual(bytes), "strict text and byte round trip: " + id);
        }
        foreach (var id in new[] { "utf8", "utf8bom", "utf16le", "utf16be", "utf32le", "utf32be" })
        {
            var bytes = TextCodec.Encode("ASCII 日本語\r\nsecond line", id, false);
            var decoded = TextCodec.Decode(bytes);
            assert(decoded.Text == "ASCII 日本語\r\nsecond line" && !decoded.HasBom && TextCodec.Encode(decoded.Text, decoded.Encoding, decoded.HasBom).SequenceEqual(bytes), "BOM-less Unicode stays BOM-less: " + id);
        }
        var utf32le = TextCodec.Decode([0xff, 0xfe, 0, 0, 0x41, 0, 0, 0]);
        var utf32be = TextCodec.Decode([0, 0, 0xfe, 0xff, 0, 0, 0, 0x41]);
        assert(utf32le.Encoding == "utf32le" && utf32be.Encoding == "utf32be" && utf32le.Text == "A" && utf32be.Text == "A", "UTF-32 BOM wins over its UTF-16 prefix");
        assert(Throws<DecoderFallbackException>(() => TextCodec.Decode([0xff, 0xfe, 0, 0, 0x41, 0, 0, 0], "utf16le")) &&
            Throws<DecoderFallbackException>(() => TextCodec.Decode([0xfe, 0xff, 0, 0x41], "utf16le")) &&
            Throws<DecoderFallbackException>(() => TextCodec.Decode([0xef, 0xbb, 0xbf, 0x41], "windows1252")), "explicit encodings that conflict with a known BOM are rejected before decoding");
        assert(TextCodec.CanonicalId("shift_jis") == "shiftjis" && TextCodec.CanonicalId("cp932") == "shiftjis" && TextCodec.CanonicalId("GB-18030") == "gb18030", "supported aliases resolve to stable encoding IDs");
        assert(Throws<IOException>(() => TextCodec.CanonicalId("0")) && Throws<IOException>(() => TextCodec.Encode("unchanged", "made-up-encoding")), "unknown or machine-dependent code page IDs fail instead of silently using UTF-8");
        foreach (var malformed in new byte[][] { [0xc0, 0xaf], [0x80], [0xe3, 0x81] })
            assert(Throws<DecoderFallbackException>(() => TextCodec.Decode(malformed, "utf8")), "malformed UTF-8 is rejected without replacement: " + Convert.ToHexString(malformed));
        assert(Throws<DecoderFallbackException>(() => TextCodec.Decode([0xef, 0xbb, 0xbf, 0xc0, 0xaf])), "invalid BOM-tagged UTF-8 never falls back to another code page");
        assert(Throws<DecoderFallbackException>(() => TextCodec.Decode([0xff, 0xfe, 0, 0xd8])) && Throws<DecoderFallbackException>(() => TextCodec.Decode([0xff, 0xfe, 0x41])), "invalid UTF-16 surrogate or truncated code unit is rejected");
        assert(Throws<DecoderFallbackException>(() => TextCodec.Decode([0xff, 0xfe, 0, 0, 0, 0, 0x11, 0])) && Throws<DecoderFallbackException>(() => TextCodec.Decode([0xff, 0xfe, 0, 0, 0, 0xd8, 0, 0])), "invalid UTF-32 scalar and surrogate are rejected");
        assert(Throws<EncoderFallbackException>(() => TextCodec.Encode("broken\ud800", "utf8")) && Throws<EncoderFallbackException>(() => TextCodec.Encode("🙂", "shiftjis")), "saving invalid Unicode or unrepresentable legacy text fails without substitution");
        var wavePreserved = false;
        try { wavePreserved = TextCodec.StrictEncoding("shiftjis").GetString(TextCodec.Encode("\u301c", "shiftjis")) == "\u301c"; }
        catch (EncoderFallbackException) { wavePreserved = true; }
        assert(wavePreserved, "CP932 wave-dash aliases are preserved exactly or rejected, never silently changed");
        var jis = TextCodec.Decode([0x1b, 0x24, 0x42, 0x46, 0x7c, 0x4b, 0x5c, 0x38, 0x6c, 0x1b, 0x28, 0x42]);
        assert(jis.Encoding == "iso2022jp" && jis.Text == "日本語" && jis.EncodingGuessed && jis.EncodingNotice is not null, "ISO-2022-JP is recognized before its ASCII bytes can be mistaken for UTF-8");
        assert(Throws<DecoderFallbackException>(() => TextCodec.Decode([0x1b, 0x24, 0x42, 0x46], "iso2022jp")), "truncated ISO-2022-JP double-byte character fails strict decoding");
        var euc = TextCodec.Decode([0xa4, 0xa2]);
        assert(euc.Encoding == "eucjp" && euc.Text == "あ" && euc.EncodingGuessed, "EUC-JP kana evidence beats a CP932 halfwidth interpretation");
        var shiftjis = TextCodec.Decode([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea]);
        assert(shiftjis.Encoding == "shiftjis" && shiftjis.Text == "日本語" && shiftjis.EncodingGuessed, "CP932 Japanese is decoded with an explicit estimation notice");
        var western = TextCodec.Decode([0x63, 0x61, 0x66, 0xe9]);
        assert(western.Encoding == "windows1252" && western.Text == "café" && western.EncodingGuessed, "ambiguous legacy fallback is marked as an estimate");
        var binary = new byte[] { 0, 1, 2, 3, 4, 5, 6, 7 };
        assert(Throws<IOException>(() => TextCodec.Decode(binary)), "binary null and control content is rejected during automatic opening");
        assert(TextCodec.Decode(binary, "utf8").Text.Length == binary.Length, "explicit encoding can open binary-looking content while keeping strict decoding");
        var literalReplacement = TextCodec.Decode(TextCodec.Encode("actual \ufffd character", "utf8"));
        assert(literalReplacement.Text == "actual \ufffd character", "an actual replacement-character code point in valid text is preserved");
        var forcedNoBom = TextCodec.Decode(TextCodec.Encode("plain", "utf16le", false), "utf16le");
        assert(!forcedNoBom.HasBom && !forcedNoBom.EncodingGuessed, "explicit UTF-16 reopen reports the actual absence of a BOM");
        var samplePath = Path.Combine(root, "codec-fixture.txt");
        await File.WriteAllBytesAsync(samplePath, TextCodec.Encode("日本語\r\n", "eucjp"));
        assert(TextCodec.Decode(await File.ReadAllBytesAsync(samplePath), "eucjp").Text == "日本語\r\n", "text codec preserves a file fixture's original line endings");
    }

    private static string SharedFixturePath()
    {
        foreach (var start in new[] { Environment.CurrentDirectory, AppContext.BaseDirectory })
            for (var dir = new DirectoryInfo(start); dir is not null; dir = dir.Parent)
            {
                var path = Path.Combine(dir.FullName, "tests", "fixtures", "codec-detection.json");
                if (File.Exists(path)) return path;
            }
        throw new FileNotFoundException("The shared text codec fixtures were not found.");
    }

    private static bool Throws<T>(Action action) where T : Exception
    {
        try { action(); return false; } catch (T) { return true; }
    }
}
