using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
namespace MdSplit;
internal sealed record RecentEntry(string Id,string Path,DateTimeOffset OpenedAt)
{
    public string Name=>System.IO.Path.GetFileName(Path);
    public bool Exists=>File.Exists(Path);
}
internal sealed class RecentFiles(string file)
{
    private readonly object gate=new();
    private List<RecentEntry> Read(){try{return (JsonSerializer.Deserialize<List<RecentEntry>>(File.ReadAllText(file),Storage.Json)??[]).Where(e=>System.IO.Path.IsPathFullyQualified(e.Path)).Take(20).ToList();}catch{return [];}}
    public IReadOnlyList<RecentEntry> List(){lock(gate)return Read();}
    public void Touch(string path){lock(gate){path=System.IO.Path.GetFullPath(path);var entries=Read();entries.RemoveAll(e=>string.Equals(path,e.Path,StringComparison.OrdinalIgnoreCase));var id=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(path.ToUpperInvariant())))[..24];entries.Insert(0,new(id,path,DateTimeOffset.UtcNow));Write(entries.Take(20));}}
    private void Write(IEnumerable<RecentEntry> entries){Directory.CreateDirectory(System.IO.Path.GetDirectoryName(file)!);var temporary=file+".tmp";try{File.WriteAllText(temporary,JsonSerializer.Serialize(entries,Storage.Json));File.Move(temporary,file,true);}finally{if(File.Exists(temporary))File.Delete(temporary);}}
    public string Resolve(string id){lock(gate)return Read().FirstOrDefault(e=>e.Id==id)?.Path??throw new IOException("履歴が見つかりません。もう一度開いてください。");}
    public void Clear(){lock(gate)Write([]);}
}
