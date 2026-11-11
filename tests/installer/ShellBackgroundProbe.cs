using System;
using System.Runtime.InteropServices;
using System.Text;

public static class ShellBackgroundProbe
{
    [ComImport, Guid("000214E6-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellFolder
    {
        [PreserveSig] int ParseDisplayName(IntPtr hwnd, IntPtr bind, IntPtr name, IntPtr eaten, out IntPtr pidl, IntPtr attributes);
        [PreserveSig] int EnumObjects(IntPtr hwnd, uint flags, out IntPtr enumerator);
        [PreserveSig] int BindToObject(IntPtr pidl, IntPtr bind, ref Guid iid, out IntPtr obj);
        [PreserveSig] int BindToStorage(IntPtr pidl, IntPtr bind, ref Guid iid, out IntPtr obj);
        [PreserveSig] int CompareIDs(IntPtr param, IntPtr first, IntPtr second);
        [PreserveSig] int CreateViewObject(IntPtr hwnd, ref Guid iid, out IntPtr obj);
    }

    [ComImport, Guid("000214E4-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IContextMenu
    {
        [PreserveSig] int QueryContextMenu(IntPtr menu, uint indexMenu, uint idFirst, uint idLast, uint flags);
        [PreserveSig] int InvokeCommand(IntPtr invocation);
        [PreserveSig] int GetCommandString(UIntPtr idCmd, uint flags, IntPtr reserved, StringBuilder name, uint length);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SHParseDisplayName(string name, IntPtr binding, out IntPtr pidl, uint attributes, out uint actual);
    [DllImport("shell32.dll")]
    static extern int SHBindToObject(IntPtr folder, IntPtr pidl, IntPtr binding, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IShellFolder result);
    [DllImport("user32.dll")] static extern IntPtr CreatePopupMenu();
    [DllImport("user32.dll")] static extern bool DestroyMenu(IntPtr menu);
    [DllImport("user32.dll")] static extern int GetMenuItemCount(IntPtr menu);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetMenuString(IntPtr menu, uint item, StringBuilder text, int max, uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetSubMenu(IntPtr menu, int position);
    [DllImport("user32.dll")] static extern uint GetMenuItemID(IntPtr menu, int position);
    [DllImport("ole32.dll")] static extern void CoTaskMemFree(IntPtr memory);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct InvokeInfo
    {
        public int cbSize;
        public uint fMask;
        public IntPtr hwnd, lpVerb, lpParameters, lpDirectory;
        public int nShow;
        public uint dwHotKey;
        public IntPtr hIcon;
        public IntPtr lpTitle, lpVerbW, lpParametersW, lpDirectoryW, lpTitleW;
        public int ptX, ptY;
    }

    static void MenuLines(IntPtr menu, StringBuilder result)
    {
        int count = GetMenuItemCount(menu);
        for(int i=0;i<count;i++) {
            var text = new StringBuilder(1024);
            GetMenuString(menu,(uint)i,text,text.Capacity,0x400);
            if(text.Length>0) result.AppendLine(text.ToString());
            IntPtr sub = GetSubMenu(menu,i); if(sub!=IntPtr.Zero) MenuLines(sub,result);
        }
    }
    static uint FindTitle(IntPtr menu,string wanted)
    {
        int count=GetMenuItemCount(menu);
        for(int i=0;i<count;i++) {
            var text=new StringBuilder(1024); GetMenuString(menu,(uint)i,text,text.Capacity,0x400);
            if(string.Equals(text.ToString().Replace("&", ""),wanted.Replace("&", ""),StringComparison.Ordinal)) return GetMenuItemID(menu,i);
            IntPtr sub=GetSubMenu(menu,i); if(sub!=IntPtr.Zero){uint found=FindTitle(sub,wanted);if(found!=uint.MaxValue)return found;}
        }
        return uint.MaxValue;
    }
    public static string GetTitles(string directory) { return UseMenu(directory, null); }
    public static void InvokeTitle(string directory,string title) { UseMenu(directory, title); }
    static string UseMenu(string directory,string title)
    {
        IntPtr pidl = IntPtr.Zero, native = IntPtr.Zero, menu = IntPtr.Zero; IShellFolder folder = null; IContextMenu context = null;
        try {
            uint attrs; Marshal.ThrowExceptionForHR(SHParseDisplayName(directory,IntPtr.Zero,out pidl,0,out attrs));
            Guid folderId = typeof(IShellFolder).GUID; Marshal.ThrowExceptionForHR(SHBindToObject(IntPtr.Zero,pidl,IntPtr.Zero,ref folderId,out folder));
            Guid contextId = typeof(IContextMenu).GUID; Marshal.ThrowExceptionForHR(folder.CreateViewObject(IntPtr.Zero,ref contextId,out native));
            context = (IContextMenu)Marshal.GetObjectForIUnknown(native);
            menu=CreatePopupMenu(); if(menu==IntPtr.Zero) throw new InvalidOperationException("Cannot create menu");
            Marshal.ThrowExceptionForHR(context.QueryContextMenu(menu,0,1,0x7fff,0));
            var result=new StringBuilder(); MenuLines(menu,result);
            if(title!=null){
                uint id=FindTitle(menu,title); if(id==uint.MaxValue||id==0)throw new InvalidOperationException("Requested background command is absent. Menu: "+result);
                IntPtr dir=Marshal.StringToHGlobalUni(directory), invocation=IntPtr.Zero;
                try{
                    var info=new InvokeInfo { cbSize=Marshal.SizeOf(typeof(InvokeInfo)), fMask=0x00004000, lpVerb=new IntPtr((long)id-1), lpVerbW=new IntPtr((long)id-1), lpDirectoryW=dir, nShow=1 };
                    invocation=Marshal.AllocHGlobal(info.cbSize); Marshal.StructureToPtr(info,invocation,false);
                    Marshal.ThrowExceptionForHR(context.InvokeCommand(invocation));
                } finally {if(invocation!=IntPtr.Zero)Marshal.FreeHGlobal(invocation);Marshal.FreeHGlobal(dir);}
            }
            return result.ToString();
        } finally {
            if(menu!=IntPtr.Zero)DestroyMenu(menu); if(context!=null)Marshal.ReleaseComObject(context); if(native!=IntPtr.Zero)Marshal.Release(native); if(folder!=null)Marshal.ReleaseComObject(folder); if(pidl!=IntPtr.Zero)CoTaskMemFree(pidl);
        }
    }
}
