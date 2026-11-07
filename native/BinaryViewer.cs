using System.Globalization;

namespace MdSplit;

// Each page is read on demand. The original is never opened for writing or
// passed to the editable document, saving, session, or recovery workflows.
internal sealed class BinaryViewer : Form
{
    private readonly string path;
    private readonly Label status = new() { Name = "BinaryStatus", AutoSize = true, Dock = DockStyle.Fill, Padding = new Padding(12, 8, 12, 8), Text = "ファイルを読み込んでいます…" };
    private readonly TextBox output = new() { Name = "BinaryContent", Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, WordWrap = false, ScrollBars = ScrollBars.Both, Font = new Font("Consolas", 10), ShortcutsEnabled = true, MaxLength = int.MaxValue, AccessibleName = "バイナリ内容" };
    private readonly Button first = new() { Name = "BinaryFirst", Text = "先頭", AutoSize = true };
    private readonly Button previous = new() { Name = "BinaryPrevious", Text = "前へ", AutoSize = true };
    private readonly Button next = new() { Name = "BinaryNext", Text = "次へ", AutoSize = true };
    private readonly Button last = new() { Name = "BinaryLast", Text = "末尾", AutoSize = true };
    private readonly NumericUpDown pageNumber = new() { Name = "BinaryPage", Minimum = 1, Maximum = 1, Value = 1, Width = 110, ThousandsSeparator = true, AccessibleName = "ページ番号" };
    private readonly Label totalPages = new() { AutoSize = true, Padding = new Padding(0, 7, 0, 0) };
    private readonly Button goToPage = new() { Name = "BinaryGoPage", Text = "ページへ移動", AutoSize = true };
    private readonly TextBox offsetInput = new() { Name = "BinaryOffset", Width = 140, AccessibleName = "移動するバイト位置", PlaceholderText = "10進数または0x16進数" };
    private readonly Button goToOffset = new() { Name = "BinaryGoOffset", Text = "位置へ移動", AutoSize = true };
    private long currentPage;
    private long pages = 1;
    private bool loading;

    internal BinaryViewer(string path)
    {
        this.path = path;
        Text = Path.GetFileName(path) + " — バイナリ表示（読み取り専用）";
        Width = 1050; Height = 680; MinimumSize = new Size(650, 350); StartPosition = FormStartPosition.CenterParent;

        var navigation = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, WrapContents = true, Padding = new Padding(8, 0, 8, 4) };
        navigation.Controls.AddRange([first, previous, next, last, pageNumber, totalPages, goToPage, offsetInput, goToOffset]);
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 3 };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.Controls.Add(status, 0, 0);
        layout.Controls.Add(navigation, 0, 1);
        layout.Controls.Add(output, 0, 2);
        Controls.Add(layout);

        first.Click += async (_, _) => await LoadPageAsync(0);
        previous.Click += async (_, _) => await LoadPageAsync(Math.Max(0, currentPage - 1));
        next.Click += async (_, _) => await LoadPageAsync(Math.Min(pages - 1, currentPage + 1));
        last.Click += async (_, _) => await LoadPageAsync(pages - 1);
        goToPage.Click += async (_, _) => await LoadPageAsync(decimal.ToInt64(pageNumber.Value) - 1);
        goToOffset.Click += async (_, _) => await MoveToOffsetAsync();
        pageNumber.KeyDown += async (_, e) =>
        {
            if (e.KeyCode != Keys.Enter) return;
            e.SuppressKeyPress = true;
            await LoadPageAsync(decimal.ToInt64(pageNumber.Value) - 1);
        };
        offsetInput.KeyDown += async (_, e) =>
        {
            if (e.KeyCode != Keys.Enter) return;
            e.SuppressKeyPress = true;
            await MoveToOffsetAsync();
        };
        SetNavigationEnabled(false);
        Shown += async (_, _) => await LoadPageAsync(0);
    }

    private async Task MoveToOffsetAsync()
    {
        var raw = offsetInput.Text.Trim();
        var hex = raw.StartsWith("0x", StringComparison.OrdinalIgnoreCase);
        var digits = hex ? raw[2..] : raw;
        if (!long.TryParse(digits, hex ? NumberStyles.AllowHexSpecifier : NumberStyles.None, CultureInfo.InvariantCulture, out var offset) || offset < 0)
        {
            status.Text = "バイト位置には 0 以上の整数、または 0x で始まる16進数を入力してください。";
            return;
        }
        await LoadPageAsync(offset / BinaryPreview.PageBytes, offset);
    }

    private void SetNavigationEnabled(bool enabled)
    {
        first.Enabled = enabled && currentPage > 0;
        previous.Enabled = enabled && currentPage > 0;
        next.Enabled = enabled && currentPage + 1 < pages;
        last.Enabled = enabled && currentPage + 1 < pages;
        pageNumber.Enabled = enabled;
        goToPage.Enabled = enabled;
        offsetInput.Enabled = enabled;
        goToOffset.Enabled = enabled;
    }

    private async Task LoadPageAsync(long requestedPage, long? requestedOffset = null)
    {
        if (loading || IsDisposed) return;
        loading = true;
        SetNavigationEnabled(false);
        status.Text = "ファイルを読み込んでいます…";
        try
        {
            var (page, text) = await Task.Run(() =>
            {
                var result = BinaryPreview.ReadPage(path, requestedPage);
                return (result, BinaryPreview.Format(result.Bytes, result.Offset));
            });
            if (IsDisposed) return;
            currentPage = page.Page;
            pages = page.Pages;
            pageNumber.Maximum = pages;
            pageNumber.Value = currentPage + 1;
            totalPages.Text = $"/ {pages:N0}";
            output.Text = text;
            // A byte-position jump scrolls to its line within the requested
            // page; merely loading the containing page can leave it offscreen.
            var targetLine = requestedOffset.HasValue && page.Bytes.Length > 0
                ? (int)((Math.Clamp(requestedOffset.Value, page.Offset, page.Offset + page.Bytes.Length - 1) - page.Offset) / 16)
                : 0;
            var firstCharacter = output.GetFirstCharIndexFromLine(targetLine);
            output.SelectionStart = Math.Max(0, firstCharacter);
            output.ScrollToCaret();
            var range = page.Bytes.Length == 0 ? "空のファイル" : $"表示位置 {page.Offset:N0}〜{page.Offset + page.Bytes.Length - 1:N0} バイト";
            status.Text = $"読み取り専用・全 {page.Length:N0} バイト　{range}　ページ移動でファイル全体を表示できます。";
        }
        catch (Exception ex)
        {
            if (!IsDisposed) status.Text = "ファイルを読み込めませんでした: " + ex.Message;
        }
        finally
        {
            loading = false;
            if (!IsDisposed) SetNavigationEnabled(true);
        }
    }
}
