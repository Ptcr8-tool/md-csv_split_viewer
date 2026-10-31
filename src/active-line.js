// Preview line indicators live outside the editable document. Measuring ranges
// never changes the browser selection or the scroll position.
export class PreviewActiveLine {
  constructor(preview, getState) {
    this.preview = preview;
    this.getState = getState;
    this.host = preview.parentElement;
    this.layer = document.createElement('div');
    this.layer.className = 'preview-active-line-layer';
    this.layer.setAttribute('aria-hidden', 'true');
    this.layer.contentEditable = 'false';
    this.host.append(this.layer);
    this.refresh = () => {
      if (!this.frame) this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.draw();
      });
    };
    preview.addEventListener('scroll', this.refresh, {passive:true});
    preview.addEventListener('load', this.refresh, true);
    preview.addEventListener('error', this.refresh, true);
    preview.addEventListener('toggle', this.refresh, true);
    window.addEventListener('resize', this.refresh, {passive:true});
    this.resizeObserver = new ResizeObserver(this.refresh);
    this.resizeObserver.observe(preview);
    this.resizeObserver.observe(this.host);
    // Mermaid and delayed rendering can move existing lines without changing
    // the preview viewport's own dimensions.
    this.mutationObserver = new MutationObserver(this.refresh);
    this.mutationObserver.observe(preview, {subtree:true, childList:true, characterData:true, attributes:true});
    document.fonts?.addEventListener('loadingdone', this.refresh);
    globalThis.CSS?.highlights?.delete('linked-active-line');
  }

  set(position) {
    this.position = position;
    this.refresh();
  }

  draw() {
    const state = this.getState(this.position);
    const box = this.preview.getBoundingClientRect();
    const hostBox = this.host.getBoundingClientRect();
    const width = this.preview.clientWidth;
    const height = this.preview.clientHeight;
    this.layer.hidden = !state || !width || !height;
    if (this.layer.hidden) {
      this.layer.replaceChildren();
      return;
    }
    Object.assign(this.layer.style, {
      left:`${box.left-hostBox.left+this.host.scrollLeft}px`,
      top:`${box.top-hostBox.top+this.host.scrollTop}px`,
      width:`${width}px`, height:`${height}px`
    });
    const rects = [];
    const {line, position, leaves} = state;
    const lineHeights = new Map();
    const addRects = (range, parent) => {
      if (!lineHeights.has(parent)) {
        const style = getComputedStyle(parent);
        lineHeights.set(parent, parseFloat(style.lineHeight) || parseFloat(style.fontSize)*1.2);
      }
      for (const rect of range.getClientRects()) {
        if (!rect.height) continue;
        const rowHeight = Math.max(rect.height, lineHeights.get(parent));
        const top = rect.top-(rowHeight-rect.height)/2-box.top;
        rects.push({top, bottom:top+rowHeight});
      }
    };
    for (const leaf of leaves) {
      const parent = leaf.node.parentElement;
      if (leaf.to<line.start || leaf.from>line.end || !parent || parent.closest('[hidden]') || !this.preview.contains(parent)) continue;
      const from = leaf.map.findIndex(n => n>=line.start);
      const to = leaf.map.findLastIndex(n => n<=line.end);
      if (from<0 || to<=from) continue;
      const range = document.createRange();
      range.setStart(leaf.node, Math.min(from, leaf.node.length));
      range.setEnd(leaf.node, Math.min(to, leaf.node.length));
      addRects(range, parent);
    }
    if (!rects.length) {
      // Empty paragraphs and syntax-only lines have no painted characters.
      // Prefer the nearest editable leaf within their own block; an atom such
      // as an image/diagram gets one thin row at its top instead of a filled box.
      const block = Array.from(this.preview.querySelectorAll('[data-block]')).findLast(node =>
        Number(node.dataset.from)<=position && Number(node.dataset.to)>=position && !node.closest('[hidden]') && node.getBoundingClientRect().height);
      if (block) {
        const nearby = leaves.filter(leaf => block.contains(leaf.node)).sort((a,b) =>
          Math.min(Math.abs(a.from-position), Math.abs(a.to-position))-Math.min(Math.abs(b.from-position), Math.abs(b.to-position)))[0];
        if (nearby) {
          const range = document.createRange();
          const offset = position>=nearby.to ? nearby.node.length : 0;
          range.setStart(nearby.node, offset);
          range.collapse(true);
          addRects(range, nearby.node.parentElement);
        }
        if (!rects.length) {
          const rect = block.getBoundingClientRect();
          const style = getComputedStyle(block);
          const rowHeight = Math.min(rect.height, parseFloat(style.lineHeight) || parseFloat(style.fontSize)*1.2);
          rects.push({top:rect.top-box.top, bottom:rect.top-box.top+rowHeight});
        }
      }
    }
    // Separate inline leaves (bold, links, table cells, whitespace markers)
    // often describe the same visual row. Merge vertical overlap, retaining
    // separate rows when a single Markdown line wraps in the preview.
    rects.sort((a,b) => a.top-b.top || a.bottom-b.bottom);
    const rows = [];
    for (const rect of rects) {
      const last = rows.at(-1);
      const overlap = last ? Math.min(last.bottom, rect.bottom)-Math.max(last.top, rect.top) : 0;
      if (last && overlap>=Math.min(last.bottom-last.top, rect.bottom-rect.top)*.5) {
        last.top = Math.min(last.top, rect.top);
        last.bottom = Math.max(last.bottom, rect.bottom);
      } else rows.push({...rect});
    }
    const fragment = document.createDocumentFragment();
    for (const row of rows) {
      if (row.bottom<=0 || row.top>=height) continue;
      const node = document.createElement('div');
      node.className = 'preview-active-line-row';
      node.style.top = `${row.top}px`;
      node.style.height = `${row.bottom-row.top}px`;
      fragment.append(node);
    }
    this.layer.replaceChildren(fragment);
  }
}
