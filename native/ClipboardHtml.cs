using System.Text;
namespace MdSplit;
internal static class ClipboardHtml
{
    public static string Build(string html)
    {
        const string before = "<html><body><!--StartFragment-->";
        const string after = "<!--EndFragment--></body></html>";
        const string template = "Version:1.0\r\nStartHTML:{0:0000000000}\r\nEndHTML:{1:0000000000}\r\nStartFragment:{2:0000000000}\r\nEndFragment:{3:0000000000}\r\n";
        var headerLength=Encoding.UTF8.GetByteCount(string.Format(template,0,0,0,0));
        var start=headerLength+Encoding.UTF8.GetByteCount(before);
        var end=start+Encoding.UTF8.GetByteCount(html);
        return string.Format(template,headerLength,end+Encoding.UTF8.GetByteCount(after),start,end)+before+html+after;
    }
}
