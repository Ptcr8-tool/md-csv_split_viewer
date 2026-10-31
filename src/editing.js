import { difference, preferredEol } from './document.js';

// Use an angle destination so spaces and parentheses stay within the link.
export function markdownLink(label,destination,{image=false}={}){
  const text=String(label).replace(/[\r\n]+/g,' ').replace(/[\\\[\]]/g,'\\$&');
  const target=String(destination).replace(/[<>\u0000-\u001f\u007f]/g,c=>encodeURIComponent(c)).replace(/\\/g,'\\\\');
  return `${image?'!':''}[${text}](<${target}>)`;
}

export function lineAt(raw,position){
  position=Math.max(0,Math.min(raw.length,position));
  // Both UTF-16 positions inside CRLF belong to the preceding logical line.
  const probe=raw[position]==='\n'&&raw[position-1]==='\r'?position-1:position;
  const start=probe?Math.max(raw.lastIndexOf('\n',probe-1),raw.lastIndexOf('\r',probe-1))+1:0;
  const lf=raw.indexOf('\n',probe),cr=raw.indexOf('\r',probe),end=lf<0?(cr<0?raw.length:cr):cr<0?lf:Math.min(cr,lf);
  const eol=end===raw.length?'':raw[end]==='\r'&&raw[end+1]==='\n'?'\r\n':raw[end];
  return {start,end,text:raw.slice(start,end),eol};
}
export function listLine(raw,position){
  const line=lineAt(raw,position),m=/^([ \t]*)([-+*]|\d{1,9}[.)])(?:([ \t]+)|$)(?:\[([ xX])\](?:[ \t]+|$))?/.exec(line.text);
  if(!m)return null;
  const indent=m[1],marker=m[2],prefix=m[0];
  return {...line,indent,marker,prefix,task:m[4]===undefined?null:m[4],contentFrom:line.start+prefix.length,content:line.text.slice(prefix.length)};
}
const indentWidth=s=>s.replaceAll('\t','    ').length;
function previousItem(raw,line,strict=false){
  for(let at=line.start-1;at>=0;){const previous=lineAt(raw,at);const item=listLine(raw,previous.start);if(item&&(strict?indentWidth(item.indent)<indentWidth(line.indent):indentWidth(item.indent)<=indentWidth(line.indent)))return item;if(!item&&previous.text.trim()&&!/^[ \t]/.test(previous.text))return null;at=previous.start-1;}
  return null;
}
function itemEnd(raw,line){
  let end=line.end,at=line.end+line.eol.length;
  while(at<raw.length){const next=lineAt(raw,at);if(next.text.trim()&&indentWidth(next.text.match(/^[ \t]*/)[0])<=indentWidth(line.indent))break;end=next.end;at=next.end+next.eol.length;if(!next.eol)break;}
  return end;
}
function linePatch(raw,from,to,transform,selection){
  const old=raw.slice(from,to);let cursor=from;const changes=[];
  const insert=old.split(/(\r\n|\r|\n)/).map((text,i)=>{if(i%2){cursor+=text.length;return text;}const next=transform(text,cursor);const d=difference(text,next);if(d.from!==d.to||d.insert)changes.push({from:cursor+d.from,to:cursor+d.to,insert:d.insert});cursor+=text.length;return next;}).join('');
  const shift=position=>{let delta=0;for(const c of changes){if(position>=c.to)delta+=c.insert.length-(c.to-c.from);else if(position>c.from)return c.from+delta+c.insert.length;else break;}return position+delta;};
  return {from,to,insert,selection:{from:shift(selection.from),to:shift(selection.to)}};
}
export function indentList(raw,selection,outdent=false){
  const first=listLine(raw,selection.from);if(!first)return null;
  const lastAt=selection.to>selection.from&&/[\r\n]/.test(raw[selection.to-1])?selection.to-1:selection.to;
  const last=listLine(raw,lastAt)||first;
  const end=itemEnd(raw,last),previous=previousItem(raw,first);
  const parent=outdent?previousItem(raw,first,true):null;
  const amount=outdent?Math.min(indentWidth(first.indent),parent?indentWidth(first.indent)-indentWidth(parent.indent):2):Math.max(2,previous?previous.marker.length+1:2);
  if(outdent&&!first.indent)return null;
  return linePatch(raw,first.start,end,(text)=>{
    if(!text.trim())return text;
    if(!outdent)return ' '.repeat(amount)+text;
    if(text.startsWith('\t'))return text.slice(1);
    return text.slice(Math.min(amount,text.match(/^ */)[0].length));
  },selection);
}
export function enterList(raw,selection){
  const line=listLine(raw,selection.from);if(!line||selection.from<line.contentFrom)return null;
  const eol=preferredEol(raw);
  if(!line.content.trim()&&selection.from===selection.to){
    const insert=line.start?eol:'';
    return {from:line.start,to:line.end,insert,selection:{from:line.start+insert.length,to:line.start+insert.length}};
  }
  const marker=/^\d/.test(line.marker)?String(Number.parseInt(line.marker)+1)+line.marker.at(-1):line.marker;
  const insert=eol+line.indent+marker+' '+(line.task!==null?'[ ] ':'');
  return {from:selection.from,to:selection.to,insert,selection:{from:selection.from+insert.length,to:selection.from+insert.length}};
}
export function backspaceList(raw,selection){
  if(selection.from!==selection.to)return null;
  const line=listLine(raw,selection.from);if(!line||selection.from!==line.contentFrom)return null;
  if(line.indent)return indentList(raw,selection,true);
  const insert=line.start?preferredEol(raw):'';
  return {from:line.start,to:line.contentFrom,insert,selection:{from:line.start+insert.length,to:line.start+insert.length}};
}
export function indentText(raw,selection,outdent=false){
  if(!outdent&&selection.from===selection.to)return {from:selection.from,to:selection.to,insert:'\t'};
  const first=lineAt(raw,selection.from),last=lineAt(raw,selection.to>selection.from&&/[\r\n]/.test(raw[selection.to-1])?selection.to-1:selection.to);
  return linePatch(raw,first.start,last.end,text=>outdent?text.replace(/^(?:\t| {1,4})/,''):'\t'+text,selection);
}

