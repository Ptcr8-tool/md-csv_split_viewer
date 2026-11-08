using System.Diagnostics;
using System.Globalization;
using System.Text;

namespace MdSplit;

// A normal scrolling view over the whole file. Only the visible lines are held
// in the text box, while searches stream through the original read-only file.
internal sealed class BinaryViewer : Form
{
    private const int ScrollScale = 1_000_000;
    private readonly string path;
    private readonly Label status = new() { Name = "BinaryStatus", AutoSize = true, Dock = DockStyle.Fill, Padding = new Padding(12, 8, 12, 8), Text = "ファイルを読み込んでいます…" };
    private readonly HexTextBox output = new() { Name = "BinaryContent", Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, WordWrap = false, ScrollBars = ScrollBars.Horizontal, Font = new Font("Consolas", 10), ShortcutsEnabled = true, MaxLength = int.MaxValue, AccessibleName = "バイナリ内容" };
    private readonly VScrollBar scroll = new() { Name = "BinaryScroll", Dock = DockStyle.Fill, Minimum = 0, Maximum = ScrollScale, LargeChange = 1, SmallChange = 1, Enabled = false, AccessibleName = "ファイル全体をスクロール" };
    private readonly ComboBox searchMode = new() { Name = "BinarySearchMode", DropDownStyle = ComboBoxStyle.DropDownList, Width = 155, AccessibleName = "検索方法" };
    private readonly TextBox searchText = new() { Name = "BinarySearchText", Width = 230, MaxLength = 4096, AccessibleName = "検索する文字列" };
    private readonly Button searchNext = new() { Name = "BinarySearchNext", Text = "次を検索", AutoSize = true, Enabled = false };
    private readonly Button searchPrevious = new() { Name = "BinarySearchPrevious", Text = "前を検索", AutoSize = true, Enabled = false };
    private readonly Button searchCancel = new() { Name = "BinarySearchCancel", Text = "検索を中止", AutoSize = true, Enabled = false };
    private readonly Button first = new() { Name = "BinaryFirst", Text = "先頭", AutoSize = true, Enabled = false };
    private readonly Button last = new() { Name = "BinaryLast", Text = "末尾", AutoSize = true, Enabled = false };
    private readonly TextBox offsetInput = new() { Name = "BinaryOffset", Width = 150, AccessibleName = "移動するバイト位置", PlaceholderText = "10進数または0x16進数" };
    private readonly Button goToOffset = new() { Name = "BinaryGoOffset", Text = "位置へ移動", AutoSize = true, Enabled = false };
    private long length;
    private long requestedLine;
    private long? highlightOffset;
    private int highlightLength;
    private long viewRequest;
    private bool viewLoading;
    private bool loaded;
    private CancellationTokenSource? searchCancellation;
    private string? lastSearchKey;
    private long lastMatch = -1;

