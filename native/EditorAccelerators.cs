namespace MdSplit;

internal static class EditorAccelerators
{
    public static string? CommandFor(int virtualKey, bool control, bool alt, bool shift)
    {
        if (!control || alt) return null; // Ctrl+Alt may be AltGr text input.
        return virtualKey switch { 0x53 => shift ? "saveas" : "save", 0x46 => "search", 0x48 => "replace", _ => null };
    }
}
