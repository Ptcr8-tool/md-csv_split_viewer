import {describe,expect,it} from 'vitest';
import {nextCsvSelection} from '../src/csv-selection.js';

describe('CSV selection',()=>{
  it('selects rows, toggles with Ctrl and preserves the previous selection',()=>{
    const first=nextCsvSelection(null,'row',2,null);
    const added=nextCsvSelection(first,'row',4,null,{ctrlKey:true});
    expect([...first.entries]).toEqual([2]);
    expect([...added.entries]).toEqual([2,4]);
    expect([...nextCsvSelection(added,'row',2,null,{ctrlKey:true}).entries]).toEqual([4]);
  });
  it('extends a row selection in either direction with Shift',()=>{
    const first=nextCsvSelection(null,'row',4,null);
    const range=nextCsvSelection(first,'row',2,null,{shiftKey:true});
    expect([...range.entries]).toEqual([2,3,4]);
    expect(range.anchor).toEqual([4,null]);
  });
  it('selects a rectangular range of cells and resets on kind change',()=>{
    const first=nextCsvSelection(null,'cell',1,2);
    const range=nextCsvSelection(first,'cell',2,3,{shiftKey:true});
    expect([...range.entries]).toEqual(['1:2','1:3','2:2','2:3']);
    expect([...nextCsvSelection(range,'column',3,null,{ctrlKey:true}).entries]).toEqual([3]);
  });
  it('adds a shifted range to an existing selection when Ctrl is held',()=>{
    const first=nextCsvSelection(null,'row',1,null);
    const second=nextCsvSelection(first,'row',4,null,{ctrlKey:true});
    expect([...nextCsvSelection(second,'row',6,null,{ctrlKey:true,shiftKey:true}).entries]).toEqual([1,4,5,6]);
  });
});
