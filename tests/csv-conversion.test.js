import {describe,it,expect} from 'vitest';
import {convertCsvText,convertCsvRange,transposeCsvClipboard} from '../src/csv-conversion.js';
import {parseDelimited} from '../src/csv-parser.js';

describe('CSV text conversion',()=>{
  it('converts only the requested character types',()=>{
    expect(convertCsvText('ＡＢ１２　カﾞガ、。','half')).toBe('AB12 ｶﾞｶﾞ､｡');
    expect(convertCsvText('AB12 ｶﾞ､｡①','full')).toBe('ＡＢ１２　ガ、。①');
    expect(convertCsvText('ｶﾞｯﾂ カタカナ','kana-to-hiragana')).toBe('がっつ カタカナ');
    expect(convertCsvText('がっつ カタカナ','hiragana-to-kana')).toBe('ｶﾞｯﾂ カタカナ');
    expect(convertCsvText('Abc, 日本語','upper')).toBe('ABC, 日本語');
    expect(convertCsvText('AbC, 日本語','lower')).toBe('abc, 日本語');
  });
  it('changes only existing selected cells and preserves separators, quotes and line endings',()=>{
    const raw='id,value,other\r\n1,"ｶﾞ,ｷﾞ",Keep\r\n2,ＡＢ,Keep\r\n';const p=parseDelimited(raw,{delimiter:','});
    expect(convertCsvRange(raw,p,{top:1,left:1,bottom:2,right:1},'full')).toBe('id,value,other\r\n1,"ガ，ギ",Keep\r\n2,ＡＢ,Keep\r\n');
  });
  it('transposes rectangular pasted text without inventing values for ragged input',()=>{
    expect(transposeCsvClipboard([['a','b'],['c','d']])).toEqual([['a','c'],['b','d']]);
    expect(()=>transposeCsvClipboard([['a','b'],['c']])).toThrow('列数');
  });
});
