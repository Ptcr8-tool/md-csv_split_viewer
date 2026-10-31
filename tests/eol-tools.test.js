import {describe,it,expect} from 'vitest';
import {countLineEndings,replaceLineEndings} from '../src/eol-tools.js';

describe('mixed line-ending operations',()=>{
  it('counts CRLF as a single ending, not CR and LF',()=>{
    expect(countLineEndings('a\r\nb\nc\rd\r\n')).toEqual({CRLF:2,LF:1,CR:1});
  });
  it('replaces only the selected kind, including non-ASCII data',()=>{
    expect(replaceLineEndings('日\r\n本\n語\r😀','LF','CRLF').text).toBe('日\r\n本\r\n語\r😀');
    expect(replaceLineEndings('a\r\nb\nc\rd','CR','remove').text).toBe('a\r\nb\ncd');
  });
  it('moves selection with the raw text and leaves unselected line endings intact',()=>{
    const r=replaceLineEndings('a\r\nb\nc\rd','CRLF','LF',{from:3,to:8});
    expect(r.text).toBe('a\nb\nc\rd');expect(r.selection).toEqual({from:2,to:7});
  });
  it('can remove all ending types without treating pairs twice',()=>{
    expect(replaceLineEndings('a\r\nb\nc\rd','all','remove',{from:3,to:8})).toEqual({text:'abcd',selection:{from:1,to:4},count:3});
  });
  it('keeps the caret after newly expanded CRLF and never inside a pair',()=>{
    expect(replaceLineEndings('a\nb','LF','CRLF',{from:2,to:2}).selection).toEqual({from:3,to:3});
    expect(replaceLineEndings('a\r\nb','CRLF','CRLF',{from:2,to:3}).selection).toEqual({from:3,to:3});
  });
});
