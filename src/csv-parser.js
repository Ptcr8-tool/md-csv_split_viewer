export const PREVIEW_LIMITS=Object.freeze({maxSourceLength:1024*1024,maxRows:1000,maxColumns:100,maxCells:20000,maxCellLength:32768});
export class DelimitedPreviewError extends Error{
  constructor(message,code){super(message);this.name='DelimitedPreviewError';this.code=code;}
}
const limited=(value,fallback)=>typeof value==='number'&&Number.isFinite(value)?Math.max(1,Math.min(fallback,Math.floor(value))):fallback;
const limitFailure=(name,amount)=>new DelimitedPreviewError(`${amount.toLocaleString('ja-JP')}${name}を超えるため、表の表示には確認が必要です。原文の編集は続けられます。`,'limit');
export function parseDelimited(raw,options={}){
  if(typeof raw!=='string')throw new TypeError('表の原文は文字列で指定してください。');
  const limits=Object.fromEntries(Object.entries(PREVIEW_LIMITS).map(([key,value])=>[key,options.unlimited===true?Infinity:limited(options[key],value)]));
  const delimiter=options.delimiter??',';
  if(![',','\t',';'].includes(delimiter))throw new DelimitedPreviewError('区切り文字はカンマ・Tab・セミコロンから選んでください。','delimiter');
  if(raw.length>limits.maxSourceLength)throw limitFailure('文字',limits.maxSourceLength);
  const rows=[],rowRanges=[],cellRanges=[];let row=[],ranges=[],field='',quoted=false,fieldQuoted=false,closed=false,ended=true,cells=0,rowStart=raw.charCodeAt(0)===0xfeff?1:0,cellStart=rowStart;
  const append=character=>{if(field.length+character.length>limits.maxCellLength)throw limitFailure('文字（1セル）',limits.maxCellLength);field+=character;};
  const finishField=to=>{if(row.length>=limits.maxColumns)throw limitFailure('列',limits.maxColumns);if(cells>=limits.maxCells)throw limitFailure('セル',limits.maxCells);row.push(field);ranges.push({from:cellStart,to,quoted:fieldQuoted});cells++;field='';closed=false;fieldQuoted=false;};
  const finishRow=to=>{if(rows.length>=limits.maxRows)throw limitFailure('行',limits.maxRows);rows.push(row);cellRanges.push(ranges);rowRanges.push({from:rowStart,to});row=[];ranges=[];};
  const quoteFailure=message=>new DelimitedPreviewError(`${rows.length+1}行目の引用符が正しくありません。${message} 原文は変更していません。`,'quotes');
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
    if(closed)throw quoteFailure('閉じた引用符の後には区切り文字か改行が必要です。');
    if(character==='"'){
      if(field.length)throw quoteFailure('引用符はセルの先頭に置いてください。');
      quoted=true;fieldQuoted=true;
    }else append(character);
  }
  if(quoted)throw quoteFailure('閉じる引用符がありません。');
  if(!ended){finishField(raw.length);finishRow(raw.length);}
  const columnCount=rows.reduce((max,entry)=>Math.max(max,entry.length),0);
  if(rows.length*columnCount>limits.maxCells)throw limitFailure('セル（空欄を含む表示領域）',limits.maxCells);
  return {rows,rowRanges,cellRanges,rowCount:rows.length,columnCount,delimiter,truncated:false};
}
export function encodeDelimitedCell(value,delimiter=',',quoted=false){
  if(typeof value!=='string')throw new TypeError('セルの値は文字列で指定してください。');
  if(![',','\t',';'].includes(delimiter))throw new DelimitedPreviewError('区切り文字が正しくありません。','delimiter');
  return quoted||value.includes(delimiter)||/["\r\n]/.test(value)?'"'+value.replaceAll('"','""')+'"':value;
}
