using System.Drawing;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace MdSplit;

// Window geometry is independent of document-session and display settings.
internal sealed class WindowPlacement
{
    public int X { get; set; }
    public int Y { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public bool Maximized { get; set; }
    [JsonIgnore] public Rectangle Bounds => new(X, Y, Width, Height);
}

internal static class WindowPlacementStore
{
    public static string DefaultPath => Path.Combine(Storage.Root, "window-placement.json");

    public static WindowPlacement? Load(string path, IReadOnlyList<Rectangle> screens, Size minimum)
    {
        try
        {
            if (!File.Exists(path) || new FileInfo(path).Length > 16384) return null;
            var saved = JsonSerializer.Deserialize<WindowPlacement>(File.ReadAllText(path), Storage.Json);
            return Normalize(saved, screens, minimum);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException or NotSupportedException)
        { return null; }
    }

    internal static WindowPlacement? Normalize(WindowPlacement? value, IReadOnlyList<Rectangle> screens, Size minimum)
    {
        if (value is null || value.Width < 100 || value.Height < 100 || value.Width > 100000 || value.Height > 100000 || Math.Abs((long)value.X) > 1000000 || Math.Abs((long)value.Y) > 1000000) return null;
        var available = screens.Where(s => s.Width > 0 && s.Height > 0).ToArray();
        if (available.Length == 0) return null;
        // Prefer the screen containing the largest part of the saved window.
        var best = available[0]; long overlap = 0;
        foreach (var screen in available)
        {
            var intersection = Rectangle.Intersect(value.Bounds, screen);
            var area = intersection.Width > 0 && intersection.Height > 0 ? (long)intersection.Width * intersection.Height : 0;
            if (area > overlap) { overlap = area; best = screen; }
        }
        var width = Math.Max(minimum.Width, Math.Min(value.Width, best.Width));
        var height = Math.Max(minimum.Height, Math.Min(value.Height, best.Height));
        // If a monitor disappeared, center the window on the primary screen.
        // Otherwise retain its saved position, keeping its title bar accessible.
        var x = overlap == 0 ? best.Left + Math.Max(0, (best.Width - width) / 2) : Math.Clamp(value.X, best.Left, Math.Max(best.Left, best.Right - width));
        var y = overlap == 0 ? best.Top + Math.Max(0, (best.Height - height) / 2) : Math.Clamp(value.Y, best.Top, Math.Max(best.Top, best.Bottom - height));
        return new WindowPlacement { X = x, Y = y, Width = width, Height = height, Maximized = value.Maximized };
    }

    public static void Save(string path, Rectangle bounds, bool maximized)
    {
        var data = new WindowPlacement { X = bounds.X, Y = bounds.Y, Width = bounds.Width, Height = bounds.Height, Maximized = maximized };
        if (data.Width < 100 || data.Height < 100 || data.Width > 100000 || data.Height > 100000) return;
        // Do not block on an async operation that captured the WinForms context.
        Task.Run(() => Storage.AtomicText(path, JsonSerializer.Serialize(data, Storage.Json))).GetAwaiter().GetResult();
    }
}
