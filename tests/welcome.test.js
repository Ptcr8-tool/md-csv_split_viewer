import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {welcomeDocument} from '../src/welcome.js';
import {DocumentModel} from '../src/document.js';
import {parseMarkdown} from '../src/render.js';

const guide=welcomeDocument();
const tree=parseMarkdown(guide.text);
const nodes=[];
const visit=node=>{nodes.push(node);for(const child of node.children||[])visit(child);};
visit(tree);

describe('editable welcome guide',()=>{
  it('opens as an independent untitled document and preserves the original guide after edits',()=>{
    const edited=new DocumentModel(welcomeDocument());
    expect(edited.path).toBeNull();
    const at=edited.raw.indexOf('今日のメモ：');
    expect(at).toBeGreaterThan(0);
    edited.replace(at,at+'今日のメモ：'.length,'明日のメモ：');
    expect(edited.raw).toContain('明日のメモ：');
    expect(welcomeDocument()).toEqual(guide);
    expect(welcomeDocument()).not.toBe(guide);
  });

  it('contains usable Markdown examples rather than images of formatting',()=>{
    for(const type of ['heading','strong','emphasis','delete','inlineCode','blockquote','list','table','image']){
      expect(nodes.some(node=>node.type===type),type).toBe(true);
    }
    expect(nodes.some(node=>node.type==='listItem'&&node.checked===false)).toBe(true);
    expect(nodes.some(node=>node.type==='listItem'&&node.checked===true)).toBe(true);
    expect(nodes.some(node=>node.type==='listItem'&&node.children?.some(child=>child.type==='list'))).toBe(true);
    for(const lang of ['html','javascript','mermaid'])expect(nodes.some(node=>node.type==='code'&&node.lang===lang),lang).toBe(true);
    expect(nodes.some(node=>node.type==='html'&&node.value.startsWith('<details>'))).toBe(true);
    expect(guide.text).toContain('名前\t予定\t状態');
    expect(guide.text).toContain('ここに　全角スペース');
    expect(guide.text).toContain('`\\d+`');
    expect(guide.text).toContain('`[ \\t]+(?=\\r?$)`');
  });

  it('embeds the existing generic screenshot so copies and Save As have no image path to lose',()=>{
    const images=nodes.filter(node=>node.type==='image');
    expect(images).toHaveLength(1);
    expect(images[0].url).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
    const embedded=Buffer.from(images[0].url.split(',')[1],'base64');
    expect(embedded.equals(readFileSync(new URL('../docs/screenshots/06-mermaid-diagram.png',import.meta.url)))).toBe(true);
    expect(embedded.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
    expect(guide.text).not.toContain('mdsplit-asset://');
    expect(Buffer.byteLength(guide.text,'utf8')).toBeLessThan(260000);
    const saved=new DocumentModel({...guide,path:'C:\\notes\\guide.md'}).serialize();
    expect(parseMarkdown(saved.text).children.some(node=>JSON.stringify(node).includes(images[0].url))).toBe(true);
  });
});
