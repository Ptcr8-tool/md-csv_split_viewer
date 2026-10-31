export function normalized(text) { return text.replace(/\r\n?/g, '\n'); }
export function preferredEol(text) {
  const crlf=text.match(/\r\n/g)?.length||0,lf=text.match(/(?<!\r)\n/g)?.length||0,cr=text.match(/\r(?!\n)/g)?.length||0;
  if(cr>crlf&&cr>lf)return '\r';
  return crlf>lf?'\r\n':'\n';
}
const encodingHasBom=encoding=>['utf8bom','utf16le','utf16be','utf32le','utf32be'].includes(encoding);
// History stores only changed text, bounded by payload and by edit count. A single
// oversized edit is retained so that an accidental large replacement can be undone.
export const MAX_HISTORY_CHARS = 50_000_000;
const MAX_HISTORY_GROUPS = 200, MAX_CHANGES_PER_GROUP = 1000;
// Avoid keeping a small substring tied to a much larger source string in V8.
// Concatenation and slicing preserves UTF-16 code units, including lone surrogates.
const detachHistoryText = value => value.length > 12 && value.length <= 1_000_000 ? (' ' + value).slice(1) : value;
// Sparse, one-document cache: converting many offsets no longer rescans the
// entire document each time. Checkpoints never split a CRLF pair.
const OFFSET_BLOCK = 4096;
let offsetCache;
function offsets(raw) {
  if (offsetCache?.raw === raw) return offsetCache;
  let next = raw.indexOf('\r\n');
  if (next < 0) return offsetCache = { raw, noPairs:true };
  const rawOffsets=[0], lfOffsets=[0];
  let start=0, logical=0;
  while(start<raw.length){
    let end=Math.min(start+OFFSET_BLOCK,raw.length);
    if(end<raw.length&&raw[end-1]==='\r'&&raw[end]==='\n')end--;
    let pairs=0;
    while(next>=0&&next+1<end){pairs++;next=raw.indexOf('\r\n',next+2);}
    logical+=end-start-pairs;start=end;rawOffsets.push(start);lfOffsets.push(logical);
  }
  return offsetCache={raw,rawOffsets,lfOffsets};
}
function floorIndex(values,target){
  let low=0,high=values.length;
  while(low+1<high){const mid=(low+high)>>1;if(values[mid]<=target)low=mid;else high=mid;}
  return low;
}
export function lfToRaw(raw, index) {
  // The original mapping returned the end for non-integers and negatives.
  if(!Number.isSafeInteger(index)||index<0)return raw.length;
  if(index===0)return 0;
  const map=offsets(raw);if(map.noPairs)return Math.min(index,raw.length);
  const i=floorIndex(map.lfOffsets,index),start=map.rawOffsets[i],end=map.rawOffsets[i+1]??raw.length;
  let left=index-map.lfOffsets[i];if(!left)return start;
  const part=raw.slice(start,end);let position=0;
  while(position<part.length){
    const pair=part.indexOf('\r\n',position);
    if(pair<0)return start+Math.min(part.length,position+left);
    const plain=pair-position;if(left<=plain)return start+position+left;
    left-=plain+1;position=pair+2;if(!left)return start+position;
  }
  return start+position;
}
export function rawToLf(raw, index) {
  // Preserve String.slice behavior for negative, fractional and special values.
  if(!Number.isSafeInteger(index)||index<0)return normalized(raw.slice(0,index)).length;
  const end=Math.min(index,raw.length);if(!end)return 0;
  const map=offsets(raw);if(map.noPairs)return end;
  const i=floorIndex(map.rawOffsets,end),start=map.rawOffsets[i];
  const part=raw.slice(start,end);let pairs=0,pos=0;
  while((pos=part.indexOf('\r\n',pos))>=0){pairs++;pos+=2;}
  return map.lfOffsets[i]+part.length-pairs;
}
export function difference(before, after) {
  let from = 0, a = before.length, b = after.length;
  while (from < a && from < b && before[from] === after[from]) from++;
  while (a > from && b > from && before[a - 1] === after[b - 1]) { a--; b--; }
  return { from, to: a, insert: after.slice(from, b) };
}

