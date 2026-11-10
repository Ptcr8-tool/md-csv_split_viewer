import {afterEach, describe, expect, it} from 'vitest';
import {setUiLanguage} from '../src/i18n.js';
import {splitDiscord} from '../src/discord.js';
import {parseDelimited} from '../src/csv-parser.js';
import {csvSelectionAddress} from '../src/csv-selection-status.js';

afterEach(()=>setUiLanguage('ja'));
describe('CSV and Discord language',()=>{
  it('reports invalid split limits in the selected language',()=>{
    setUiLanguage('en'); expect(()=>splitDiscord('text',1)).toThrow('character limit');
    setUiLanguage('ja'); expect(()=>splitDiscord('text',1)).toThrow('文字数上限');
  });
  it('reports CSV quote errors in English without changing content',()=>{
    setUiLanguage('en'); expect(()=>parseDelimited('"unterminated')).toThrow('Invalid quotes on row 1');
    expect(parseDelimited('日本語,English').rows).toEqual([['日本語','English']]);
  });
  it('describes noncontiguous selections in the selected language',()=>{
    const selection={kind:'row',entries:new Set([0,2])};
    setUiLanguage('en');expect(csvSelectionAddress(selection,3,2)).toBe('1A:3B (multiple ranges)');
    setUiLanguage('ja');expect(csvSelectionAddress(selection,3,2)).toBe('1A:3B（複数範囲）');
  });
});
