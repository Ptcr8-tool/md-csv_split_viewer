import {describe, expect, it} from 'vitest';
import {csvCellAlignment, normalizeCsvView} from '../src/csv-view.js';

describe('CSV view default vertical alignment', () => {
  it('uses viewport alignment for a fresh view and for an absent global setting', () => {
    for (const input of [undefined, {}, {alignment: {}}, {alignment: {horizontal:'right'}}]) {
      const view=normalizeCsvView(input);
      expect(view.alignment.vertical).toBe('viewport');
      expect(csvCellAlignment(view,4,2).vertical).toBe('viewport');
      expect(normalizeCsvView(view)).toEqual(view);
    }
  });

  it('keeps explicit settings and the behaviour of older partial overrides', () => {
    for (const vertical of ['top','middle','bottom','viewport']) {
      const view=normalizeCsvView({alignment:{horizontal:'center',vertical}});
      expect(view.alignment).toEqual({horizontal:'center',vertical});
      expect(normalizeCsvView(view).alignment).toEqual(view.alignment);
    }
    const view=normalizeCsvView({alignment:{vertical:'bottom'},rowAlignment:{1:{horizontal:'center'}},columnAlignment:{2:{vertical:'middle'}},cellAlignment:{'3:3':{vertical:'top'}}});
    expect(csvCellAlignment(view,0,0).vertical).toBe('bottom');
    expect(csvCellAlignment(view,1,0)).toEqual({horizontal:'center',vertical:'top'});
    expect(csvCellAlignment(view,0,2).vertical).toBe('middle');
    expect(csvCellAlignment(view,3,3).vertical).toBe('top');
  });
});
