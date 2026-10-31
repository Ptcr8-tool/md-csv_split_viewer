using System.Globalization;
using System.Text;

namespace MdSplit;

internal sealed record DecodedText(string Text, string Encoding, bool HasBom, bool EncodingGuessed, string? EncodingNotice);

internal static class TextCodec
{
    private const string GuessNotice = "文字コードを推定しました。表示が正しくない場合は、文字コードを指定して読み直してください。";

    static TextCodec() => Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

    public static string CanonicalId(string value) => value?.Trim().ToLowerInvariant().Replace('_', '-') switch
    {
        "utf8" or "utf-8" or "65001" => "utf8",
        "utf8bom" or "utf8-bom" or "utf-8-bom" => "utf8bom",
        "utf16le" or "utf-16le" or "utf16" or "utf-16" or "unicode" or "1200" => "utf16le",
        "utf16be" or "utf-16be" or "unicodefffe" or "1201" => "utf16be",
        "utf32le" or "utf-32le" or "utf32" or "utf-32" or "12000" => "utf32le",
        "utf32be" or "utf-32be" or "12001" => "utf32be",
        "shiftjis" or "shift-jis" or "sjis" or "cp932" or "windows-31j" or "932" => "shiftjis",
        "eucjp" or "euc-jp" or "51932" => "eucjp",
        "iso2022jp" or "iso-2022-jp" or "50220" => "iso2022jp",
        "windows1252" or "windows-1252" or "cp1252" or "1252" => "windows1252",
        "gb18030" or "gb-18030" or "54936" => "gb18030",
        "big5" or "big-5" or "cp950" or "950" => "big5",
        "korean949" or "cp949" or "windows-949" or "uhc" or "ks-c-5601-1987" or "949" => "korean949",
        _ => throw new IOException("対応していない文字コードです。文字コードの一覧から選び直してください。")
    };

    // Every codec is strict and BOM-less. Preambles are managed separately so an
    // explicitly reopened BOM-less Unicode file does not acquire a BOM on save.
    public static Encoding StrictEncoding(string id) => CanonicalId(id) switch
    {
        "utf8" or "utf8bom" => new UTF8Encoding(false, true),
        "utf16le" => new UnicodeEncoding(false, false, true),
        "utf16be" => new UnicodeEncoding(true, false, true),
        "utf32le" => new UTF32Encoding(false, false, true),
        "utf32be" => new UTF32Encoding(true, false, true),
        "shiftjis" => CodePage(932), "eucjp" => CodePage(51932), "iso2022jp" => CodePage(50220),
        "windows1252" => CodePage(1252), "gb18030" => CodePage(54936), "big5" => CodePage(950),
        "korean949" => CodePage(949),
        _ => throw new IOException("対応していない文字コードです。")
    };

    private static Encoding CodePage(int codePage) => Encoding.GetEncoding(codePage, EncoderFallback.ExceptionFallback, DecoderFallback.ExceptionFallback);

    public static bool DefaultBom(string id) => CanonicalId(id) is "utf8bom" or "utf16le" or "utf16be" or "utf32le" or "utf32be";

    public static bool HasMatchingBom(byte[] bytes, string id)
    {
        id = CanonicalId(id);
        var (detected, length) = DetectBom(bytes);
        return length > 0 && SameUnicodeFamily(id, detected!);
    }

    public static byte[] Encode(string text, string id, bool? hasBom = null)
    {
        id = CanonicalId(id);
        var codec = StrictEncoding(id);
        var bytes = codec.GetBytes(text);
        if (!codec.GetString(bytes).Equals(text, StringComparison.Ordinal))
            throw new EncoderFallbackException("この文字コードでは文字をそのまま保存できません。UTF-8などへ変更してください。");
        var preamble = (hasBom ?? DefaultBom(id)) ? Preamble(id) : [];
        return preamble.Length == 0 ? bytes : [.. preamble, .. bytes];
    }

