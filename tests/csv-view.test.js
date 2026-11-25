import {describe,expect,it} from 'vitest';
import {csvCellFold,normalizeCsvView} from '../src/csv-view.js';

describe('CSV view metadata',()=>{
  it('preserves explicit collapsed and expanded cells through serialization',()=>{
    const view=normalizeCsvView({cellFolds:{'0:0':true,'3:1':false},rowLimit:160});
    const restored=normalizeCsvView(JSON.parse(JSON.stringify(view)));

    expect(csvCellFold(restored,0,0)).toBe(true);
    expect(csvCellFold(restored,3,1)).toBe(false);
    expect(csvCellFold(restored,3,2)).toBeUndefined();
    expect(restored.rowLimit).toBe(160);
  });

  it('drops invalid folding entries and supplies defaults for older sidecars',()=>{
    const legacy=normalizeCsvView({version:1,rowHeights:{2:60},wrap:false});
    expect(legacy.cellFolds).toEqual({});
    expect(legacy.rowLimit).toBe(100);
    expect(legacy.rowHeights).toEqual({2:60});
    expect(legacy.wrap).toBe(false);

    const view=normalizeCsvView({cellFolds:{'1:0':true,'1:1':null,'1:2':'false','-1:0':true,'100000000:0':true,other:false},rowLimit:2000});
    expect(view.cellFolds).toEqual({'1:0':true});
    expect(view.rowLimit).toBe(500);
  });

  it('retains automatic height overrides when the document default is fixed',()=>{
    const view=normalizeCsvView({defaultRowHeight:80,rowHeights:{2:0,3:5,4:6000}});

    expect(view.defaultRowHeight).toBe(80);
    expect(view.rowHeights).toEqual({2:0,3:20,4:5000});
    expect(view.rowHeights[5]).toBeUndefined();
  });

  it('restores an unlimited row count from saved view metadata',()=>{
    const view=normalizeCsvView({rowLimit:'unlimited'});
    expect(normalizeCsvView(JSON.parse(JSON.stringify(view))).rowLimit).toBe('unlimited');
  });
});
