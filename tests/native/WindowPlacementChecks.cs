using System.Drawing;

namespace MdSplit;

internal static class WindowPlacementChecks
{
    public static void Run(string root, Action<bool,string> assert)
    {
        var path = Path.Combine(root, "geometry", "window-placement.json");
        var displays = new[] { new Rectangle(0, 0, 1920, 1040), new Rectangle(-1600, 0, 1600, 900) };
        var minimum = new Size(800, 560);
        assert(WindowPlacementStore.Load(path, displays, minimum) is null, "a missing window placement uses the default window size");
        var bounds = new Rectangle(-1500, 80, 1100, 720);
        WindowPlacementStore.Save(path, bounds, false);
        var saved = WindowPlacementStore.Load(path, displays, minimum);
        assert(saved is not null && saved.Bounds == bounds && !saved.Maximized, "normal window size and position survive closing and reopening, including a secondary monitor");
        WindowPlacementStore.Save(path, bounds, true);
        saved = WindowPlacementStore.Load(path, displays, minimum);
        assert(saved is not null && saved.Bounds == bounds && saved.Maximized, "maximized state retains the normal restore bounds");
        var unplugged = WindowPlacementStore.Load(path, new[] { displays[0] }, minimum);
        assert(unplugged is not null && displays[0].Contains(unplugged.Bounds) && unplugged.Bounds.Size == bounds.Size && unplugged.Maximized, "a disconnected monitor moves the window onto a visible screen");
        var resized = WindowPlacementStore.Normalize(new WindowPlacement { X=1700, Y=900, Width=1500, Height=900 }, new[] { displays[0] }, minimum);
        assert(resized is not null && displays[0].Contains(resized.Bounds), "partially offscreen geometry is brought into the monitor work area");
        assert(WindowPlacementStore.Normalize(new WindowPlacement { X=int.MaxValue, Y=0, Width=1000, Height=700 }, displays, minimum) is null, "unreasonable coordinates are rejected");
        assert(WindowPlacementStore.Normalize(new WindowPlacement { Width=2, Height=2 }, displays, minimum) is null, "unreasonable dimensions are rejected");
        File.WriteAllText(path, "{invalid");
        assert(WindowPlacementStore.Load(path, displays, minimum) is null, "corrupt saved geometry does not prevent startup");
    }
}
