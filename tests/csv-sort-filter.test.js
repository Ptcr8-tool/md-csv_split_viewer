import {describe,it,expect} from 'vitest';
import {parseDelimited} from '../src/csv-parser.js';
import {sortDelimitedRows,filteredCsvRows,moveDelimitedColumns} from '../src/csv-sort-filter.js';

describe('CSV sort and filter',()=>{
  it('sorts complete rows with BOM, mixed separators, quoted newline and no final newline intact',()=>{
    const raw='\ufeffname,num\r\n"c\nvalue",10\na,2\rb,1';const parsed=parseDelimited(raw);
    const next=sortDelimitedRows(raw,parsed,1,{header:true});
    expect(next).toBe('\ufeffname,num\r\nb,1\na,2\r"c\nvalue",10');
    expect(parseDelimited(next).rows).toEqual([['name','num'],['b','1'],['a','2'],['c\nvalue','10']]);
  });
  it('keeps ties stable and header only when requested',()=>{
    const raw='b,1\na,2\nc,2\n';const parsed=parseDelimited(raw);
    expect(sortDelimitedRows(raw,parsed,1,{header:false,descending:true})).toBe('a,2\nc,2\nb,1\n');
    expect(sortDelimitedRows(raw,parsed,1,{header:true,descending:true})).toBe(raw);
  });
  it('filters on values without changing the original, retaining header',()=>{
    const parsed=parseDelimited('name,value\nAAA,x\nbBb,y\nccc,z');
    expect([...filteredCsvRows(parsed,{column:0,text:'b'},true)]).toEqual([1,3]);
    expect([...filteredCsvRows(parsed,{column:1,text:'X'},false)]).toEqual([0,2,3]);
    expect(filteredCsvRows(parsed,null).size).toBe(0);
  });
  it('moves contiguous columns including short rows and preserves quoted fields',()=>{
    const raw='\ufeffa,b,c,d\r\n"x,y",z\nq,r,s,t';const parsed=parseDelimited(raw);
    const next=moveDelimitedColumns(raw,parsed,[1,2],'right');
    expect(next).toBe('\ufeffa,d,b,c\r\n"x,y",,z,\nq,t,r,s');
    expect(moveDelimitedColumns(next,parseDelimited(next),[2,3],'left')).toBe('\ufeffa,b,c,d\r\n"x,y",z,,\nq,r,s,t');
    expect(()=>moveDelimitedColumns(raw,parsed,[0,2],'right')).toThrow();
  });
  it('preserves literal leading U+FEFF when data becomes the first field',()=>{
    for(const prefix of ['', '\ufeff']){
      const raw=prefix+'a,z\n\ufeffb,y';const sorted=sortDelimitedRows(raw,parseDelimited(raw),1,{header:false});
      expect(parseDelimited(sorted).rows).toEqual([['\ufeffb','y'],['a','z']]);
      const moved=moveDelimitedColumns(prefix+'x,\ufeffq\na,z',parseDelimited(prefix+'x,\ufeffq\na,z'),[1],'left');
      expect(parseDelimited(moved).rows).toEqual([['\ufeffq','x'],['z','a']]);
      expect(moved.startsWith(prefix+'"\ufeff')).toBe(true);
    }
  });
  it('keeps the final empty record when sorting without a trailing newline',()=>{
    const raw='h\n\na';const sorted=sortDelimitedRows(raw,parseDelimited(raw),0,{header:true,descending:true});
    expect(sorted).toBe('h\na\n""');expect(parseDelimited(sorted).rows).toEqual([['h'],['a'],['']]);
  });
});
