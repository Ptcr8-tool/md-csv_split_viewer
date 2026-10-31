import {describe,it,expect} from 'vitest';
import {parseDelimited} from '../src/text-preview.js';
import {csvRowAtPosition,visibleCsvRow} from '../src/csv-links.js';

describe('CSV source row links',()=>{
  it('keeps quoted CRLF lines within one logical CSV record',()=>{
    const text='Name,Value\r\nA,"first\r\nsecond"\r\nB,last\r\n';
    const {rowRanges}=parseDelimited(text);
    expect(csvRowAtPosition(rowRanges,text.indexOf('second'))).toBe(1);
    expect(csvRowAtPosition(rowRanges,text.indexOf('B,last'))).toBe(2);
    expect(csvRowAtPosition(rowRanges,text.length)).toBe(2);
    expect(csvRowAtPosition(rowRanges,0)).toBe(0);
  });
  it('uses a nearby visible record without unhiding rows',()=>{
    const hidden=new Set([1,2,4]);
    expect(visibleCsvRow(1,5,hidden)).toBe(3);
    expect(visibleCsvRow(4,5,hidden)).toBe(3);
    expect([...hidden]).toEqual([1,2,4]);
    expect(visibleCsvRow(0,2,new Set([0,1]))).toBe(-1);
  });
});
