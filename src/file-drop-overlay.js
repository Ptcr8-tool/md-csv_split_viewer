import './file-drop-overlay.css';

// File data may be intentionally hidden by the browser until drop. Only use
// MIME types made available by DataTransferItem; never inspect file contents.
function dropDescription(transfer, {markdown, canOpenHere}) {
  const items = Array.from(transfer.items || []).filter(item => item.kind === 'file');
  const types = items.map(item => item.type);
  const hasImage = types.some(type => type.startsWith('image/'));
  const hasOther = types.some(type => type && !type.startsWith('image/'));
  const hasUnknown = !types.length || types.some(type => !type);
  const open = canOpenHere ? 'ファイルをドロップして開く' : 'ファイルは元のウィンドウにドロップしてください';
  const image = markdown ? '画像は現在の Markdown に挿入します' : '画像の挿入は Markdown 文書で利用できます';
  if (hasImage && !hasOther && !hasUnknown) return {title: markdown ? '画像をドロップして挿入' : image, detail: markdown ? '現在のカーソル位置に挿入します' : ''};
  if (hasOther && !hasImage && !hasUnknown) return {title:open, detail:''};
  return {title:open, detail:image};
}

export function installFileDropOverlay({getContext, doc = document, win = window}) {
  const overlay = doc.createElement('div');
  overlay.className = 'file-drop-overlay';
  overlay.hidden = true;
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  const card = doc.createElement('div');
  card.className = 'file-drop-overlay__card';
  const symbol = doc.createElement('span');
  symbol.className = 'file-drop-overlay__symbol';
  symbol.setAttribute('aria-hidden', 'true');
  symbol.textContent = '↓';
  const title = doc.createElement('strong');
  const detail = doc.createElement('span');
  detail.className = 'file-drop-overlay__detail';
  card.append(symbol, title, detail);
  overlay.append(card);
  doc.body.append(overlay);

  const hide = () => { overlay.hidden = true; };
  const show = event => {
    const transfer = event.dataTransfer;
    if (!transfer || !Array.from(transfer.types || []).includes('Files')) return;
    const message = dropDescription(transfer, getContext());
    if (title.textContent !== message.title) title.textContent = message.title;
    if (detail.textContent !== message.detail) detail.textContent = message.detail;
    detail.hidden = !message.detail;
    overlay.hidden = false;
  };
  const leave = event => {
    // Moving between children of the window does not end an external drag.
    if (!event.relatedTarget || !(event.relatedTarget instanceof win.Node) || !doc.documentElement.contains(event.relatedTarget)) hide();
  };
  doc.addEventListener('dragenter', show, true);
  doc.addEventListener('dragover', show, true);
  doc.addEventListener('dragleave', leave, true);
  doc.addEventListener('drop', hide, true);
  doc.addEventListener('dragend', hide, true);
  win.addEventListener('blur', hide);
  return () => {
    doc.removeEventListener('dragenter', show, true);
    doc.removeEventListener('dragover', show, true);
    doc.removeEventListener('dragleave', leave, true);
    doc.removeEventListener('drop', hide, true);
    doc.removeEventListener('dragend', hide, true);
    win.removeEventListener('blur', hide);
    overlay.remove();
  };
}
