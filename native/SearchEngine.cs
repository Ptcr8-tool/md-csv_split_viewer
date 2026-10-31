using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
namespace MdSplit;
// One entry per window bounds memory and avoids retaining every searched file.
// Opaque tokens distinguish reopened documents, detached panes and revisions.
internal sealed class SearchTextCache
{
    private string? documentId, token, text;
    internal void Put(string id,string cacheToken,string value)
    {
        if(!Guid.TryParse(id,out _)||!Guid.TryParse(cacheToken,out _))throw new IOException("検索対象が正しくありません。");
        if(value.Length>64*1024*1024)throw new IOException("検索対象または式が大きすぎます。");
        documentId=id;token=cacheToken;text=value;
    }
    internal string? Get(string id,string cacheToken) => documentId==id&&token==cacheToken?text:null;
    internal void Remove(string? id) { if(documentId==id){documentId=null;token=null;text=null;} }
}
internal sealed class SearchRequest
{
    public string Text{get;set;}="";
    public string Pattern{get;set;}="";
    public string Replacement{get;set;}="";
    public bool Regex{get;set;}
    public bool IgnoreCase{get;set;}
    public string Action{get;set;}="find";
    public int Direction{get;set;}=1;
    public int From{get;set;}
    public int To{get;set;}
}
internal static class SearchEngine
{
    private const int Max=64*1024*1024;
    public static object Run(SearchRequest request)
    {
        if(request.Text.Length>Max||request.Pattern.Length>4096||request.Replacement.Length>65536)throw new IOException("検索対象または式が大きすぎます。");
        if(request.Pattern.Length==0)return new{count=0};
        var options=RegexOptions.Multiline|RegexOptions.CultureInvariant;if(request.IgnoreCase)options|=RegexOptions.IgnoreCase;
        try
        {
            var expression=new Regex(request.Regex?request.Pattern:Regex.Escape(request.Pattern),options,TimeSpan.FromMilliseconds(250));
            var watch=Stopwatch.StartNew();var matches=new List<Match>();
            foreach(Match m in expression.Matches(request.Text)){matches.Add(m);if(matches.Count>100000)throw new IOException("一致が10万件を超えました。検索条件を絞ってください。");if(watch.ElapsedMilliseconds>2000)throw new IOException("検索に時間がかかりすぎました。式を簡単にしてください。");}
            if(matches.Count==0)return new{count=0};
            var chosen=request.Action=="replace"?matches.FirstOrDefault(m=>m.Index==request.From&&m.Index+m.Length==request.To):request.Direction<0?matches.LastOrDefault(m=>m.Index<request.From)??matches[^1]:matches.FirstOrDefault(m=>m.Index>=request.From)??matches[0];
            if(request.Action=="find"||chosen is null){chosen??=matches.FirstOrDefault(m=>m.Index>=request.From)??matches[0];return new{count=matches.Count,from=chosen.Index,to=chosen.Index+chosen.Length};}
            if(request.Action is not ("replace" or "all"))throw new IOException("検索操作が正しくありません。");
            var template=request.Regex?Escapes(request.Replacement):request.Replacement;
            var output=new StringBuilder();var at=0;var start=0;var end=0;IEnumerable<Match> selected=request.Action=="all"?matches:new[]{chosen};var count=0;
            foreach(var m in selected){var value=request.Regex?Expand(template,m):template;if((long)output.Length+m.Index-at+value.Length>Max)throw new IOException("置換後の文章が64MBを超えます。");output.Append(request.Text.AsSpan(at,m.Index-at));start=output.Length;output.Append(value);end=output.Length;at=m.Index+m.Length;count++;}
            if((long)output.Length+request.Text.Length-at>Max)throw new IOException("置換後の文章が64MBを超えます。");output.Append(request.Text.AsSpan(at));return new{count,text=output.ToString(),from=start,to=end};
        }
        catch(RegexMatchTimeoutException){throw new IOException("検索に時間がかかりすぎました。正規表現を簡単にしてください。");}
        catch(ArgumentException){throw new IOException("正規表現の書き方を確認してください。");}
    }
    private static string Escapes(string value)=>Regex.Replace(value,@"\\(r|n|t|\\|[1-9][0-9]?)",m=>m.Groups[1].Value switch{"r"=>"\r","n"=>"\n","t"=>"\t","\\"=>"\\",var n=>"$"+n});
    // Expand captured values directly, with a bound before each append. Do not run
    // the expression again on a fragment: lookbehind depends on its original context.
    private static string Expand(string template,Match match)
    {
        var result=new StringBuilder();var at=0;
        foreach(Match token in Regex.Matches(template,@"\$(\$|&|[0-9]{1,2}|\{[\w]+\})"))
        {
            var key=token.Groups[1].Value;string value;
            if(key=="$")value="$";else if(key=="&")value=match.Value;else if(key.StartsWith('{'))value=match.Groups[key[1..^1]].Value;else{var number=int.Parse(key);value=number<match.Groups.Count?match.Groups[number].Value:token.Value;}
            if((long)result.Length+token.Index-at+value.Length>Max)throw new IOException("置換後の文章が64MBを超えます。");result.Append(template.AsSpan(at,token.Index-at));result.Append(value);at=token.Index+token.Length;
        }
        if((long)result.Length+template.Length-at>Max)throw new IOException("置換後の文章が64MBを超えます。");result.Append(template.AsSpan(at));return result.ToString();
    }
}
