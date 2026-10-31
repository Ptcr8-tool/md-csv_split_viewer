import {encodeDelimitedCell} from './csv-parser.js';

// Limit normalization to the characters explicitly named by the user; a
// general NFKC pass would silently change unrelated symbols and numerals.
const halfKana=/[\uff61-\uff9f]+/g;
const fullKanaToHalf=new Map();
for(let n=0xff61;n<=0xff9f;n++){
  const half=String.fromCodePoint(n),full=half.normalize('NFKC');
  if(!fullKanaToHalf.has(full))fullKanaToHalf.set(full,half);
  for(const mark of ['\uff9e','\uff9f']){
    const pair=half+mark,wide=pair.normalize('NFKC');
    if([...wide].length===1&&!fullKanaToHalf.has(wide))fullKanaToHalf.set(wide,pair);
  }
}
const toHalfKana=value=>Array.from(value,char=>fullKanaToHalf.get(char)??char).join('');
const toHiragana=value=>Array.from(value,char=>{const n=char.codePointAt(0);return n>=0x30a1&&n<=0x30f6?String.fromCodePoint(n-0x60):char;}).join('');
const toKatakana=value=>Array.from(value,char=>{const n=char.codePointAt(0);return n>=0x3041&&n<=0x3096?String.fromCodePoint(n+0x60):char;}).join('');

export function convertCsvText(value,operation){
  const text=String(value);
  switch(operation){
    case 'half': return toHalfKana(Array.from(text,char=>{const n=char.codePointAt(0);return n===0x3000?' ':n>=0xff01&&n<=0xff5e?String.fromCodePoint(n-0xfee0):char;}).join(''));
    case 'full': return text.replace(halfKana,match=>match.normalize('NFKC')).replace(/[\x20-\x7e]/g,char=>char===' '?'\u3000':String.fromCodePoint(char.codePointAt(0)+0xfee0));
    case 'kana-to-hiragana': return text.replace(halfKana,match=>toHiragana(match.normalize('NFKC')));
    case 'hiragana-to-kana': return text.replace(/[\u3041-\u3096]+/g,match=>toHalfKana(toKatakana(match)));
    case 'upper': return text.toUpperCase();
    case 'lower': return text.toLowerCase();
    default: throw new Error('未対応の文字変換です。');
  }
}

export function transposeCsvClipboard(matrix){
  const width=matrix[0]?.length||0;
  if(!width||matrix.some(row=>row.length!==width))throw new Error('行ごとに列数が異なる内容は縦横変換できません。');
  return Array.from({length:width},(_,col)=>matrix.map(row=>row[col]));
}

export function convertCsvRange(raw,parsed,bounds,operation){
  const edits=[];
  for(let row=bounds.top;row<=bounds.bottom;row++){
    const values=parsed.rows[row]||[],ranges=parsed.cellRanges[row]||[];
    for(let col=bounds.left;col<=bounds.right&&col<values.length;col++){
      const value=convertCsvText(values[col],operation),range=ranges[col];
      if(value!==values[col])edits.push({from:range.from,to:range.to,insert:encodeDelimitedCell(value,parsed.delimiter,range.quoted||(row===0&&col===0&&value.startsWith('\ufeff')))});
    }
  }
  let result=raw;
  for(let i=edits.length-1;i>=0;i--){const edit=edits[i];result=result.slice(0,edit.from)+edit.insert+result.slice(edit.to);}
  return result;
}
