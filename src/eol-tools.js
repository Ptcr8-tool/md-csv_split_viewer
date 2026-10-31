const endings={CRLF:'\r\n',LF:'\n',CR:'\r',remove:''};

// Always recognize CRLF first. Counting CR and LF separately would split a pair.
export function countLineEndings(raw){
  const result={CRLF:0,LF:0,CR:0};
  for(const match of raw.matchAll(/\r\n|\r|\n/g))result[match[0]==='\r\n'?'CRLF':match[0]==='\r'?'CR':'LF']++;
  return result;
}

export function replaceLineEndings(raw,from,to,selection={from:0,to:0}){
  if(!['CRLF','LF','CR','all'].includes(from)||!(to in endings))throw new Error('改行コードを選択してください。');
  const replacement=endings[to];let position=0,delta=0,count=0;
  const points=[selection.from,selection.to].map(value=>Math.max(0,Math.min(raw.length,Number.isSafeInteger(value)?value:0)));
  const mapped=[null,null],parts=[];
  for(const match of raw.matchAll(/\r\n|\r|\n/g)){
    const start=match.index,end=start+match[0].length,type=match[0]==='\r\n'?'CRLF':match[0]==='\r'?'CR':'LF';
    if(from!=='all'&&from!==type)continue;
    for(let i=0;i<2;i++)if(mapped[i]===null&&points[i]<=end){
      // A cursor immediately after the old ending stays after the new one.
      // If an incoming offset is inside a CRLF, snap it to a valid boundary.
      mapped[i]=points[i]<=start?points[i]+delta:start+delta+replacement.length;
    }
    parts.push(raw.slice(position,start),replacement);position=end;delta+=replacement.length-match[0].length;count++;
  }
  if(!count)return {text:raw,selection:{from:points[0],to:points[1]},count:0};
  parts.push(raw.slice(position));
  for(let i=0;i<2;i++)if(mapped[i]===null)mapped[i]=points[i]+delta;
  return {text:parts.join(''),selection:{from:mapped[0],to:mapped[1]},count};
}
