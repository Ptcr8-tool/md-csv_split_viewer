import {currentUiLanguage} from './i18n.js';
const tr=(ja,en)=>currentUiLanguage()==='en'?en:ja;
export const PREVIEW_LIMITS=Object.freeze({maxSourceLength:1024*1024,maxRows:1000,maxColumns:100,maxCells:20000,maxCellLength:32768});
export class DelimitedPreviewError extends Error{
  constructor(message,code){super(message);this.name='DelimitedPreviewError';this.code=code;}
}
const limited=(value,fallback)=>typeof value==='number'&&Number.isFinite(value)?Math.max(1,Math.min(fallback,Math.floor(value))):fallback;
const limitFailure=(name,amount)=>new DelimitedPreviewError(currentUiLanguage()==='en'?`The table exceeds ${amount.toLocaleString()} ${{'文字':'characters','文字（1セル）':'characters per cell','列':'columns','セル':'cells','行':'rows','セル（空欄を含む表示領域）':'displayed cells'}[name]||'items'}. Confirmation is required to display it. You can continue editing the source.`:`${amount.toLocaleString('ja-JP')}${name}を超えるため、表の表示には確認が必要です。原文の編集は続けられます。`,'limit');
export function parseDelimited(raw,options={}){
  if(typeof raw!=='string')throw new TypeError(tr('表の原文は文字列で指定してください。','Table source must be a string.'));
  const limits=Object.fromEntries(Object.entries(PREVIEW_LIMITS).map(([key,value])=>[key,options.unlimited===true?Infinity:limited(options[key],value)]));
  const delimiter=options.delimiter??',';
  if(![',','\t',';'].includes(delimiter))throw new DelimitedPreviewError(tr('区切り文字はカンマ・Tab・セミコロンから選んでください。','Choose comma, Tab, or semicolon as the delimiter.'),'delimiter');
  if(raw.length>limits.maxSourceLength)throw limitFailure('文字',limits.maxSourceLength);
  const rows=[],rowRanges=[],cellRanges=[];let row=[],ranges=[],field='',quoted=false,fieldQuoted=false,closed=false,ended=true,cells=0,rowStart=raw.charCodeAt(0)===0xfeff?1:0,cellStart=rowStart;
  const append=character=>{if(field.length+character.length>limits.maxCellLength)throw limitFailure('文字（1セル）',limits.maxCellLength);field+=character;};
  const finishField=to=>{if(row.length>=limits.maxColumns)throw limitFailure('列',limits.maxColumns);if(cells>=limits.maxCells)throw limitFailure('セル',limits.maxCells);row.push(field);ranges.push({from:cellStart,to,quoted:fieldQuoted});cells++;field='';closed=false;fieldQuoted=false;};
  const finishRow=to=>{if(rows.length>=limits.maxRows)throw limitFailure('行',limits.maxRows);rows.push(row);cellRanges.push(ranges);rowRanges.push({from:rowStart,to});row=[];ranges=[];};
  const quoteFailure=message=>new DelimitedPreviewError(currentUiLanguage()==='en'?`Invalid quotes on row ${rows.length+1}. ${message} The source has not been changed.`:`${rows.length+1}行目の引用符が正しくありません。${message} 原文は変更していません。`,'quotes');
  for(let i=rowStart;i<raw.length;i++){
    const character=raw[i];ended=false;
    if(quoted){
      if(character==='"'){
        if(raw[i+1]==='"'){append('"');i++;}else{quoted=false;closed=true;}
      }else append(character);
      continue;
    }
    if(character===delimiter){finishField(i);cellStart=i+1;continue;}
    if(character==='\r'||character==='\n'){
      finishField(i);finishRow(i);if(character==='\r'&&raw[i+1]==='\n')i++;
      rowStart=i+1;cellStart=rowStart;ended=true;continue;
    }
    if(closed)throw quoteFailure(tr('閉じた引用符の後には区切り文字か改行が必要です。','A delimiter or line break is required after a closing quote.'));
    if(character==='"'){
      if(field.length)throw quoteFailure(tr('引用符はセルの先頭に置いてください。','The quote must be at the start of the cell.'));
      quoted=true;fieldQuoted=true;
    }else append(character);
  }
  if(quoted)throw quoteFailure(tr('閉じる引用符がありません。','The closing quote is missing.'));
  if(!ended){finishField(raw.length);finishRow(raw.length);}
  const columnCount=rows.reduce((max,entry)=>Math.max(max,entry.length),0);
  if(rows.length*columnCount>limits.maxCells)throw limitFailure('セル（空欄を含む表示領域）',limits.maxCells);
  return {rows,rowRanges,cellRanges,rowCount:rows.length,columnCount,delimiter,truncated:false};
}
export function encodeDelimitedCell(value,delimiter=',',quoted=false){
  if(typeof value!=='string')throw new TypeError(tr('セルの値は文字列で指定してください。','The cell value must be a string.'));
  if(![',','\t',';'].includes(delimiter))throw new DelimitedPreviewError(tr('区切り文字が正しくありません。','The delimiter is invalid.'),'delimiter');
  return quoted||value.includes(delimiter)||/["\r\n]/.test(value)?'"'+value.replaceAll('"','""')+'"':value;
}
