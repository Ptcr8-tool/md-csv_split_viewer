using System.Text.Json;
using MdSplit;

internal static class SearchConformanceChecks
{
    public static void Run(Action<bool, string> assert)
    {
        using var vectors = JsonDocument.Parse(File.ReadAllText(SharedFixturePath()));
        foreach (var vector in vectors.RootElement.EnumerateArray())
        {
            var request = vector.GetProperty("request").Deserialize<SearchRequest>(Storage.Json)!;
            var actual = JsonSerializer.SerializeToElement(SearchEngine.Run(request), Storage.Json);
            var expected = vector.GetProperty("expected");
            var matched = expected.EnumerateObject().All(item =>
                actual.TryGetProperty(item.Name, out var value) && JsonElement.DeepEquals(value, item.Value)) &&
                actual.EnumerateObject().Count() == expected.EnumerateObject().Count();
            assert(matched, "shared browser/native search: " + vector.GetProperty("name").GetString());
        }
    }

    private static string SharedFixturePath()
    {
        foreach (var start in new[] { Environment.CurrentDirectory, AppContext.BaseDirectory })
            for (var dir = new DirectoryInfo(start); dir is not null; dir = dir.Parent)
            {
                var path = Path.Combine(dir.FullName, "tests", "fixtures", "search-shared.json");
                if (File.Exists(path)) return path;
            }
        throw new FileNotFoundException("The shared search fixtures were not found.");
    }
}
