namespace MdSplit;

internal static class PaneWindowPolicy
{
    public static bool TryGetPane(string? url, out string pane)
    {
        // A pane is an app view, never an arbitrary URL with native privileges.
        if (url == UiContent.EntryUrl + "?pane=source") { pane = "source"; return true; }
        if (url == UiContent.EntryUrl + "?pane=preview") { pane = "preview"; return true; }
        pane = "";
        return false;
    }
}
