import {describe,it,expect} from 'vitest';
import {collectImageReferences} from '../src/image-references.js';

const urls=raw=>collectImageReferences(raw).map(ref=>raw.slice(ref.urlFrom,ref.urlTo));
describe('image references for saving any open document',()=>{
  it('finds compact details body images without an active rich renderer',()=>{
    const raw='<details><summary>詳細</summary>\n![画像](mdsplit-asset:pending.png)\n</details>';
    const [ref]=collectImageReferences(raw);
    expect(ref.from).toBe(raw.indexOf('!['));
    expect(raw.slice(ref.from,ref.to)).toBe('![画像](mdsplit-asset:pending.png)');
    expect(raw.slice(ref.urlFrom,ref.urlTo)).toBe('mdsplit-asset:pending.png');
  });
  it('keeps UTF-16 and mixed CRLF offsets exact through nested details',()=>{
    const raw='🙂\r\n\r\n![外](<outer assets/a.png> "keep")\r\n\r\n<details>\r\n<summary>外側</summary>\r\n<details><summary>内側</summary>\r\n![中](nested/a(b).png)\r\n</details>\r\n![後](tail.png)\r\n</details>';
    const refs=collectImageReferences(raw);
    expect(refs.map(ref=>ref.url)).toEqual(['outer assets/a.png','nested/a(b).png','tail.png']);
    expect(refs.map(ref=>raw.slice(ref.urlFrom,ref.urlTo))).toEqual(refs.map(ref=>ref.url));
    for(const ref of refs)expect(raw.slice(ref.from,ref.from+2)).toBe('![');
    const changes=refs.toReversed();let changed=raw;
    for(const ref of changes)changed=changed.slice(0,ref.urlFrom)+'doc.assets/'+ref.from+'.png'+changed.slice(ref.urlTo);
    expect(changed).not.toContain('<outer assets/a.png>');
    expect(changed).toContain('"keep"');
    expect(changed.match(/\r\n/g)).toHaveLength(raw.match(/\r\n/g).length);
  });
  it('does not collect summary text, arbitrary HTML, inline code or fenced examples',()=>{
    const raw='`![inline](inline.png)`\n\n```md\n<details><summary>x</summary>\n![fenced](fenced.png)\n</details>\n```\n\n<div>\n![html](html.png)\n</div>\n\n<details><summary>![summary](summary.png)</summary>\n![real](real.png)\n</details>';
    expect(urls(raw)).toEqual(['real.png']);
  });
  it('ignores literal closing details tags and images inside body code fences',()=>{
    const raw='<details><summary>コード例</summary>\n```md\n</details>\n![example](example.png)\n```\n![real](real.png)\n</details>\n![after](after.png)';
    expect(urls(raw)).toEqual(['real.png','after.png']);
  });
  it('keeps CR-only details and fenced examples aligned with the original file',()=>{
    const raw='<details><summary>CRのみ</summary>\r```md\r</details>\r![code](code.png)\r```\r![real](real.png)\r</details>';
    expect(urls(raw)).toEqual(['real.png']);
    const [ref]=collectImageReferences(raw);expect(ref.from).toBe(raw.indexOf('![real]'));
  });
  it('handles indented examples, tilde fences and ordinary list/table images',()=>{
    const raw='    ![indented](skip.png)\n\n- ![list](list.png)\n\n| 画像 |\n|---|\n| ![table](table.png) |\n\n<details><summary>x</summary>\n~~~~md\n![example](skip2.png)\n~~~~\n![body](body.png)\n</details>';
    expect(urls(raw)).toEqual(['list.png','table.png','body.png']);
  });
  it('rejects stale/forged renderer hints and deduplicates current hints',()=>{
    const raw='![real](real.png)\n\n```md\n![code](code.png)\n```';
    const [ref]=collectImageReferences(raw),codeFrom=raw.indexOf('![code]');
    const extras=[{...ref,hint:'current'}, {...ref,to:ref.to+1,hint:'stale'}, {...ref,url:'wrong.png'}, {from:codeFrom,to:codeFrom+'![code](code.png)'.length,url:'code.png'},null];
    const result=collectImageReferences(raw,extras);
    expect(result).toHaveLength(1);expect(result[0]).toEqual({...ref,hint:'current'});
  });
  it('preserves renderer behavior for malformed or unclosed raw HTML',()=>{
    expect(urls('<details><summary>x</summary>\n![unclosed](raw.png)')).toEqual([]);
    expect(urls('<unknown>\n![raw](raw.png)\n</unknown>')).toEqual([]);
  });
});