export class DocumentModel {
  constructor(data = {}) {
    this.id = data.id || crypto.randomUUID();
    this.raw = data.text || '';
    this.saved = data.savedText ?? this.raw;
    this.path = data.path || null;
    // A browser File has no writable path but still has a known saved baseline.
    // Older recovery entries omit this flag and retain the unsaved-document rule.
    this.needsInitialSave = typeof data.needsInitialSave === 'boolean' ? data.needsInitialSave : !this.path;
    this.name = data.name || '無題.md';
    this.encoding = data.encoding || 'utf8';
    this.savedEncoding = data.savedEncoding ?? this.encoding;
    this.hasBom = typeof data.hasBom==='boolean'?data.hasBom:encodingHasBom(this.encoding);
    this.savedHasBom = typeof data.savedHasBom==='boolean'?data.savedHasBom:this.savedEncoding===this.encoding?this.hasBom:encodingHasBom(this.savedEncoding);
    this.encodingGuessed = data.encodingGuessed===true;
    this.encodingNotice = typeof data.encodingNotice==='string'?data.encodingNotice:null;
    this.format = typeof data.format==='string'?data.format:undefined;
    this.previewViewMode = ['split','source','preview'].includes(data.previewViewMode)?data.previewViewMode:'split';
    this.fingerprint = data.fingerprint || null;
    this.undoStack = []; this.redoStack = []; this.historyChars = 0;
    this.selection = { from: 0, to: 0 }; this.group = null; this.lastEdit = 0;
    this.revision = 0;
    this.anchors = new Set();
  }
  get dirty() { return this.raw !== this.saved || this.encoding!==this.savedEncoding || this.hasBom!==this.savedHasBom || (!this.path && this.needsInitialSave && this.raw.length > 0); }
  snapshot() { return { raw: this.raw, selection: { ...this.selection } }; }
  trackRange(range) { const anchor={...range,valid:true};this.anchors.add(anchor);anchor.dispose=()=>this.anchors.delete(anchor);return anchor; }
  replace(from, to, insert, kind = 'command', selection) {
    from = Math.max(0, Math.min(from, this.raw.length));
    to = Math.max(from, Math.min(to, this.raw.length));
    if (this.raw.slice(from, to) === insert) return false;
    const now = Date.now();
    for (const item of this.redoStack) this.historyChars -= item.chars;
    this.redoStack = [];
    let item = this.undoStack.at(-1);
    if (!item || kind !== this.group || now - this.lastEdit > 650 || kind === 'command' || item.changes.length >= MAX_CHANGES_PER_GROUP) {
      item = { changes: [], beforeSelection: { ...this.selection }, afterSelection: null, chars: 0 };
      this.undoStack.push(item);
    }
    const removed = detachHistoryText(this.raw.slice(from, to));
    item.changes.push({ from, removed, inserted: detachHistoryText(insert) });
    item.chars += removed.length + insert.length;
    this.historyChars += removed.length + insert.length;
    while (this.undoStack.length > 1 && (this.undoStack.length > MAX_HISTORY_GROUPS || this.historyChars > MAX_HISTORY_CHARS)) {
      this.historyChars -= this.undoStack.shift().chars;
    }
    this.group = kind; this.lastEdit = now;
    const shift=p=>p>=to?p+insert.length-(to-from):p>=from?from+insert.length:p;
    for(const anchor of this.anchors){anchor.from=shift(anchor.from);anchor.to=shift(anchor.to);}
    this.raw = this.raw.slice(0, from) + insert + this.raw.slice(to);
    this.selection = selection || { from: from + insert.length, to: from + insert.length };
    item.afterSelection = { ...this.selection };
    this.revision++; return true;
  }
  editNormalized(before, after, selection) {
    const change = difference(before, after);
    const from = lfToRaw(this.raw, change.from), to = lfToRaw(this.raw, change.to);
    const insert = change.insert.replace(/\n/g, preferredEol(this.raw));
    return this.replace(from, to, insert, 'source', selection ? {
      from: lfToRaw(this.raw.slice(0, from) + insert + this.raw.slice(to), selection.from),
      to: lfToRaw(this.raw.slice(0, from) + insert + this.raw.slice(to), selection.to),
    } : undefined);
  }
  undo() {
    const item = this.undoStack.pop(); if (!item) return false;
    item.afterSelection = { ...this.selection };
    for (let i = item.changes.length - 1; i >= 0; i--) {
      const c = item.changes[i];
      this.raw = this.raw.slice(0, c.from) + c.removed + this.raw.slice(c.from + c.inserted.length);
    }
    this.redoStack.push(item); this.finishHistory(item.beforeSelection); return true;
  }
  redo() {
    const item = this.redoStack.pop(); if (!item) return false;
    item.beforeSelection = { ...this.selection };
    for (const c of item.changes) this.raw = this.raw.slice(0, c.from) + c.inserted + this.raw.slice(c.from + c.removed.length);
    this.undoStack.push(item); this.finishHistory(item.afterSelection); return true;
  }
  finishHistory(selection) { this.selection = { ...selection }; this.group = null; this.revision++; for(const anchor of this.anchors)anchor.valid=false; }
  restore(item) { this.raw = item.raw; this.selection = item.selection; this.group = null; this.revision++;for(const anchor of this.anchors)anchor.valid=false; }
  serialize() { return { id: this.id, text: this.raw, savedText: this.saved, path: this.path, needsInitialSave:this.needsInitialSave, name: this.name, encoding: this.encoding, savedEncoding:this.savedEncoding, hasBom:this.hasBom, savedHasBom:this.savedHasBom, encodingGuessed:this.encodingGuessed, encodingNotice:this.encodingNotice, format:this.format, previewViewMode:this.previewViewMode, fingerprint: this.fingerprint }; }
}