    internal BinaryViewer(string path)
    {
        this.path = path;
        Text = Path.GetFileName(path) + " — バイナリ表示（読み取り専用）";
        Width = 1120; Height = 700; MinimumSize = new Size(650, 380); StartPosition = FormStartPosition.CenterParent;
        KeyPreview = true;

        searchMode.Items.AddRange(["文字列（UTF-8）", "文字列（UTF-16 LE）", "文字列（Shift_JIS）", "16進数"]);
        searchMode.SelectedIndex = 0;
        var searchBar = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, WrapContents = true, Padding = new Padding(8, 0, 8, 0) };
        searchBar.Controls.AddRange([new Label { Text = "全体を検索", AutoSize = true, Padding = new Padding(0, 7, 0, 0) }, searchMode, searchText, searchPrevious, searchNext, searchCancel]);
        var navigation = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, WrapContents = true, Padding = new Padding(8, 0, 8, 4) };
        navigation.Controls.AddRange([first, last, new Label { Text = "バイト位置", AutoSize = true, Padding = new Padding(8, 7, 0, 0) }, offsetInput, goToOffset]);

        var content = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1, Margin = Padding.Empty };
        content.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        content.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, SystemInformation.VerticalScrollBarWidth));
        content.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        content.Controls.Add(output, 0, 0);
        content.Controls.Add(scroll, 1, 0);

        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 4 };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.Controls.Add(status, 0, 0);
        layout.Controls.Add(searchBar, 0, 1);
        layout.Controls.Add(navigation, 0, 2);
        layout.Controls.Add(content, 0, 3);
        Controls.Add(layout);

        first.Click += (_, _) => RequestView(0);
        last.Click += (_, _) => RequestView(BinaryPreview.LastTopLine(length, VisibleLines()));
        goToOffset.Click += (_, _) => MoveToOffset();
        offsetInput.KeyDown += (_, e) =>
        {
            if (e.KeyCode != Keys.Enter) return;
            e.SuppressKeyPress = true;
            MoveToOffset();
        };
        output.WheelScrolled += delta => MoveLines(-Math.Sign(delta) * Math.Max(1, SystemInformation.MouseWheelScrollLines));
        scroll.Scroll += (_, e) =>
        {
            if (!loaded || e.Type == ScrollEventType.EndScroll) return;
            var lastLine = BinaryPreview.LastTopLine(length, VisibleLines());
            var target = e.Type switch
            {
                ScrollEventType.SmallDecrement => requestedLine - 1,
                ScrollEventType.SmallIncrement => requestedLine + 1,
                ScrollEventType.LargeDecrement => requestedLine - VisibleLines(),
                ScrollEventType.LargeIncrement => requestedLine + VisibleLines(),
                ScrollEventType.First => 0,
                ScrollEventType.Last => lastLine,
                _ => BinaryPreview.ScrollLine(e.NewValue, lastLine, ScrollScale)
            };
            RequestView(target);
            e.NewValue = BinaryPreview.ScrollValue(requestedLine, lastLine, ScrollScale);
        };
        searchNext.Click += async (_, _) => await SearchAsync(false);
        searchPrevious.Click += async (_, _) => await SearchAsync(true);
        searchCancel.Click += (_, _) => searchCancellation?.Cancel();
        searchText.KeyDown += async (_, e) =>
        {
            if (e.KeyCode != Keys.Enter) return;
            e.SuppressKeyPress = true;
            if (searchCancellation is null) await SearchAsync(e.Shift);
        };
        KeyDown += (_, e) =>
        {
            if (e.Control && e.KeyCode == Keys.F) { e.SuppressKeyPress = true; searchText.Focus(); searchText.SelectAll(); return; }
            if (e.KeyCode == Keys.Escape && searchCancellation is not null) { e.SuppressKeyPress = true; searchCancellation.Cancel(); return; }
            if (!output.Focused || e.Shift || e.Alt) return;
            if (e.KeyCode == Keys.PageDown) { e.SuppressKeyPress = true; MoveLines(VisibleLines()); }
            else if (e.KeyCode == Keys.PageUp) { e.SuppressKeyPress = true; MoveLines(-VisibleLines()); }
            else if (e.Control && e.KeyCode == Keys.Home) { e.SuppressKeyPress = true; RequestView(0); }
            else if (e.Control && e.KeyCode == Keys.End) { e.SuppressKeyPress = true; RequestView(BinaryPreview.LastTopLine(length, VisibleLines())); }
        };
        output.Resize += (_, _) => { if (loaded) RequestView(requestedLine); };
        FormClosed += (_, _) => searchCancellation?.Cancel();
        Shown += (_, _) => RequestView(0);
    }

    private int VisibleLines()
    {
        var lineHeight = TextRenderer.MeasureText("0", output.Font, Size.Empty, TextFormatFlags.NoPadding).Height;
        return Math.Clamp((output.ClientSize.Height - 8) / Math.Max(1, lineHeight) - 1, 1, 4096);
    }

    private void MoveLines(long delta)
    {
        if (!loaded) return;
        // requestedLine is at most long.MaxValue / BytesPerLine.
        RequestView(requestedLine + delta);
    }

    private void MoveToOffset()
    {
        if (!loaded) return;
        var raw = offsetInput.Text.Trim();
        var hex = raw.StartsWith("0x", StringComparison.OrdinalIgnoreCase);
        var digits = hex ? raw[2..] : raw;
        if (!long.TryParse(digits, hex ? NumberStyles.AllowHexSpecifier : NumberStyles.None, CultureInfo.InvariantCulture, out var offset) || offset < 0)
        {
            status.Text = "バイト位置には 0 以上の整数、または 0x で始まる16進数を入力してください。";
            return;
        }
        RequestView(offset / BinaryPreview.BytesPerLine, offset);
    }

    private void RequestView(long line, long? highlight = null, int matchLength = 1)
    {
        requestedLine = Math.Clamp(line, 0, BinaryPreview.LastTopLine(length, VisibleLines()));
        highlightOffset = highlight;
        highlightLength = matchLength;
        viewRequest++;
        if (loaded)
            scroll.Value = BinaryPreview.ScrollValue(requestedLine, BinaryPreview.LastTopLine(length, VisibleLines()), ScrollScale);
        if (!viewLoading) _ = RefreshViewAsync();
    }

    private async Task RefreshViewAsync()
    {
        viewLoading = true;
        try
        {
            while (!IsDisposed)
            {
                var request = viewRequest;
                var line = requestedLine;
                var rows = VisibleLines();
                try
                {
                    var result = await Task.Run(() => BinaryPreview.ReadWindow(path, line, rows));
                    if (IsDisposed) return;
                    if (request != viewRequest) continue;
                    length = result.Length;
                    requestedLine = result.TopLine;
                    output.Text = BinaryPreview.Format(result.Bytes, result.Offset);
                    var lastLine = BinaryPreview.LastTopLine(length, rows);
                    scroll.Value = BinaryPreview.ScrollValue(requestedLine, lastLine, ScrollScale);
                    scroll.Enabled = lastLine > 0;
                    loaded = true;
                    first.Enabled = last.Enabled = goToOffset.Enabled = true;
                    searchNext.Enabled = searchPrevious.Enabled = searchCancellation is null;

                    if (highlightOffset is long match && match >= result.Offset && match - result.Offset < result.Bytes.Length)
                    {
                        var relative = match - result.Offset;
                        var row = (int)(relative / BinaryPreview.BytesPerLine);
                        var column = (int)(relative % BinaryPreview.BytesPerLine);
                        var rowStart = output.GetFirstCharIndexFromLine(row);
                        var addressWidth = (result.Offset + row * (long)BinaryPreview.BytesPerLine).ToString("X8").Length;
                        if (rowStart >= 0)
                        {
                            output.SelectionStart = Math.Min(output.TextLength, rowStart + addressWidth + 2 + column * 3);
                            output.SelectionLength = Math.Min(Math.Max(0, output.TextLength - output.SelectionStart),
                                Math.Max(2, Math.Min(highlightLength, BinaryPreview.BytesPerLine - column) * 3 - 1));
                        }
                        status.Text = $"読み取り専用・全 {length:N0} バイト　一致位置 {match:N0} バイト";
                    }
                    else
                    {
                        var range = result.Bytes.Length == 0 ? "空のファイル" : $"表示位置 {result.Offset:N0}〜{result.Offset + result.Bytes.Length - 1:N0} バイト";
                        status.Text = $"読み取り専用・全 {length:N0} バイト　{range}";
                    }
                    return;
                }
                catch (Exception ex)
                {
                    if (IsDisposed) return;
                    if (request != viewRequest) continue;
                    status.Text = "ファイルを読み込めませんでした: " + ex.Message;
                    return;
                }
            }
        }
        finally { viewLoading = false; }
    }

    private byte[] SearchBytes()
    {
        if (searchText.Text.Length == 0) throw new ArgumentException("検索する文字列を入力してください。");
        if (searchMode.SelectedIndex == 3)
        {
            var hex = new string(searchText.Text.Where(c => !char.IsWhiteSpace(c) && c != '-').ToArray());
            if (hex.Length == 0) throw new ArgumentException("検索する16進数を入力してください。");
            try { return Convert.FromHexString(hex); }
            catch (FormatException) { throw new ArgumentException("16進数は「DE AD BE EF」のように入力してください。"); }
        }
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        var encoding = searchMode.SelectedIndex switch
        {
            1 => new UnicodeEncoding(false, false, true),
            2 => Encoding.GetEncoding(932, EncoderFallback.ExceptionFallback, DecoderFallback.ExceptionFallback),
            _ => new UTF8Encoding(false, true)
        };
        try { return encoding.GetBytes(searchText.Text); }
        catch (EncoderFallbackException) { throw new ArgumentException("選択した文字コードに変換できない文字が含まれています。"); }
    }

    private async Task SearchAsync(bool backwards)
    {
        if (!loaded || searchCancellation is not null) return;
        byte[] pattern;
        try { pattern = SearchBytes(); }
        catch (ArgumentException ex) { status.Text = ex.Message; return; }

        var key = searchMode.SelectedIndex.ToString(CultureInfo.InvariantCulture) + "\0" + searchText.Text;
        if (key != lastSearchKey) { lastSearchKey = key; lastMatch = -1; }
        var start = lastMatch >= 0 ? (backwards ? lastMatch : lastMatch + 1) : (backwards ? length : 0);
        var cts = new CancellationTokenSource();
        searchCancellation = cts;
        searchNext.Enabled = searchPrevious.Enabled = searchText.Enabled = searchMode.Enabled = false;
        searchCancel.Enabled = true;
        status.Text = "ファイル全体を検索しています…";
        var watch = Stopwatch.StartNew();
        IProgress<(long Done, long Total)> progress = new Progress<(long, long)>(p =>
        {
            if (searchCancellation != cts || IsDisposed) return;
            var percent = p.Total == 0 ? 100 : Math.Min(100, (int)(100m * p.Done / p.Total));
            status.Text = $"ファイル全体を検索しています… {percent}%";
        });

        try
        {
            var result = await Task.Run(() =>
            {
                void Report(long done, long total)
                {
                    if (watch.ElapsedMilliseconds < 250) return;
                    watch.Restart();
                    progress.Report((done, total));
                }
                var found = BinaryPreview.Find(path, pattern, start, backwards, cts.Token, Report);
                var wrapped = false;
                if (found < 0 && lastMatch >= 0)
                {
                    wrapped = true;
                    found = BinaryPreview.Find(path, pattern, backwards ? long.MaxValue : 0, backwards, cts.Token, Report);
                }
                return (Found: found, Wrapped: wrapped);
            }, cts.Token);
            if (IsDisposed) return;
            if (result.Found < 0) { status.Text = "ファイル全体に一致する内容はありませんでした。"; return; }
            lastMatch = result.Found;
            RequestView(result.Found / BinaryPreview.BytesPerLine, result.Found, pattern.Length);
        }
        catch (OperationCanceledException) { if (!IsDisposed) status.Text = "検索を中止しました。"; }
        catch (Exception ex) { if (!IsDisposed) status.Text = "検索できませんでした: " + ex.Message; }
        finally
        {
            searchCancellation = null;
            cts.Dispose();
            if (!IsDisposed)
            {
                searchText.Enabled = searchMode.Enabled = true;
                searchNext.Enabled = searchPrevious.Enabled = loaded;
                searchCancel.Enabled = false;
            }
        }
    }

    private sealed class HexTextBox : TextBox
    {
        internal event Action<int>? WheelScrolled;
        protected override void WndProc(ref Message message)
        {
            const int MouseWheel = 0x020A;
            if (message.Msg == MouseWheel)
            {
                var delta = unchecked((short)(((long)message.WParam >> 16) & 0xffff));
                if (delta != 0) WheelScrolled?.Invoke(delta);
                return;
            }
            base.WndProc(ref message);
        }
    }
}
