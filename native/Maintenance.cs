using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Win32;
namespace MdSplit;
internal static class Maintenance
{
    private sealed class Receipt{public string Version{get;set;}="";public string Name{get;set;}="";public string Sha256{get;set;}="";public long Size{get;set;}}
    public static string ValidateTarget(string value)
    {
        if(string.IsNullOrWhiteSpace(value)||value.Any(char.IsControl)||!Path.IsPathFullyQualified(value))throw new IOException("インストール先が正しくありません。");var path=Path.TrimEndingDirectorySeparator(Path.GetFullPath(value));
        if(path.StartsWith(@"\\")||path==Path.GetPathRoot(path))throw new IOException("専用のローカルフォルダーを選んでください。");
        foreach(var special in new[]{Environment.SpecialFolder.UserProfile,Environment.SpecialFolder.LocalApplicationData,Environment.SpecialFolder.ProgramFiles,Environment.SpecialFolder.ProgramFilesX86}){var folder=Environment.GetFolderPath(special);if(folder.Length>0&&path.Equals(Path.TrimEndingDirectorySeparator(folder),StringComparison.OrdinalIgnoreCase))throw new IOException("専用のフォルダーを選んでください。");}
        foreach(var special in new[]{Environment.SpecialFolder.Windows,Environment.SpecialFolder.System}){var folder=Environment.GetFolderPath(special);if(folder.Length>0&&(path.Equals(folder,StringComparison.OrdinalIgnoreCase)||path.StartsWith(folder+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)))throw new IOException("Windowsのシステムフォルダーは指定できません。");}
        for(var parent=new DirectoryInfo(path);parent is not null;parent=parent.Parent)if(parent.Exists&&(parent.Attributes&FileAttributes.ReparsePoint)!=0)throw new IOException("リンクされたフォルダーはインストール先に指定できません。");return path;
    }
    public static void RecordInstaller(string path)
    {
        var root=ValidateTarget(AppContext.BaseDirectory);var name=BuildIdentity.SetupName(BuildIdentity.Version);path=Path.GetFullPath(path);if(!path.Equals(Path.Combine(root,"Cache",name),StringComparison.OrdinalIgnoreCase)||!File.Exists(path))throw new IOException("修復用ファイルの保存先が正しくありません。");
        using var stream=File.OpenRead(path);var receipt=new Receipt{Version=BuildIdentity.Version,Name=name,Size=stream.Length,Sha256=Convert.ToHexString(SHA256.HashData(stream))};File.WriteAllText(Path.Combine(root,"Cache","receipt.json"),JsonSerializer.Serialize(receipt,Storage.Json));
    }
    public static void Repair()
    {
        var root=ValidateTarget(AppContext.BaseDirectory);var receipt=JsonSerializer.Deserialize<Receipt>(File.ReadAllText(Path.Combine(root,"Cache","receipt.json")),Storage.Json)??throw new IOException("修復用ファイルがありません。同じ版のセットアップを使用してください。");
        if(receipt.Version!=BuildIdentity.Version||receipt.Name!=BuildIdentity.SetupName(BuildIdentity.Version))throw new IOException("修復用ファイルがこの版と一致しません。");var path=Path.Combine(root,"Cache",receipt.Name);using(var stream=File.OpenRead(path))if(stream.Length!=receipt.Size||!Convert.ToHexString(SHA256.HashData(stream)).Equals(receipt.Sha256,StringComparison.OrdinalIgnoreCase))throw new IOException("修復用ファイルが壊れています。同じ版のセットアップを使用してください。");StartSetup(path,false);
    }
    public static void StartSetup(string path,bool silent)
    {
        var root=ValidateTarget(AppContext.BaseDirectory);var info=new ProcessStartInfo(Path.GetFullPath(path)){UseShellExecute=false,Arguments=(silent?"/S /UPDATE ":"/REPAIR ")+"/D="+root};_ = Process.Start(info)??throw new IOException("セットアップを開始できません。");
    }
    public static void Unregister()
    {
        var exe=Path.Combine(AppContext.BaseDirectory,"MD-Split.exe");string? command;using(var key=Registry.CurrentUser.OpenSubKey(@"Software\Classes\MD.Split.Markdown\shell\open\command"))command=key?.GetValue(null) as string;
        if(command is null||!command.StartsWith('"'+exe+'"',StringComparison.OrdinalIgnoreCase))return;
        Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\MD.Split.Markdown",false);
        // Include previously registered types as well as today's supported set,
        // so a future release can remove an extension without leaving this app
        // in that extension's Open With list after uninstall. Do not touch the
        // extension's default or another app's registration.
        var extensions = new HashSet<string>(TextFileTypes.SupportedExtensions, StringComparer.OrdinalIgnoreCase);
        using(var associations=Registry.CurrentUser.OpenSubKey(@"Software\MD Split\Capabilities\FileAssociations"))
            if(associations is not null)foreach(var ext in associations.GetValueNames())
                if(ext.Length>1 && ext[0]=='.' && ext.Skip(1).All(char.IsAsciiLetterOrDigit) && string.Equals(associations.GetValue(ext) as string,Storage.AssociationProgId,StringComparison.OrdinalIgnoreCase))extensions.Add(ext);
        foreach(var ext in extensions){using var key=Registry.CurrentUser.OpenSubKey(@"Software\Classes\"+ext+@"\OpenWithProgids",true);key?.DeleteValue(Storage.AssociationProgId,false);}
        Registry.CurrentUser.DeleteSubKeyTree(@"Software\MD Split\Capabilities",false);using var registered=Registry.CurrentUser.OpenSubKey(@"Software\RegisteredApplications",true);registered?.DeleteValue(Storage.RegisteredApplicationName,false);Storage.NotifyAssociationsChanged();
    }
}
