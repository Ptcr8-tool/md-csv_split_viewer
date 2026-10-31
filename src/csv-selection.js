// Compute selection independently of the grid so modifier-key behavior can
// be exercised without a rendered table. Existing selections are never mutated.
export function nextCsvSelection(old,kind,a,b,event={}){
  const same=old?.kind===kind,add=event.ctrlKey||event.metaKey;
  const entries=same&&add?new Set(old.entries):new Set();
  const anchor=same&&event.shiftKey?old.anchor:[a,b];
  if(event.shiftKey&&same){
    if(kind==='cell'){
      for(let row=Math.min(anchor[0],a);row<=Math.max(anchor[0],a);row++)
        for(let col=Math.min(anchor[1],b);col<=Math.max(anchor[1],b);col++)entries.add(`${row}:${col}`);
    }else{
      for(let i=Math.min(anchor[0],a);i<=Math.max(anchor[0],a);i++)entries.add(i);
    }
  }else{
    const value=kind==='cell'?`${a}:${b}`:a;
    if(add&&entries.has(value))entries.delete(value);else entries.add(value);
  }
  return {kind,entries,anchor};
}
