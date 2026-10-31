// Browser-only fallback: Windows uses native/SearchEngine.cs and .NET Regex.
// Shared compatibility vectors cover common syntax; engine-specific constructs
// and Unicode regex classifications may differ between JavaScript and .NET.
export const regexSamples=[
  {label:'数字',pattern:'\\d+',replacement:'',description:'連続する半角数字'},
  {label:'空行',pattern:'^[ \\t]*\\r?\\n',replacement:'',description:'空行を削除'},
  {label:'行末の空白',pattern:'[ \\t]+(?=\\r?$)',replacement:'',description:'行末の半角スペース・Tab'},
  {label:'Tabをスペースに',pattern:'\\t',replacement:'    ',description:'Tab 1個を半角スペース4個に'},
  {label:'全角スペース',pattern:'　',replacement:' ',description:'全角スペースを半角へ'},
  {label:'行頭に追加',pattern:'^',replacement:'> ',description:'各行の先頭に引用記号を追加'},
  {label:'見出し',pattern:'^#{1,6}[ \\t]+(.+)',replacement:'$1',description:'見出しの文字をグループ1で取得'},
  {label:'グループの入れ替え',pattern:'(\\w+)=(\\w+)',replacement:'$2:$1',description:'name=value を value:name へ'},
  {label:'改行',pattern:'\\r?\\n',replacement:'\\n',description:'改行コードをLFへ統一'},
  {label:'URL',pattern:'https?://[^\\s<>]+',replacement:'',description:'HTTP・HTTPSのURL'}
];
export function replacementEscapes(text){return text.replace(/\\(r|n|t|\\|[1-9][0-9]?)/g,(_,c)=>({r:'\r',n:'\n',t:'\t','\\':'\\'}[c]??'$'+c));}
function expand(template,m){
  const tokens=/\$(\$|&|[0-9]{1,2}|\{[\w]+\})/g;let result=[],at=0,length=0;
  for(const token of template.matchAll(tokens)){const key=token[1],value=key==='$'?'$':key==='&'?m[0]:key.startsWith('{')?(m.groups?.[key.slice(1,-1)]??''):(m[Number(key)]??token[0]);length+=token.index-at+value.length;if(length>64*1024*1024)throw new Error('置換後の文章が64MBを超えます。');result.push(template.slice(at,token.index),value);at=token.index+token[0].length;}
  result.push(template.slice(at));return result.join('');
}
export function runSearch(request){
  const {text='',pattern='',replacement='',regex=false,ignoreCase=false,action='find',direction=1,from=0,to=from}=request;
  if(text.length>64*1024*1024||pattern.length>4096||replacement.length>65536)throw new Error('検索対象または式が大きすぎます。');
  if(!pattern)return {count:0};
  const expression=new RegExp(regex?pattern:pattern.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gm'+(ignoreCase?'i':'')),matches=[];let m;
  while((m=expression.exec(text))){matches.push(m);if(matches.length>100000)throw new Error('一致が10万件を超えました。検索条件を絞ってください。');if(!m[0].length)expression.lastIndex=m.index+(text.codePointAt(m.index)>65535?2:1);}
  if(!matches.length)return {count:0};
  const chosen=action==='replace'?matches.find(m=>m.index===from&&m.index+m[0].length===to):direction<0?matches.findLast(m=>m.index<from)||matches.at(-1):matches.find(m=>m.index>=from)||matches[0];
  if(action==='find'||action==='replace'&&!chosen){const next=matches.find(m=>m.index>=from)||matches[0];const hit=chosen||next;return {count:matches.length,from:hit.index,to:hit.index+hit[0].length};}
  let at=0,output=[],length=0,last=0,selection=0;const template=regex?replacementEscapes(replacement):replacement;
  for(const hit of action==='all'?matches:[chosen]){const value=regex?expand(template,hit):template;length+=hit.index-at+value.length;if(length>64*1024*1024)throw new Error('置換後の文章が64MBを超えます。');output.push(text.slice(at,hit.index),value);at=hit.index+hit[0].length;last=length;selection=length-value.length;}
  length+=text.length-at;if(length>64*1024*1024)throw new Error('置換後の文章が64MBを超えます。');output.push(text.slice(at));return {count:action==='all'?matches.length:1,text:output.join(''),from:selection,to:last};
}
