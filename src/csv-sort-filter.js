// Reorder complete records while retaining the original field spelling and the
// separator assigned to each output position (including mixed line endings).
export function sortDelimitedRows(raw, parsed, column, {header=true, descending=false}={}) {
  if (!Number.isInteger(column) || column < 0 || column >= parsed.columnCount) throw new Error('並べ替える列を選択してください。');
  const start = header ? 1 : 0;
  const rows = parsed.rows.map((values, index) => ({values,index}));
  const collator = new Intl.Collator('ja', {numeric:true, sensitivity:'base'});
  const sorted=rows.slice(start).sort((a,b)=>{
    const comparison=collator.compare(a.values[column]??'',b.values[column]??'');
    return (descending ? -comparison : comparison) || a.index-b.index;
  });
  const order=[...rows.slice(0,start),...sorted];
  let output=raw.slice(0,parsed.rowRanges[0]?.from??raw.length);
  for(let i=0;i<order.length;i++){
    const src=parsed.rowRanges[order[i].index], position=parsed.rowRanges[i];
    let row=raw.slice(src.from,src.to);
    // A leading U+FEFF in the first data cell must be quoted; otherwise it
    // becomes indistinguishable from the document BOM on the next parse.
    if(i===0&&row.startsWith('\ufeff')){const first=parsed.cellRanges[order[i].index][0];row='"'+raw.slice(first.from,first.to).replaceAll('"','""')+'"'+raw.slice(first.to,src.to);}
    // A final unquoted empty record without a terminator would disappear on
    // reparse. Quote it explicitly without adding a line ending.
    if(i===order.length-1&&row===''&&position.to===raw.length)row='""';
    output+=row+raw.slice(position.to,parsed.rowRanges[i+1]?.from??raw.length);
  }
  return output;
}
export function filteredCsvRows(parsed, filter, header=true) {
  const hidden=new Set();
  if(!filter || !Number.isInteger(filter.column) || filter.column < 0 || filter.column >= parsed.columnCount || !filter.text) return hidden;
  const query=filter.text.toLocaleLowerCase('ja');
  for(let row=header?1:0;row<parsed.rowCount;row++) if(!(parsed.rows[row][filter.column]??'').toLocaleLowerCase('ja').includes(query)) hidden.add(row);
  return hidden;
}
// Move contiguous columns as a unit. Short rows are padded only up to the
// furthest column involved so that cells do not silently change meaning.
export function moveDelimitedColumns(raw,parsed,indices,direction){
  const cols=[...new Set(indices)].sort((a,b)=>a-b);
  if(!cols.length || cols.some((n,i)=>!Number.isInteger(n)||n<0||n>=parsed.columnCount||(i&&n!==cols[i-1]+1)))throw new Error('連続する列を選択してください。');
  const first=cols[0],last=cols.at(-1),left=direction==='left';
  if((left&&first===0)||(!left&&last===parsed.columnCount-1))throw new Error('これ以上移動できません。');
  const boundary=left?last:first, edge=left?first-1:last+1, highest=Math.max(boundary,edge);
  let out=raw.slice(0,parsed.rowRanges[0]?.from??raw.length);
  for(let i=0;i<parsed.rowCount;i++){
    const ranges=parsed.cellRanges[i], tokens=ranges.map(r=>raw.slice(r.from,r.to));
    while(tokens.length<=highest)tokens.push('');
    if(left){const [adjacent]=tokens.splice(first-1,1);tokens.splice(last,0,adjacent);}
    else {const [adjacent]=tokens.splice(last+1,1);tokens.splice(first,0,adjacent);}
    if(i===0&&tokens[0]?.startsWith('\ufeff'))tokens[0]='"'+tokens[0].replaceAll('"','""')+'"';
    const pos=parsed.rowRanges[i];out+=tokens.join(parsed.delimiter)+raw.slice(pos.to,parsed.rowRanges[i+1]?.from??raw.length);
  }
  return out;
}
