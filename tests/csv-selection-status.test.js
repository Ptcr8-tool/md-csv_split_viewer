import {describe,it,expect} from 'vitest';
import {csvSelectionAddress} from '../src/csv-selection-status.js';
const select=(kind,...entries)=>({kind,entries:new Set(entries)});
describe('CSV selection address',()=>{
  it('formats cells with row first and Excel-style column letters',()=>{
    expect(csvSelectionAddress(select('cell','19:0'),40,30)).toBe('20A');
    expect(csvSelectionAddress(select('cell','19:26','20:26'),40,30)).toBe('20AA:21AA');
    expect(csvSelectionAddress(select('cell','19:0','19:1','20:0','20:1'),40,30)).toBe('20A:21B');
  });
  it('disambiguates numeric row and column',()=>{
    expect(csvSelectionAddress(select('cell','19:0'),40,30,'numbers')).toBe('20-1');
    expect(csvSelectionAddress(select('cell','19:0','20:0'),40,30,'numbers')).toBe('20-1:21-1');
  });
  it('clearly marks noncontiguous selection',()=>{
    expect(csvSelectionAddress(select('cell','19:0','27:28'),40,30)).toBe('20A:28AC（複数範囲）');
    expect(csvSelectionAddress(select('row',1,3),10,3)).toBe('2A:4C（複数範囲）');
    expect(csvSelectionAddress(select('column',0,1),10,3)).toBe('1A:10B');
  });
  it('represents all cells without enumerating them, and safely handles empty selections',()=>{
    expect(csvSelectionAddress(select('all','all'),100000,29)).toBe('1A:100000AC');
    expect(csvSelectionAddress(null,100,10)).toBe('');
    expect(csvSelectionAddress(select('cell','0:0'),0,10)).toBe('');
  });
});
