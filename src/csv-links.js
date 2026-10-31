// Offsets use the original CSV string, including quoted newlines and CRLF.
export function csvRowAtPosition(ranges, position) {
  if (!ranges?.length) return -1;
  position=Number.isFinite(position)?Math.max(0,position):0;
  let low=0,high=ranges.length;
  while(low<high){const middle=(low+high)>>>1;if(ranges[middle].from<=position)low=middle+1;else high=middle;}
  return Math.max(0,low-1);
}

export function visibleCsvRow(index, rowCount, hidden) {
  if(rowCount<1)return -1;
  index=Math.max(0,Math.min(rowCount-1,index));
  if(!hidden.has(index))return index;
  for(let next=index+1;next<rowCount;next++)if(!hidden.has(next))return next;
  for(let previous=index-1;previous>=0;previous--)if(!hidden.has(previous))return previous;
  return -1;
}