    public static DecodedText Decode(byte[] bytes, string? forceEncoding = null)
    {
        var (bomEncoding, bomLength) = DetectBom(bytes);
        if (forceEncoding is not null)
        {
            var selected = CanonicalId(forceEncoding);
            var matchingBom = bomLength > 0 && SameUnicodeFamily(selected, bomEncoding!);
            if (bomLength > 0 && !matchingBom)
                throw new DecoderFallbackException("ファイルのBOMと指定した文字コードが一致しません。BOMに対応する文字コードを選んでください。");
            var text = DecodeStrict(bytes, selected, matchingBom ? bomLength : 0);
            // For UTF-8, report the observed BOM rather than the dialog choice.
            if (selected is "utf8" or "utf8bom") selected = matchingBom ? "utf8bom" : "utf8";
            return new(text, selected, matchingBom, false, null);
        }
        if (bomEncoding is not null)
        {
            var text = DecodeStrict(bytes, bomEncoding, bomLength);
            RejectBinary(text);
            return new(text, bomEncoding, true, false, null);
        }
        if (TryBomlessUnicode(bytes, out var unicode)) return unicode!;
        // ISO-2022-JP uses only ASCII bytes; a strict UTF-8 decode also succeeds.
        // Recognize a real Japanese designation before committing to UTF-8.
        if (HasJapaneseDesignation(bytes))
        {
            try
            {
                var text = DecodeStrict(bytes, "iso2022jp", 0);
                RejectBinary(text);
                if (text.Any(IsJapanese)) return new(text, "iso2022jp", false, true, GuessNotice);
            }
            catch (DecoderFallbackException) { }
        }
        try
        {
            var text = DecodeStrict(bytes, "utf8", 0);
            RejectBinary(text);
            return new(text, "utf8", false, false, null);
        }
        catch (DecoderFallbackException) { }

        var candidates = new List<(string Id, string Text, double Score)>();
        foreach (var id in new[] { "shiftjis", "eucjp" })
        {
            try
            {
                var text = DecodeStrict(bytes, id, 0);
                if (!LooksBinary(text))
                {
                    var score = JapaneseScore(text);
                    if (score > 0) candidates.Add((id, text, score));
                }
            }
            catch (DecoderFallbackException) { }
        }
        var ordered = candidates.OrderByDescending(c => c.Score).ToArray();
        if (ordered.Length > 0 && (ordered.Length == 1 || ordered[0].Score - ordered[1].Score >= Math.Max(1, ordered[0].Score * .2)))
            return new(ordered[0].Text, ordered[0].Id, false, true, GuessNotice);

        // A single-byte fallback cannot prove which legacy encoding was intended.
        // It remains explicitly marked as a guess and can be reopened by the user.
        var fallback = DecodeStrict(bytes, "windows1252", 0);
        RejectBinary(fallback);
        return new(fallback, "windows1252", false, true, GuessNotice);
    }

    private static byte[] Preamble(string id) => id switch
    {
        "utf8" or "utf8bom" => [0xef, 0xbb, 0xbf],
        "utf16le" => [0xff, 0xfe], "utf16be" => [0xfe, 0xff],
        "utf32le" => [0xff, 0xfe, 0x00, 0x00], "utf32be" => [0x00, 0x00, 0xfe, 0xff],
        _ => []
    };

    private static (string? Encoding, int Length) DetectBom(byte[] bytes)
    {
        foreach (var id in new[] { "utf32le", "utf32be", "utf8bom", "utf16le", "utf16be" })
        {
            var preamble = Preamble(id);
            if (bytes.AsSpan().StartsWith(preamble)) return (id, preamble.Length);
        }
        return (null, 0);
    }

    private static bool SameUnicodeFamily(string a, string b) => a == b || a is "utf8" or "utf8bom" && b is "utf8" or "utf8bom";

    private static string DecodeStrict(byte[] bytes, string id, int offset)
    {
        if (id == "iso2022jp") ValidateIso2022Jp(bytes.AsSpan(offset));
        return StrictEncoding(id).GetString(bytes, offset, bytes.Length - offset);
    }

    private static bool TryBomlessUnicode(byte[] bytes, out DecodedText? result)
    {
        result = null;
        if (bytes.Length < 2 || bytes.AsSpan().IndexOf((byte)0) < 0) return false;
        foreach (var (id, width, highFirst) in new[] { ("utf32le", 4, false), ("utf32be", 4, true), ("utf16le", 2, false), ("utf16be", 2, true) })
        {
            if (bytes.Length % width != 0) continue;
            var units = bytes.Length / width;
            var matchingZero = 0; var oppositeZero = 0;
            for (var i = 0; i < bytes.Length; i += width)
            {
                if (width == 4)
                {
                    if (highFirst ? bytes[i] == 0 && bytes[i + 1] == 0 : bytes[i + 2] == 0 && bytes[i + 3] == 0) matchingZero++;
                    if (highFirst ? bytes[i + 2] == 0 && bytes[i + 3] == 0 : bytes[i] == 0 && bytes[i + 1] == 0) oppositeZero++;
                }
                else
                {
                    if (bytes[i + (highFirst ? 0 : 1)] == 0) matchingZero++;
                    if (bytes[i + (highFirst ? 1 : 0)] == 0) oppositeZero++;
                }
            }
            var threshold = width == 4 ? .75 : .25;
            if (matchingZero < units * threshold || matchingZero <= oppositeZero * 2) continue;
            try
            {
                var text = DecodeStrict(bytes, id, 0);
                if (LooksBinary(text) || !PositiveUnicodeText(text)) continue;
                result = new(text, id, false, true, GuessNotice);
                return true;
            }
            catch (DecoderFallbackException) { }
        }
        return false;
    }

