namespace MdSplit;
internal static class SafeLinks
{
    public static bool IsBrowserUrl(string? value)=>value is {Length:>0 and <=8192}&&!value.Any(c=>char.IsWhiteSpace(c)||char.IsControl(c))&&Uri.TryCreate(value,UriKind.Absolute,out var uri)&&(uri.Scheme is "http" or "https")&&string.IsNullOrEmpty(uri.UserInfo);
}
