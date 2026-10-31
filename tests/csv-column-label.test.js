import {describe,it,expect} from 'vitest';
import {csvColumnLabel,normalizeCsvView} from '../src/csv-view.js';
describe('CSV column labels',()=>{
  it('uses spreadsheet letters over boundaries and optional one-based numbers',()=>{
    expect([0,25,26,27,51,52,701,702].map(i=>csvColumnLabel(i))).toEqual(['A','Z','AA','AB','AZ','BA','ZZ','AAA']);
    expect(csvColumnLabel(26,'numbers')).toBe('27');
    expect(csvColumnLabel(-1)).toBe('');
  });
  it('preserves valid preferences and defaults older sidecars to letters',()=>{
    expect(normalizeCsvView({columnLabel:'numbers'}).columnLabel).toBe('numbers');
    expect(normalizeCsvView({columnLabel:'untrusted'}).columnLabel).toBe('letters');
    expect(normalizeCsvView({version:1}).columnLabel).toBe('letters');
  });
});