    private static bool PositiveUnicodeText(string text)
    {
        if (text.Length == 0) return false;
        var positive = 0; var total = 0;
        foreach (var rune in text.EnumerateRunes())
        {
            total++;
            var category = Rune.GetUnicodeCategory(rune);
            if (Rune.IsLetterOrDigit(rune) || Rune.IsWhiteSpace(rune) ||
                category is UnicodeCategory.ConnectorPunctuation or UnicodeCategory.DashPunctuation or UnicodeCategory.OpenPunctuation or UnicodeCategory.ClosePunctuation or UnicodeCategory.InitialQuotePunctuation or UnicodeCategory.FinalQuotePunctuation or UnicodeCategory.OtherPunctuation or UnicodeCategory.MathSymbol or UnicodeCategory.CurrencySymbol or UnicodeCategory.OtherSymbol or UnicodeCategory.NonSpacingMark or UnicodeCategory.SpacingCombiningMark)
                positive++;
        }
        return positive >= total * .9;
    }

    private static double JapaneseScore(string text)
    {
        var kana = 0; var ideographs = 0; var halfwidth = 0; var privateUse = 0;
        foreach (var c in text.AsSpan(0, Math.Min(text.Length, 65536)))
        {
            if (c is >= '\u3040' and <= '\u30ff') kana++;
            else if (c is >= '\u3400' and <= '\u9fff') ideographs++;
            else if (c is >= '\uff61' and <= '\uff9f') halfwidth++;
            else if (c is >= '\ue000' and <= '\uf8ff') privateUse++;
        }
        if (kana == 0 && ideographs < 2 && halfwidth < 3) return 0;
        return Math.Max(0, kana * 4 + ideographs * 2 + halfwidth * .3 - privateUse * 5);
    }

    private static bool IsJapanese(char c) => c is >= '\u3040' and <= '\u30ff' or >= '\u3400' and <= '\u9fff' or >= '\uff61' and <= '\uff9f';

    private static bool LooksBinary(string text)
    {
        if (text.IndexOf('\0') >= 0) return true;
        var controls = 0;
        foreach (var c in text) if (char.IsControl(c) && c is not ('\t' or '\r' or '\n' or '\f')) controls++;
        return controls > 0 && controls > text.Length * .1;
    }

    private static void RejectBinary(string text)
    {
        if (LooksBinary(text)) throw new IOException("バイナリ形式の可能性があるため、通常のテキストとして開けません。必要な場合は文字コードを指定して開いてください。");
    }

    private static bool HasJapaneseDesignation(byte[] bytes)
    {
        for (var i = 0; i + 2 < bytes.Length; i++)
            if (bytes[i] == 0x1b && (bytes[i + 1] == '$' && bytes[i + 2] is (byte)'B' or (byte)'@' || bytes[i + 1] == '(' && bytes[i + 2] == 'I')) return true;
        return false;
    }

    private static void ValidateIso2022Jp(ReadOnlySpan<byte> bytes)
    {
        var mode = 0; // ASCII/Roman, JIS X 0208, halfwidth Kana.
        for (var i = 0; i < bytes.Length; i++)
        {
            var b = bytes[i];
            if (b >= 0x80) throw new DecoderFallbackException("ISO-2022-JPに正しくないバイトがあります。");
            if (b == 0x1b)
            {
                if (i + 2 >= bytes.Length) throw new DecoderFallbackException("ISO-2022-JPのエスケープシーケンスが途中で終わっています。");
                if (bytes[i + 1] == '$' && bytes[i + 2] is (byte)'B' or (byte)'@') mode = 1;
                else if (bytes[i + 1] == '(' && bytes[i + 2] is (byte)'B' or (byte)'J') mode = 0;
                else if (bytes[i + 1] == '(' && bytes[i + 2] == 'I') mode = 2;
                else throw new DecoderFallbackException("ISO-2022-JPのエスケープシーケンスが正しくありません。");
                i += 2;
                continue;
            }
            if (b is (byte)'\t' or (byte)'\r' or (byte)'\n' or (byte)'\f') continue;
            if (mode == 1)
            {
                if (b < 0x21 || b > 0x7e || ++i >= bytes.Length || bytes[i] < 0x21 || bytes[i] > 0x7e)
                    throw new DecoderFallbackException("ISO-2022-JPの文字が途中で終わっているか、正しくありません。");
            }
            else if (mode == 2 && (b < 0x21 || b > 0x5f)) throw new DecoderFallbackException("ISO-2022-JPの半角カナが正しくありません。");
        }
    }
}