export function toggleList(raw,selection,kind){
  const first=lineAt(raw,selection.from),last=lineAt(raw,selection.to>selection.from&&/[\r\n]/.test(raw[selection.to-1])?selection.to-1:selection.to);
  const targets=[];let at=first.start;
  while(at<=last.end){const line=lineAt(raw,at);if(line.text.trim()||selection.from===selection.to)targets.push({...line,item:listLine(raw,at)});if(!line.eol)break;at=line.end+line.eol.length;}
  const type=item=>!item?null:item.task!==null?'check':/^\d/.test(item.marker)?'number':'bullet';
  const remove=targets.length>0&&targets.every(t=>type(t.item)===kind);let number=0,end=last.end;
  for(const target of targets){const indent=target.item?.indent??target.text.match(/^[ \t]*/)[0];target.prefix=remove?'':kind==='number'?`${++number}. `:kind==='check'?'- [ ] ':'- ';target.indent=indent;target.body=target.item?target.item.content:target.text.slice(indent.length);target.delta=target.item?target.prefix.length-(target.item.prefix.length-indent.length):0;target.childEnd=target.item?itemEnd(raw,target.item):target.end;end=Math.max(end,target.childEnd);}
  return linePatch(raw,first.start,end,(text,position)=>{
    const target=targets.find(t=>t.start===position),indent=text.match(/^[ \t]*/)[0],delta=targets.filter(t=>t.start<position&&t.childEnd>=position).reduce((total,t)=>total+t.delta,0);
    const shifted=delta?(' '.repeat(Math.max(0,indentWidth(indent)+delta))):indent;
    if(target)return shifted+target.prefix+target.body;
    return text.trim()?shifted+text.slice(indent.length):text;
  },selection);
}

export function fenceInfo(raw,from,to){
  const text=raw.slice(from,to),opening=/^( {0,3})(`{3,}|~{3,})([^\r\n]*)(\r\n|\r|\n|$)/.exec(text);
  if(!opening)return {from,to,contentFrom:from,contentTo:to,fenced:false};
  const contentFrom=from+opening[0].length,char=opening[2][0],size=opening[2].length;
  const expression=new RegExp('^ {0,3}'+char+'{'+size+',}[ \\t]*$');
  let at=contentFrom,closingFrom=null;
  while(at<to){const line=lineAt(raw,at);if(expression.test(line.text)){closingFrom=at;break;}if(!line.eol)break;at=line.end+line.eol.length;}
  let contentTo=closingFrom??to;
  if(closingFrom!==null&&closingFrom>contentFrom)contentTo=closingFrom-(raw.slice(closingFrom-2,closingFrom)==='\r\n'?2:1);
  const leading=opening[3].match(/^[ \t]*/)[0].length,language=/[^ \t]+/.exec(opening[3]);
  const languageFrom=from+opening[1].length+size+leading,languageTo=languageFrom+(language?.[0].length||0);
  return {from,to,contentFrom,contentTo,fenced:true,char,size,closingFrom,languageFrom,languageTo,language:language?.[0]||''};
}
export function patchCode(raw,info,from,to,insert){
  from=Math.max(info.contentFrom,from);to=Math.min(info.contentTo,to);
  const old=raw.slice(info.from,info.to),body=raw.slice(info.contentFrom,from)+insert+raw.slice(to,info.contentTo);
  let open=raw.slice(info.from,info.contentFrom),close=raw.slice(info.contentTo,info.to);
  if(info.fenced){
    let width=info.size;
    for(const line of body.split(/\r\n|\r|\n/)){const run=line.match(info.char==='`'?/^ {0,3}(`{3,})[ \t]*$/:/^ {0,3}(~{3,})[ \t]*$/);if(run)width=Math.max(width,run[1].length+1);}
    if(width>info.size){open=open.replace(info.char.repeat(info.size),info.char.repeat(width));if(info.closingFrom!==null)close=close.replace(new RegExp(info.char+'{'+info.size+',}'),info.char.repeat(width));}
    if(body&&!/[\r\n]$/.test(open))open+=preferredEol(raw);
    if(info.closingFrom===info.contentFrom&&body)close=preferredEol(raw)+close;
  }
  const change=difference(old,open+body+close),caret=info.from+open.length+(from-info.contentFrom)+insert.length;
  return {from:info.from+change.from,to:info.from+change.to,insert:change.insert,selection:{from:caret,to:caret}};
}
export function codeFence(body,language=''){
  const width=Math.max(3,...Array.from(body.matchAll(/`+/g),m=>m[0].length+1));
  return '`'.repeat(width)+language+'\n'+body+'\n'+'`'.repeat(width);
}
