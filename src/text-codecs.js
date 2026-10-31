export const MAX_BROWSER_FILE_BYTES=64*1024*1024;
export const encodingChoices=Object.freeze([
  {id:'utf8',label:'UTF-8'},{id:'utf8bom',label:'UTF-8（BOM付き）'},
  {id:'utf16le',label:'UTF-16 LE'},{id:'utf16be',label:'UTF-16 BE'},{id:'utf32le',label:'UTF-32 LE'},{id:'utf32be',label:'UTF-32 BE'},
  {id:'shiftjis',label:'Shift JIS（Windows-31J / CP932）'},{id:'eucjp',label:'EUC-JP'},{id:'iso2022jp',label:'ISO-2022-JP'},
  {id:'windows1252',label:'Windows-1252'},{id:'gb18030',label:'GB18030'},{id:'big5',label:'Big5'},{id:'korean949',label:'韓国語（Windows-949）'}
].map(choice=>Object.freeze(choice)));
const ids=new Set(encodingChoices.map(choice=>choice.id));
const decoderLabels={utf8:'utf-8',utf8bom:'utf-8',utf16le:'utf-16le',utf16be:'utf-16be',shiftjis:'shift_jis',eucjp:'euc-jp',iso2022jp:'iso-2022-jp',windows1252:'windows-1252',gb18030:'gb18030',big5:'big5',korean949:'euc-kr'};
const isUtf8=id=>id==='utf8'||id==='utf8bom';
export const defaultBom=id=>id==='utf8bom'||/^utf(?:16|32)(?:le|be)$/.test(id);
function requireEncoding(value){if(!ids.has(value))throw new Error('この文字コードには対応していません。');return value;}
function bomAt(bytes){
  const starts=values=>values.every((value,index)=>bytes[index]===value);
  if(starts([0xff,0xfe,0,0]))return {encoding:'utf32le',length:4};
  if(starts([0,0,0xfe,0xff]))return {encoding:'utf32be',length:4};
  if(starts([0xef,0xbb,0xbf]))return {encoding:'utf8bom',length:3};
  if(starts([0xff,0xfe]))return {encoding:'utf16le',length:2};
  if(starts([0xfe,0xff]))return {encoding:'utf16be',length:2};
  return null;
}
function decodeUtf32(bytes,littleEndian){
  if(bytes.byteLength%4)throw new Error('UTF-32の文字データが途中で終わっています。');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),parts=[],chunk=[];
  for(let i=0;i<bytes.byteLength;i+=4){const point=view.getUint32(i,littleEndian);if(point>0x10ffff||point>=0xd800&&point<=0xdfff)throw new Error('UTF-32に不正なUnicode文字があります。');chunk.push(point);if(chunk.length===4096){parts.push(String.fromCodePoint(...chunk));chunk.length=0;}}
  if(chunk.length)parts.push(String.fromCodePoint(...chunk));return parts.join('');
}
function decode(bytes,encoding){
  if(encoding==='utf32le'||encoding==='utf32be')return decodeUtf32(bytes,encoding==='utf32le');
  if(encoding==='iso2022jp')validateIso2022Jp(bytes);
  try{return new TextDecoder(decoderLabels[encoding],{fatal:true,ignoreBOM:true}).decode(bytes);}
  catch{throw new Error('選択した文字コードで正しく読み込めません。別の文字コードを指定してください。');}
}
// Keep automatic detection and scoring consistent with native/TextCodec.cs.
// Both paths consume the byte vectors in tests/fixtures/codec-detection.json.
function binaryText(text){
  if(text.includes('\0'))return true;
  let controls=0;
  for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);if(c>=1&&c<=8||c===11||c>=14&&c<=31||c>=127&&c<=159)controls++;}
  return controls>0&&controls>text.length*0.1;
}
function positiveUnicodeText(text){
  if(!text.length)return false;let total=0,positive=0;
  for(const rune of text){total++;if(/[\p{L}\p{Nd}\p{White_Space}\p{Pc}\p{Pd}\p{Ps}\p{Pe}\p{Pi}\p{Pf}\p{Po}\p{Sm}\p{Sc}\p{So}\p{Mn}\p{Mc}]/u.test(rune))positive++;}
  return positive>=total*0.9;
}
function bomlessUnicode(bytes){
  if(bytes.length<2||!bytes.includes(0))return null;
  for(const [encoding,width,highFirst] of [['utf32le',4,false],['utf32be',4,true],['utf16le',2,false],['utf16be',2,true]]){
    if(bytes.length%width)continue;const units=bytes.length/width;let matching=0,opposite=0;
    for(let i=0;i<bytes.length;i+=width){
      if(width===4){if(highFirst?bytes[i]===0&&bytes[i+1]===0:bytes[i+2]===0&&bytes[i+3]===0)matching++;if(highFirst?bytes[i+2]===0&&bytes[i+3]===0:bytes[i]===0&&bytes[i+1]===0)opposite++;}
      else{if(bytes[i+(highFirst?0:1)]===0)matching++;if(bytes[i+(highFirst?1:0)]===0)opposite++;}
    }
    if(matching<units*(width===4?0.75:0.25)||matching<=opposite*2)continue;
    try{const text=decode(bytes,encoding);if(!binaryText(text)&&positiveUnicodeText(text))return {text,encoding};}catch{}
  }
  return null;
}
function japaneseScore(text){
  const sample=text.slice(0,65536);let kana=0,ideographs=0,halfwidth=0,privateUse=0;
  for(let i=0;i<sample.length;i++){const code=sample.charCodeAt(i);if(code>=0x3040&&code<=0x30ff)kana++;else if(code>=0x3400&&code<=0x9fff)ideographs++;else if(code>=0xff61&&code<=0xff9f)halfwidth++;else if(code>=0xe000&&code<=0xf8ff)privateUse++;}
  if(!kana&&ideographs<2&&halfwidth<3)return 0;
  return Math.max(0,kana*4+ideographs*2+halfwidth*0.3-privateUse*5);
}
function iso2022Hint(bytes){
  for(let at=bytes.indexOf(0x1b);at>=0;at=bytes.indexOf(0x1b,at+1)){
    if(bytes[at+1]===0x24&&(bytes[at+2]===0x40||bytes[at+2]===0x42)||bytes[at+1]===0x28&&bytes[at+2]===0x49)return true;
  }
  return false;
}
function validateIso2022Jp(bytes){
  let mode=0;
  for(let i=0;i<bytes.length;i++){
    const b=bytes[i];if(b>=0x80)throw new Error('ISO-2022-JPに正しくないバイトがあります。');
    if(b===0x1b){if(i+2>=bytes.length)throw new Error('ISO-2022-JPのエスケープシーケンスが途中で終わっています。');const a=bytes[i+1],c=bytes[i+2];if(a===0x24&&(c===0x42||c===0x40))mode=1;else if(a===0x28&&(c===0x42||c===0x4a))mode=0;else if(a===0x28&&c===0x49)mode=2;else throw new Error('ISO-2022-JPのエスケープシーケンスが正しくありません。');i+=2;continue;}
    if([9,10,13,12].includes(b))continue;
    if(mode===1){if(b<0x21||b>0x7e||++i>=bytes.length||bytes[i]<0x21||bytes[i]>0x7e)throw new Error('ISO-2022-JPの文字が途中で終わっています。');}
    else if(mode===2&&(b<0x21||b>0x5f))throw new Error('ISO-2022-JPの半角カナが正しくありません。');
  }
}
const guessNotice=encoding=>`${encodingChoices.find(choice=>choice.id===encoding).label}として推測して読み込みました。文字が正しく見えない場合は、文字コードを指定して開き直してください。`;
function result(file,text,encoding,hasBom,guessed=false){return {name:file.name||'無題.txt',text,savedText:text,encoding,savedEncoding:encoding,hasBom,savedHasBom:hasBom,encodingGuessed:guessed,encodingNotice:guessed?guessNotice(encoding):''};}
export async function readBrowserFile(file,forceEncoding,options={}){
  if(!file||typeof file.arrayBuffer!=='function')throw new TypeError('読み込むファイルを指定してください。');
  const allowLarge=options?.allowLarge===true;
  if(!allowLarge&&file.size>MAX_BROWSER_FILE_BYTES)throw new Error('ブラウザー版で開けるファイルは64MBまでです。');
  const bytes=new Uint8Array(await file.arrayBuffer());if(!allowLarge&&bytes.byteLength>MAX_BROWSER_FILE_BYTES)throw new Error('ブラウザー版で開けるファイルは64MBまでです。');
  const forced=typeof forceEncoding==='string'?forceEncoding:forceEncoding?.encoding,bom=bomAt(bytes);
  if(forced){
    requireEncoding(forced);
    if(bom&&bom.encoding!==forced&&!(isUtf8(bom.encoding)&&isUtf8(forced)))throw new Error('ファイルのBOMと指定した文字コードが一致しません。BOMに合う文字コードを選んでください。');
    const encoding=isUtf8(forced)?bom?'utf8bom':'utf8':forced;
    return result(file,decode(bytes.subarray(bom?.length||0),encoding),encoding,!!bom);
  }
  if(bom){const text=decode(bytes.subarray(bom.length),bom.encoding);if(binaryText(text))throw new Error('バイナリ形式の可能性があるため開けません。必要な場合は文字コードを指定してください。');return result(file,text,bom.encoding,true);}
  const unicodeHint=bomlessUnicode(bytes);
  if(unicodeHint)return result(file,unicodeHint.text,unicodeHint.encoding,false,true);
  // Recognized ISO-2022-JP escapes are text syntax rather than binary controls.
  if(iso2022Hint(bytes)){
    try{const text=decode(bytes,'iso2022jp');if(!binaryText(text)&&/[\u3040-\u30ff\u3400-\u9fff\uff61-\uff9f]/.test(text))return result(file,text,'iso2022jp',false,true);}catch{}
  }
  let utf8;try{utf8=decode(bytes,'utf8');}catch{}
  if(utf8!==undefined){if(binaryText(utf8))throw new Error('バイナリ形式の可能性があるため開けません。必要な場合は文字コードを指定してください。');return result(file,utf8,'utf8',false);}
  const candidates=[];
  for(const encoding of ['shiftjis','eucjp']){try{const text=decode(bytes,encoding),score=japaneseScore(text);if(!binaryText(text)&&score>0)candidates.push({text,encoding,score});}catch{}}
  candidates.sort((a,b)=>b.score-a.score);if(candidates.length&&(candidates.length===1||candidates[0].score-candidates[1].score>=Math.max(1,candidates[0].score*0.2))){const candidate=candidates[0];return result(file,candidate.text,candidate.encoding,false,true);}
  try{const text=decode(bytes,'windows1252');if(!binaryText(text))return result(file,text,'windows1252',false,true);}catch{}
  throw new Error('文字コードを判定できませんでした。文字コードを指定して開いてください。');
}
function assertUnicode(text){
  for(let i=0;i<text.length;i++){const code=text.charCodeAt(i);if(code>=0xd800&&code<=0xdbff){const next=text.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))throw new Error('保存できないUnicode文字が含まれています。');}else if(code>=0xdc00&&code<=0xdfff)throw new Error('保存できないUnicode文字が含まれています。');}
}
export function encodeBrowserText(text,encoding='utf8',hasBom){
  requireEncoding(encoding);if(typeof text!=='string')throw new TypeError('保存する文章は文字列で指定してください。');assertUnicode(text);
  const bom=typeof hasBom==='boolean'?hasBom:defaultBom(encoding);
  if(isUtf8(encoding)){const data=new TextEncoder().encode(text);if(!bom)return data;const output=new Uint8Array(data.length+3);output.set([0xef,0xbb,0xbf]);output.set(data,3);return output;}
  if(encoding==='utf16le'||encoding==='utf16be'){
    const little=encoding==='utf16le',offset=bom?2:0,output=new Uint8Array(offset+text.length*2),view=new DataView(output.buffer);
    if(bom)output.set(little?[0xff,0xfe]:[0xfe,0xff]);for(let i=0;i<text.length;i++)view.setUint16(offset+i*2,text.charCodeAt(i),little);return output;
  }
  if(encoding==='utf32le'||encoding==='utf32be'){
    const little=encoding==='utf32le',offset=bom?4:0;let count=0;for(const character of text)count++;const output=new Uint8Array(offset+count*4),view=new DataView(output.buffer);if(bom)output.set(little?[0xff,0xfe,0,0]:[0,0,0xfe,0xff]);let index=offset;for(const character of text){view.setUint32(index,character.codePointAt(0),little);index+=4;}return output;
  }
  throw new Error('この文字コードでの保存はWindows版を使用してください。UTF-8へ変更する場合は、文字コードを明示的に選び直してください。');
}
