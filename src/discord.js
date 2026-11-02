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
// Windows clipboard consumers may expand a lone line break to CRLF. Reserve
// space for that expansion while leaving the copied text itself unchanged.
export function clipboardLength(text) {
  return text.length + (text.match(/(?<!\r)\n|\r(?!\n)/g) || []).length;
}
// Boundaries are always grapheme-safe and never split a fence delimiter or
// a run of Markdown formatting characters. Offsets refer to the original text.
export function discordBoundaries(text) {
  const points=[0];let lineStart=0,lineEnd=text.indexOf('\n'),fenceLine=false;
  const updateLine=()=>{if(lineEnd<0)lineEnd=text.length;fenceLine=/^ {0,3}(`{3}|~{3})/.test(text.slice(lineStart,lineStart+6));};
  updateLine();
  for(const s of segmenter.segment(text)){
    const pos=s.index+s.segment.length;
    while(pos>lineEnd && lineEnd<text.length){lineStart=lineEnd+1;lineEnd=text.indexOf('\n',lineStart);updateLine();}
    const insideFence=fenceLine && pos>lineStart && pos<=lineEnd;
    const insideMark=pos<text.length && text[pos-1]===text[pos] && /[*_~|`]/.test(text[pos]);
    if(pos===text.length||!insideFence&&!insideMark)points.push(pos);
  }
  return points;
}
function nearestBoundary(boundaries, point) {
  let low=0, high=boundaries.length-1;
  while(low<high){const mid=(low+high)>>1;if(boundaries[mid]<point)low=mid+1;else high=mid;}
  const after=boundaries[low],before=boundaries[Math.max(0,low-1)];
  return point-before<=after-point?before:after;
}
export function normalizeDiscordBreaks(text, breaks) {
  const boundaries=discordBoundaries(text);
  return [...new Set(breaks.filter(Number.isFinite).map(point=>nearestBoundary(boundaries,point))
    .filter(point=>point>0 && point<text.length))].sort((a,b)=>a-b);
}
function makePart(text,from,to,limit) {
  const pre=from?prefix(discordState(text,from)):'';
  const body=text.slice(from,to);
  const tail=to<text.length?suffix(discordState(text,to),body):'';
  const value=pre+body+tail, count=clipboardLength(value);
  return {text:value,from,to,count,over:count>limit,prefix:pre,body,suffix:tail};
}
export function splitDiscordAt(text, breaks, limit = 2000) {
  limit = Math.floor(Number(limit));
  if (!Number.isFinite(limit) || limit < 32) throw new Error('文字数上限は32以上で指定してください。');
  const points=[0,...normalizeDiscordBreaks(text,breaks),text.length];
  return points.slice(1).map((to,i)=>makePart(text,points[i],to,limit));
}
export function splitDiscord(text, limit = 2000) {
  limit = Math.floor(Number(limit));
  if (!Number.isFinite(limit) || limit < 32) throw new Error('文字数上限は32以上で指定してください。');
  if (!text) return [makePart('',0,0,limit)];
  if(clipboardLength(text)<=limit)return [makePart(text,0,text.length,limit)];
  const boundaries=discordBoundaries(text);
  const output=[];let from=0;
  while(from<text.length){
    // Never prefer a paragraph break when the remaining text already fits.
    const remaining=makePart(text,from,text.length,limit);
    if(!remaining.over){output.push(remaining);break;}
    const pre=from?prefix(discordState(text,from)):'';
    const candidates=boundaries.filter(p=>p>from && p-from+pre.length<=limit);
    let furthest=null;
    for(let n=candidates.length-1;n>=0;n--){
      const part=makePart(text,from,candidates[n],limit);
      if(!part.over){furthest=part;break;}
    }
    if(!furthest)throw new Error('コードフェンスなどが上限内に入りません。上限を大きくするか、元の文章で区切ってください。');
    // Prefer a natural break only when it uses a reasonable part of the space.
    // Otherwise a single early paragraph could create several tiny messages.
    const min=from+Math.floor((furthest.to-from)*0.65);
    const remainingCount=clipboardLength(text.slice(furthest.to));
    const slots=Math.ceil(remainingCount/limit);
    let best=null;
    for(let pass=0;pass<2 && !best;pass++){
      for(let n=candidates.length-1;n>=0;n--){
        const to=candidates[n];if(to>furthest.to||to<min)continue;
        const natural=pass===0?/\n[ \t]*\r?\n$/.test(text.slice(Math.max(from,to-128),to)) : text[to-1]==='\n';
        if(natural && remainingCount+clipboardLength(text.slice(to,furthest.to))<=slots*limit){const part=makePart(text,from,to,limit);if(!part.over){best=part;break;}}
      }
    }
    output.push(best||furthest);from=(best||furthest).to;
  }
  return output;
}
