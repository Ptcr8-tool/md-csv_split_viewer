const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
export function discordState(text, until) {
  let fence = null, inline = null, marks = [], quote = false, lineStart = 0;
  for (let i = 0; i < until;) {
    if (i === lineStart) {
      const m = text.slice(i).match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)/);
      if (m) {
        if (!fence) fence = { delimiter: m[1], header: m[0].trimEnd() };
        else if (m[1][0] === fence.delimiter[0] && m[1].length >= fence.delimiter.length && !m[2].trim()) fence = null;
        const nl = text.indexOf('\n', i);
        if (nl < 0 || nl >= until) { i = until; continue; }
        i = nl + 1; lineStart = i; continue;
      }
      if (!fence && text.slice(i).startsWith('>>> ')) quote = true;
    }
    if (text[i] === '\n') { i++; lineStart = i; continue; }
    if (fence) { i++; continue; }
    if (text[i] === '\\') { i += 2; continue; }
    if (text[i] === '`') {
      const tick = text.slice(i).match(/^`+/)[0];
      inline = inline === tick ? null : (inline || tick); i += tick.length; continue;
    }
    if (inline) { i++; continue; }
    const mark = ['***','___','**','__','~~','||','*','_'].find(m=>text.startsWith(m,i));
    if (mark) {
      const before = text[i-1] || '', after = text[i+mark.length] || '';
      if (mark.includes('_') && /[\p{L}\p{N}]/u.test(before) && /[\p{L}\p{N}]/u.test(after)) { i += mark.length; continue; }
      if (marks.at(-1) === mark) marks.pop();
      else if (after && !/\s/.test(after)) marks.push(mark);
      i += mark.length; continue;
    }
    i++;
  }
  return { fence, inline, marks, quote };
}
function prefix(state) {
  return (state.quote ? '>>> ' : '') + (state.fence ? state.fence.header + '\n' : state.marks.join('') + (state.inline || ''));
}
function suffix(state, content) {
  return state.fence ? (content.endsWith('\n') ? '' : '\n') + state.fence.delimiter : (state.inline || '') + [...state.marks].reverse().join('');
}
function isFenceInterior(text, pos) {
  const a = text.lastIndexOf('\n', pos-1)+1, b = text.indexOf('\n',a);
  const line = text.slice(a,b<0?text.length:b);
  return pos>a && pos<(b<0?text.length:b+1) && /^ {0,3}(`{3,}|~{3,})/.test(line);
}
// Windows clipboard consumers may expand a lone line break to CRLF. Reserve
// space for that expansion while leaving the copied text itself unchanged.
function clipboardLength(text) {
  return text.length + (text.match(/(?<!\r)\n|\r(?!\n)/g) || []).length;
}
export function splitDiscord(text, limit = 2000) {
  limit = Math.floor(Number(limit));
  if (!Number.isFinite(limit) || limit < 32) throw new Error('文字数上限は32以上で指定してください。');
  if (!text) return [{ text: '', from: 0, to: 0, count: 0 }];
  const boundaries = [0, ...Array.from(segmenter.segment(text),s=>s.index+s.segment.length)];
  const output = []; let from=0;
  while (from < text.length) {
    const pre = from ? prefix(discordState(text,from)) : '';
    let candidates = boundaries.filter(p=>p>from && p-from+pre.length<=limit && !isFenceInterior(text,p));
    let best = 0, bestText = '';
    for (let pass=0; pass<3 && !best; pass++) {
      const choices = candidates.filter(p=>pass===2 || (pass===0 ? /\n\s*\n$/.test(text.slice(Math.max(from,p-5),p)) : text[p-1]==='\n'));
      for (let n=choices.length-1;n>=0;n--) {
        const to=choices[n];
        if (to < text.length && text[to-1]===text[to] && /[*_~|`]/.test(text[to])) continue;
        const body=text.slice(from,to), endState=discordState(text,to);
        const tail=to<text.length?suffix(endState,body):'';
        const value=pre+body+tail;
        if (clipboardLength(value)<=limit) { best=to; bestText=value; break; }
      }
    }
    if (!best) throw new Error('コードフェンスなどが上限内に入りません。上限を大きくするか、元の文章で区切ってください。');
    output.push({text:bestText,from,to:best,count:bestText.length}); from=best;
  }
  return output;
}
