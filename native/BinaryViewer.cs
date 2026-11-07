namespace MdSplit;

// A separate read-only viewer keeps binary data out of document saving and
// session/recovery workflows. No path that writes the original is exposed.
internal sealed class BinaryViewer : Form
{
    private readonly Label status = new() { Dock = DockStyle.Top, Height = 50, Padding = new Padding(12, 8, 12, 0), Text = "ファイルを読み込んでいます…" };
    private readonly TextBox output = new() { Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, WordWrap = false, ScrollBars = ScrollBars.Both, Font = new Font("Consolas", 10), ShortcutsEnabled = true };

    internal BinaryViewer(string path)
    {
        Text = Path.GetFileName(path) + " — バイナリ表示（読み取り専用）";
        Width = 960; Height = 620; MinimumSize = new Size(600, 300); StartPosition = FormStartPosition.CenterParent;
        Controls.Add(output); Controls.Add(status);
        Shown += async (_, _) =>
        {
            try
            {
                var (bytes, length, text) = await Task.Run(() =>
                {
                    var (bytes, length) = BinaryPreview.ReadPrefix(path);
                    return (bytes, length, BinaryPreview.Format(bytes));
                });
                if (IsDisposed) return;
                output.Text = text;
                status.Text = length > bytes.Length
                    ? $"バイナリ形式・読み取り専用。全 {length:N0} バイトのうち先頭 {bytes.Length:N0} バイトのみ表示しています。残りは表示していません。"
                    : $"バイナリ形式・読み取り専用。{bytes.Length:N0} バイトを表示しています。";
            }
            catch (Exception ex)
            {
                if (!IsDisposed) status.Text = "ファイルを読み込めませんでした: " + ex.Message;
            }
        };
    }
}
