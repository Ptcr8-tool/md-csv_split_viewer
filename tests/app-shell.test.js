import {describe,expect,it} from 'vitest';
import {applicationShell} from '../src/app-shell.js';
import {APP_TITLE} from '../src/brand.js';
import {SUPPORTED_TEXT_ACCEPT} from '../src/file-types.js';

describe('application shell',()=>{
  it('exposes the essential controls and file types before the editor attaches handlers',()=>{
    const html=applicationShell();
    expect(html).toContain(APP_TITLE);
    expect(html).toContain(`accept="${SUPPORTED_TEXT_ACCEPT}"`);
    for(const action of ['new','open','save','saveas','mode-normal','mode-discord','view-split','view-source','view-preview','sync','help','settings']){
      expect(html).toContain(`data-cmd="${action}"`);
    }
    for(const id of ['source','preview','text-preview','outline-tree','file-input','image-input','modal']){
      expect(html).toContain(`id="${id}"`);
    }
  });
});
