import {encodeDelimitedCell} from './csv-parser.js';

// A rectangular range is required: filling the gaps in a sparse selection
// would silently copy or overwrite cells the user did not select.
export function csvSelectionBounds(selection, rows, columns) {
  if (!selection?.entries?.size || !rows || !columns) return null;
  if (selection.kind === 'all') return {top:0, left:0, bottom:rows-1, right:columns-1};
  let top=rows,bottom=-1,left=columns,right=-1,count=0;
  for(const item of selection.entries){
    const [r,c]=selection.kind==='cell'?String(item).split(':').map(Number):selection.kind==='row'?[Number(item),0]:[0,Number(item)];
    if(!Number.isInteger(r)||!Number.isInteger(c)||r<0||c<0||r>=rows||c>=columns)return null;
    top=Math.min(top,r);bottom=Math.max(bottom,r);left=Math.min(left,c);right=Math.max(right,c);count++;
  }
  if(selection.kind==='column'){top=0;bottom=rows-1;}
  if(selection.kind==='row'){left=0;right=columns-1;}
  const expected=selection.kind==='row'?bottom-top+1:selection.kind==='column'?right-left+1:(bottom-top+1)*(right-left+1);
  if (count!==expected) throw new Error('離れた範囲は一度にコピー・貼り付けできません。連続した範囲を選択してください。');
  return {top,left,bottom,right};
}

export function csvCopyText(parsed, bounds) {
  const result=[];
  for(let row=bounds.top;row<=bounds.bottom;row++) {
    const cells=[];
    for(let col=bounds.left;col<=bounds.right;col++){
      const value=parsed.rows[row]?.[col]??'';
      // A trailing empty one-cell row otherwise looks like an extra record
      // terminator and would disappear when pasted into another grid.
      cells.push(encodeDelimitedCell(value,'\t',bounds.left===bounds.right&&value===''));
    }
    result.push(cells.join('\t'));
  }
  return result.join('\r\n');
}

// Excel-style TSV: quotes are special only at a field's beginning and only
// when followed by a separator. Otherwise ordinary pasted quotes are literal.
export function parseClipboardGrid(text) {
  if(typeof text!=='string') throw new TypeError('クリップボードの内容を読み取れません。');
  // An ordinary single-line string in quotation marks is usually prose from
  // a text editor, not TSV; preserve the quotes unless escaping is present.
  if(!/[\t\r\n]/.test(text)&&text.length>2&&text[0]==='"'&&text.at(-1)==='"'&&!text.slice(1,-1).includes('""'))return [[text]];
  const rows=[];let row=[],value='',i=0;
  while(i<text.length) {
    if(value==='' && text[i]==='"') {
      let candidate='',j=i+1,closed=false;
      while(j<text.length){if(text[j]==='"'){if(text[j+1]==='"'){candidate+='"';j+=2;continue;}if(j+1===text.length||/[\t\r\n]/.test(text[j+1])){closed=true;j++;break;}}candidate+=text[j++];}
      if(closed){value=candidate;i=j;continue;}
    }
    const c=text[i++];
    if(c==='\t'){row.push(value);value='';continue;}
    if(c==='\r'||c==='\n'){row.push(value);rows.push(row);row=[];value='';if(c==='\r'&&text[i]==='\n')i++;continue;}
    value+=c;
  }
  if(row.length||value||!rows.length||!/[\r\n]$/.test(text)){row.push(value);rows.push(row);}
  return rows;
}

function rowSeparator(raw, ranges){
  // Ignore line breaks inside quoted cells. Only use separators between rows
  // or the final record terminator; a one-row document may contain both.
  for(let i=0;i<ranges.length;i++){
    const after=ranges[i].to,limit=i+1<ranges.length?ranges[i+1].from:raw.length;
    const match=raw.slice(after,limit).match(/^(\r\n|\r|\n)/);if(match)return match[0];
  }
  return '\r\n';
}

export function pasteCsvGrid(raw, parsed, bounds, matrix) {
  if(!matrix.length || !matrix[0]) return raw;
  const height=matrix.length,width=matrix.reduce((max,row)=>Math.max(max,row.length),0);
  if(!width) return raw;
  const selectedHeight=bounds.bottom-bounds.top+1,selectedWidth=bounds.right-bounds.left+1;
  const fillSingle=height===1&&width===1;
  const outHeight=fillSingle?selectedHeight:height,outWidth=fillSingle?selectedWidth:width;
  const delimiter=parsed.delimiter,edits=[];
  for(let r=0;r<outHeight && bounds.top+r<parsed.rowCount;r++){
    const index=bounds.top+r,values=parsed.rows[index],ranges=parsed.cellRanges[index],rowRange=parsed.rowRanges[index];
    let line=raw.slice(rowRange.from,rowRange.to),after='',nextColumn=values.length;
    const replace=[];
    for(let c=0;c<outWidth;c++){
      const col=bounds.left+c,value=String((fillSingle?matrix[0][0]:matrix[r]?.[c])??'');
      if(col<values.length){const range=ranges[col];const protectLeadingBom=index===0&&col===0&&value.startsWith('\ufeff');replace.push({from:range.from-rowRange.from,to:range.to-rowRange.from,insert:encodeDelimitedCell(value,delimiter,range.quoted||protectLeadingBom)});}
      else {while(nextColumn<col){after+=delimiter;nextColumn++;}after+=delimiter+encodeDelimitedCell(value,delimiter);nextColumn++;}
    }
    for(const e of replace.reverse())line=line.slice(0,e.from)+e.insert+line.slice(e.to);
    // A final record with one empty field and no line ending needs an
    // explicit quoted token; otherwise it becomes merely a trailing newline.
    const updated=line+after;
    edits.push({from:rowRange.from,to:rowRange.to,insert:updated===''&&rowRange.to===raw.length?'""':updated});
  }
  let result=raw;
  for(const e of edits.reverse())result=result.slice(0,e.from)+e.insert+result.slice(e.to);
  const last=bounds.top+outHeight;
  if(last>parsed.rowCount){
    const eol=rowSeparator(raw,parsed.rowRanges),trailing=/[\r\n]$/.test(raw),extra=[];
    for(let index=parsed.rowCount;index<last;index++){
      const cells=Array(bounds.left).fill('');const r=index-bounds.top;
      for(let c=0;c<outWidth;c++){
        const value=String((fillSingle?matrix[0][0]:matrix[r]?.[c])??'');
        cells.push(encodeDelimitedCell(value,delimiter,bounds.left===0&&outWidth===1&&value===''));
      }
      extra.push(cells.join(delimiter));
    }
    result+=(result&&!trailing?eol:'')+extra.join(eol)+(trailing?eol:'');
  }
  return result;
}

export function csvChangedRange(before,after){
  let from=0;while(from<before.length&&from<after.length&&before[from]===after[from])from++;
  let oldEnd=before.length,newEnd=after.length;while(oldEnd>from&&newEnd>from&&before[oldEnd-1]===after[newEnd-1]){oldEnd--;newEnd--;}
  return {from,to:oldEnd,insert:after.slice(from,newEnd)};
}