export function escapeLiteral(text, code = false, cell = false) {
  if (code) return text;
  let result = text.replace(/[\\`*_[\]~]/g, '\\$&');
  if (cell) result = result.replace(/\|/g, '\\|');
  return result;
}

export function imageUrlRange(raw, from, to) {
  const text=raw.slice(from,to);let depth=0, end=-1;
  for(let i=1;i<text.length;i++){
    if(text[i]==='\\'){i++;continue;}
    if(text[i]==='[')depth++;
    if(text[i]===']'&&--depth===0){end=i+1;break;}
  }
  if(end<0||text[end]!=='(')return null;
  let start=end+1;while(/\s/.test(text[start]||'')&&start<text.length)start++;
  let at=start;
  if(text[start]==='<'){start++;at=start;while(at<text.length&&text[at]!=='>'){if(text[at]==='\\')at++;at++;}}
  else{let nesting=0;while(at<text.length){if(text[at]==='\\'){at+=2;continue;}if(text[at]==='(')nesting++;if(text[at]===')'){if(!nesting)break;nesting--;}if(/\s/.test(text[at])&&!nesting)break;at++;}}
  return {urlFrom:from+start,urlTo:from+at};
}

// Map each displayed UTF-16 boundary back to its exact source boundary.
export function textMap(raw, value, start, decodeEntity = () => null) {
  const map = [start]; let i = 0, j = 0;
  while (j < value.length) {
    if (raw[i] === '\\' && /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(raw[i + 1] || '') && raw[i + 1] === value[j]) {
      i += 2; j++; map.push(start + i); continue;
    }
    if (raw[i] === '&') {
      const entity = raw.slice(i).match(/^&(#x[\da-f]+|#\d+|[a-z][\da-z]+);/i)?.[0];
      if (entity) {
        let decoded;
        if (/^&#/.test(entity)) { const code = /^&#x/i.test(entity) ? parseInt(entity.slice(3,-1),16) : parseInt(entity.slice(2,-1),10); decoded = code>0 && code<=0x10ffff && !(code>=0xd800&&code<=0xdfff) ? String.fromCodePoint(code) : '\ufffd'; }
        else decoded = decodeEntity(entity.slice(1, -1));
        if (decoded && value.slice(j, j + decoded.length) === decoded) {
          for (let k = 0; k < decoded.length; k++) map.push(start + i + (k === decoded.length - 1 ? entity.length : 0));
          i += entity.length; j += decoded.length; continue;
        }
      }
    }
    if (raw[i] === '\r' && value[j] === '\n') {
      i+=raw[i+1]==='\n'?2:1;j++;map.push(start+i);continue;
    }
    if (raw[i] !== value[j]) {
      const at = raw.indexOf(value[j], i);
      if (at >= i && at - i < 5) i = at;
    }
    i = Math.min(i + 1, raw.length); j++; map.push(start + i);
  }
  return map;
}

// Keep delimiters balanced when a rich-text deletion crosses format boundaries.
export function replaceRich(raw, from, to, insert, formats = []) {
  if (from === to) return { from, to, insert };
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const f of formats) {
      if(insert && from>=f.contentFrom && to<=f.contentTo) continue;
      if (from <= f.contentFrom && to >= f.contentTo && to > f.contentFrom && from < f.contentTo) {
        const a = Math.min(from, f.from), b = Math.max(to, f.to);
        if (a !== from || b !== to) { from = a; to = b; expanded = true; }
      }
    }
  }
  const close = formats.filter(f => from > f.contentFrom && from <= f.contentTo && to >= f.to).sort((a,b) => b.from-a.from).map(f=>f.close).join('');
  const open = formats.filter(f => from <= f.from && to >= f.contentFrom && to < f.contentTo).sort((a,b) => a.from-b.from).map(f=>f.open).join('');
  return { from, to, insert: insert + close + open };
}
