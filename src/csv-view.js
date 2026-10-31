const index=value=>Number.isSafeInteger(Number(value))&&Number(value)>=0&&Number(value)<100000000?Number(value):null;
const size=(value,min,max,fallback)=>Number.isFinite(Number(value))?Math.min(max,Math.max(min,Math.round(Number(value)))):fallback;
// The document-wide default follows the viewport. Existing row/column/cell
// overrides without a vertical value keep their historical top alignment.
const align=(value,fallback='top')=>{const v=value&&typeof value==='object'?value:{};return {horizontal:['left','center','right'].includes(v.horizontal)?v.horizontal:'left',vertical:['top','middle','bottom','viewport'].includes(v.vertical)?v.vertical:fallback};};
const map=(value,convert,keyValid=k=>index(k)!==null)=>{const out={};if(value&&typeof value==='object'&&!Array.isArray(value))for(const [key,v] of Object.entries(value).slice(0,200000))if(keyValid(key))out[key]=convert(v);return out;};
export function normalizeCsvView(value={}){
  const v=value&&typeof value==='object'?value:{};
  return {version:1,columnLabel:v.columnLabel==='numbers'?'numbers':'letters',wrap:v.wrap!==false,enterDirection:['down','up','left','right','none'].includes(v.enterDirection)?v.enterDirection:'down',stripedRows:v.stripedRows===true,defaultColumnWidth:size(v.defaultColumnWidth,40,4000,180),defaultRowHeight:size(v.defaultRowHeight,0,5000,0),freezeRows:size(v.freezeRows,0,100,0),freezeColumns:size(v.freezeColumns,0,50,0),hiddenRows:Array.from(new Set((Array.isArray(v.hiddenRows)?v.hiddenRows:[]).map(index).filter(x=>x!==null))).sort((a,b)=>a-b),hiddenColumns:Array.from(new Set((Array.isArray(v.hiddenColumns)?v.hiddenColumns:[]).map(index).filter(x=>x!==null))).sort((a,b)=>a-b),rowHeights:map(v.rowHeights,x=>size(x,20,5000,32)),columnWidths:map(v.columnWidths,x=>size(x,40,4000,180)),alignment:align(v.alignment,'viewport'),rowAlignment:map(v.rowAlignment,align),columnAlignment:map(v.columnAlignment,align),cellAlignment:map(v.cellAlignment,align,k=>/^\d+:\d+$/.test(k)&&k.split(':').every(x=>index(x)!==null))};
}
export function csvColumnLabel(column,style='letters'){
  if(!Number.isSafeInteger(column)||column<0)return '';
  if(style==='numbers')return String(column+1);
  let n=column+1,label='';while(n>0){n--;label=String.fromCharCode(65+n%26)+label;n=Math.floor(n/26);}return label;
}
export function csvCellAlignment(view,row,column){return view.cellAlignment[`${row}:${column}`]||view.rowAlignment[row]||view.columnAlignment[column]||view.alignment;}
export function deleteDelimitedSelection(raw,parsed,kind,indices){
  const selected=new Set(indices.filter(x=>Number.isInteger(x)&&x>=0));if(!selected.size)return raw;
  const changes=[];
  if(kind==='row'){for(let row=0;row<parsed.rowCount;row++)if(selected.has(row))changes.push({from:parsed.rowRanges[row].from,to:parsed.rowRanges[row+1]?.from??raw.length,insert:''});}
  else if(kind==='column'){
    if(Array.from({length:parsed.columnCount},(_,i)=>i).every(i=>selected.has(i)))return raw.startsWith('\ufeff')?'\ufeff':'';
    for(let row=0;row<parsed.rowCount;row++)if(parsed.rows[row].some((_,column)=>selected.has(column))){const tokens=parsed.cellRanges[row].filter((_,column)=>!selected.has(column)).map(range=>raw.slice(range.from,range.to));changes.push({...parsed.rowRanges[row],insert:tokens.join(parsed.delimiter)});}
  }
  let result=raw;for(const change of changes.sort((a,b)=>b.from-a.from))result=result.slice(0,change.from)+change.insert+result.slice(change.to);return result;
}
