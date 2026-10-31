import {describe,it,expect} from 'vitest';
import {parseDelimited} from '../src/csv-parser.js';
import {csvSelectionBounds,csvCopyText,parseClipboardGrid,pasteCsvGrid,csvChangedRange} from '../src/csv-clipboard.js';

describe('CSV clipboard',()=>{
  it('copies a rectangle as quoted TSV and restores tabs, newlines and quotes',()=>{
    const raw='h1,h2\r\n"a,b","line 1\r\nline 2"\r\n"a\tb","say ""hello"""';
    const parsed=parseDelimited(raw,{unlimited:true});
    const b=csvSelectionBounds({kind:'row',entries:new Set([1,2])},3,2);
    const text=csvCopyText(parsed,b);
    expect(text).toBe('a,b\t"line 1\r\nline 2"\r\n"a\tb"\t"say ""hello"""');
    expect(parseClipboardGrid(text)).toEqual([['a,b','line 1\r\nline 2'],['a\tb','say "hello"']]);
  });
  it('parses plain quotes and a trailing clipboard record delimiter',()=>{
    expect(parseClipboardGrid('hello "world"')).toEqual([['hello "world"']]);
    expect(parseClipboardGrid('a\tb\r\nc\td\r\n')).toEqual([['a','b'],['c','d']]);
    expect(parseClipboardGrid('a\r\n\r\n')).toEqual([['a'],['']]);
    expect(parseClipboardGrid('')).toEqual([['']]);
    expect(parseClipboardGrid('"hello"')).toEqual([['"hello"']]);
    expect(parseClipboardGrid('"""hello"""')).toEqual([['"hello"']]);
  });
  it('retains a final empty single-cell row when copied and pasted',()=>{
    const parsed=parseDelimited('a\r\n\r\n',{unlimited:true});
    const text=csvCopyText(parsed,{top:0,left:0,bottom:1,right:0});
    expect(text).toBe('a\r\n""');
    expect(parseClipboardGrid(text)).toEqual([['a'],['']]);
  });
  it('refuses sparse selections rather than copying unselected cells',()=>{
    expect(()=>csvSelectionBounds({kind:'cell',entries:new Set(['1:0','1:2'])},4,3)).toThrow(/連続/);
    expect(()=>csvSelectionBounds({kind:'row',entries:new Set([1,3])},4,3)).toThrow(/連続/);
    expect(csvSelectionBounds({kind:'cell',entries:new Set(['1:0','1:1','2:0','2:1'])},4,3)).toEqual({top:1,left:0,bottom:2,right:1});
  });
  it('pastes a rectangle preserving BOM, unchanged bytes, line endings and prior quoting',()=>{
    const raw='\ufeff"header",b,c\r\n"old",x,y\r\ntail,yes,z\r\n',p=parseDelimited(raw,{unlimited:true});
    const next=pasteCsvGrid(raw,p,{top:1,left:0,bottom:1,right:0},[['new','a,b'],['three','q"uote']]);
    expect(next).toBe('\ufeff"header",b,c\r\n"new","a,b",y\r\nthree,"q""uote",z\r\n');
    const change=csvChangedRange(raw,next);
    expect(raw.slice(0,change.from)+change.insert+raw.slice(change.to)).toBe(next);
  });
  it('expands short rows and appends rows, including embedded delimiters',()=>{
    const raw='h1,h2\r\nrow\r\n',p=parseDelimited(raw,{unlimited:true});
    const next=pasteCsvGrid(raw,p,{top:1,left:1,bottom:1,right:1},[['a,b','z'],['new','last']]);
    expect(next).toBe('h1,h2\r\nrow,"a,b",z\r\n,new,last\r\n');
  });
  it('takes record separators from the CSV boundary, not a newline inside a quoted cell',()=>{
    const raw='"A\nB";x\r',p=parseDelimited(raw,{delimiter:';',unlimited:true});
    const next=pasteCsvGrid(raw,p,{top:0,left:0,bottom:0,right:0},[['a'],['']]);
    expect(next).toBe('"a";x\r""\r');
    expect(parseDelimited(next,{delimiter:';',unlimited:true}).rows).toEqual([['a','x'],['']]);
  });
  it('preserves a new last row whose only cell is empty',()=>{
    const p=parseDelimited('a',{unlimited:true});
    const next=pasteCsvGrid('a',p,{top:0,left:0,bottom:0,right:0},[['x'],['']]);
    expect(next).toBe('x\r\n""');
    expect(parseDelimited(next,{unlimited:true}).rows).toEqual([['x'],['']]);
  });
  it('preserves an existing last row when its only field is cleared',()=>{
    const raw='a\r\nb',p=parseDelimited(raw,{unlimited:true});
    const next=pasteCsvGrid(raw,p,{top:1,left:0,bottom:1,right:0},[['']]);
    expect(next).toBe('a\r\n""');
    expect(parseDelimited(next,{unlimited:true}).rows).toEqual([['a'],['']]);
  });
  it('preserves a first-cell U+FEFF as data with or without a file BOM',()=>{
    for(const raw of ['old,b','\ufeffold,b','"old",b\r\nnext,row']){
      const parsed=parseDelimited(raw,{unlimited:true});
      const value='\ufeffText';const next=pasteCsvGrid(raw,parsed,{top:0,left:0,bottom:0,right:0},[[value]]);
      expect(parseDelimited(next,{unlimited:true}).rows[0][0]).toBe(value);
      expect(next.startsWith(raw.startsWith('\ufeff')?'\ufeff"\ufeff':'"\ufeff')).toBe(true);
    }
  });
  it('fills a selected rectangle with a single pasted value',()=>{
    const raw='a,b\nc,d',p=parseDelimited(raw,{unlimited:true});
    expect(pasteCsvGrid(raw,p,{top:0,left:0,bottom:1,right:1},[['x']])).toBe('x,x\nx,x');
  });
});
