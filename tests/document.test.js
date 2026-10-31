import { describe, it, expect } from 'vitest';
import { DocumentModel, MAX_HISTORY_CHARS, difference, normalized, lfToRaw, rawToLf, replaceRich, textMap, imageUrlRange } from '../src/document.js';
import { splitDiscord } from '../src/discord.js';
describe('source preservation',()=>{
  it('preserves untouched mixed EOL, whitespace, fences and metadata',()=>{
    const before='---\r\ntitle: X\n---\r\n\r\n__keep__  \r\n\nhello\r\n\n~~~mermaid\r\nflowchart LR\r\n  A --> B\r\n~~~';
    const d=new DocumentModel({text:before});
    d.editNormalized(normalized(before),normalized(before).replace('hello','こんにちは'));
    expect(d.raw).toBe(before.replace('hello','こんにちは'));
  });
  it('maps CRLF offsets in both directions',()=>{
    const s='a\r\nb\nc\r\n';
    for(let i=0;i<=normalized(s).length;i++)expect(rawToLf(s,lfToRaw(s,i))).toBe(i);
  });
  it('maps long mixed-EOL documents exactly across sparse-index boundaries',()=>{
    const raw='x'.repeat(4095)+'\r\n'+('あ\n🙂\rZ\r\n'.repeat(1400))+'\r\nend';
    function expectedLfToRaw(index){let logical=0;for(let i=0;i<raw.length;i++){if(logical===index)return i;if(raw[i]==='\r'&&raw[i+1]==='\n')i++;logical++;}return raw.length;}
    const points=new Set([0,1,4094,4095,4096,4097,4098,raw.length-1,raw.length,raw.length+8]);
    for(let i=0;i<raw.length;i+=37)points.add(i);
    for(const at of points){expect(rawToLf(raw,at)).toBe(normalized(raw.slice(0,at)).length);expect(lfToRaw(raw,at)).toBe(expectedLfToRaw(at));}
    for(const at of [-1,-4096,1.5,NaN,Infinity,undefined])expect(rawToLf(raw,at)).toBe(normalized(raw.slice(0,at)).length);
    for(const at of [-1,1.5,NaN,Infinity,undefined])expect(lfToRaw(raw,at)).toBe(raw.length);
    const changed=raw.slice(0,4095)+'x'+raw.slice(4096);
    expect(rawToLf(changed,changed.length)).toBe(normalized(changed).length);
    expect(rawToLf(raw,raw.length)).toBe(normalized(raw).length);
  });
  it('uses a single history for edits in both panes',()=>{
    const d=new DocumentModel({text:'first\n\n**second**'});
    d.replace(0,5,'one','source');d.replace(7,13,'two','rich');
    expect(d.undo()).toBe(true);expect(d.raw).toBe('one\n\n**second**');
    d.undo();expect(d.raw).toBe('first\n\n**second**');d.redo();expect(d.raw).toBe('one\n\n**second**');
  });
  it('undoes grouped overlapping edits and restores the selection on both sides',()=>{
    const original='A\r\n🙂x';
    const d=new DocumentModel({text:original,path:'C:\\note.md'});
    d.selection={from:3,to:5};
    d.replace(3,5,'xy','source',{from:5,to:5});
    d.replace(4,6,'Z','source',{from:5,to:5});
    const edited=d.raw;
    expect(d.undoStack).toHaveLength(1);
    d.selection={from:2,to:2};
    expect(d.undo()).toBe(true);expect(d.raw).toBe(original);expect(d.dirty).toBe(false);expect(d.selection).toEqual({from:3,to:5});
    d.selection={from:1,to:1};
    expect(d.redo()).toBe(true);expect(d.raw).toBe(edited);expect(d.selection).toEqual({from:2,to:2});
    expect(d.undo()).toBe(true);expect(d.selection).toEqual({from:1,to:1});
  });
  it('keeps small edits in a large file as bounded change records',()=>{
    const original='a'.repeat(4_000_000),d=new DocumentModel({text:original,path:'C:\\large.txt'});
    for(let i=0;i<210;i++)d.replace(i,i+1,'b');
    expect(d.undoStack).toHaveLength(200);
    expect(d.historyChars).toBe(400);
    expect(d.undoStack[0]).not.toHaveProperty('raw');
    expect(d.undo()).toBe(true);expect(d.raw[209]).toBe('a');
    expect(d.redo()).toBe(true);expect(d.raw[209]).toBe('b');
    d.undo();d.replace(0,1,'z');expect(d.redo()).toBe(false);expect(d.historyChars).toBe(400);
  });
  it('preserves individual UTF-16 units in history payloads',()=>{
    const text='0123456789abcdef\ud800tail', d=new DocumentModel({text});
    d.replace(0,17,'replacement longer than 12 units');
    expect(d.undo()).toBe(true);expect(d.raw).toBe(text);
    expect(d.redo()).toBe(true);expect(d.raw).toBe('replacement longer than 12 unitstail');
  });
  it('limits retained changed text and still undoes the most recent large edit',()=>{
    const half=Math.floor(MAX_HISTORY_CHARS/2)+1;
    const d=new DocumentModel({text:'a'.repeat(half)+'b'.repeat(half),path:'C:\\large.txt'});
    d.replace(0,half,'');d.replace(0,half,'');
    expect(d.historyChars).toBe(half);expect(d.undoStack).toHaveLength(1);
    expect(d.undo()).toBe(true);expect(d.raw.length).toBe(half);expect(d.raw[0]).toBe('b');
    expect(d.redo()).toBe(true);expect(d.raw).toBe('');
  });
  it('keeps an asynchronous image insertion anchored to its document and surrounding edits',()=>{
    const d=new DocumentModel({text:'before after'}),anchor=d.trackRange({from:6,to:6});
    d.replace(0,6,'longer before');
    d.replace(anchor.from,anchor.to,'![image](a.png)');
    expect(d.raw).toBe('longer before![image](a.png) after');anchor.dispose();
  });
  it('preserves entity and escaped source maps',()=>{
    expect(textMap('A &amp; B','A & B',10,n=>n==='amp'?'&':null)).toEqual([10,11,12,17,18,19]);
    expect(textMap('a\\*b','a*b',0)).toEqual([0,1,3,4]);
  });
  it('finds only the URL token even when the alt text repeats it',()=>{
    const s='before ![old.assets/a.png](<old.assets/a.png> "title") after';
    const from=s.indexOf('!['),to=s.lastIndexOf(')')+1,r=imageUrlRange(s,from,to);
    expect(s.slice(r.urlFrom,r.urlTo)).toBe('old.assets/a.png');
    expect(r.urlFrom).toBe(s.indexOf('<')+1);
  });
  it('finds nested-parenthesis image URLs without replacing the title',()=>{
    const s='![image](folder/a(b).png "keep this")';const r=imageUrlRange(s,0,s.length);
    expect(s.slice(r.urlFrom,r.urlTo)).toBe('folder/a(b).png');
  });
  it('balances formatting for deletion crossing a strong boundary',()=>{
    const raw='**bold** plain';
    const f=[{from:0,to:8,contentFrom:2,contentTo:6,open:'**',close:'**'}];
    const c=replaceRich(raw,4,14,'X',f);
    expect(raw.slice(0,c.from)+c.insert+raw.slice(c.to)).toBe('**boX**');
    expect(replaceRich(raw,2,6,'new',f)).toEqual({from:2,to:6,insert:'new'});
  });
});
describe('Discord splitting',()=>{
  it('handles a closing fence exactly at EOF',()=>{
    const text='```js\n'+('console.log("hello");\n'.repeat(250))+'```';
    const parts=splitDiscord(text,2000);
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.every(p=>p.count<=2000)).toBe(true);
    expect(parts.map(p=>text.slice(p.from,p.to)).join('')).toBe(text);
  });
  it('keeps copied code blocks within the limit after Windows clipboard line-ending expansion',()=>{
    for (const newline of ['\n','\r\n']) {
      const text='```js'+newline+('console.log("hello");'+newline).repeat(250)+'```';
      const parts=splitDiscord(text,2000);
      expect(parts.length).toBeGreaterThan(2);
      for(const part of parts) {
        const windowsText=part.text.replace(/\r\n|\r|\n/g,'\r\n');
        expect(windowsText.length).toBeLessThanOrEqual(2000);
      }
      expect(parts.map(p=>text.slice(p.from,p.to)).join('')).toBe(text);
    }
  });
  it('reserves clipboard space for standalone carriage returns',()=>{
    const text=('line\r').repeat(50);
    const parts=splitDiscord(text,64);
    expect(parts.every(p=>p.text.replace(/\r\n|\r|\n/g,'\r\n').length<=64)).toBe(true);
    expect(parts.map(p=>text.slice(p.from,p.to)).join('')).toBe(text);
  });
  it('accounts for reopened fences and preserves all original ranges',()=>{
    const text='説明\n\n```js\n'+('console.log("🙂");\n'.repeat(80))+'```\n\n最後';
    const parts=splitDiscord(text,140);
    expect(parts.length).toBeGreaterThan(2);
    for(const p of parts){ expect(p.text.length).toBeLessThanOrEqual(140); expect((p.text.match(/```/g)||[]).length%2).toBe(0); }
    expect(parts.map(p=>text.slice(p.from,p.to)).join('')).toBe(text);
  });
  it('does not break a grapheme or lose a long single line',()=>{
    const text='👩‍👩‍👧‍👦'.repeat(100);
    const parts=splitDiscord(text,64);
    expect(parts.map(p=>p.text).join('')).toBe(text);
    expect(parts.every(p=>p.count<=64 && !p.text.endsWith('\u200d'))).toBe(true);
  });
  it('keeps ordinary long messages within the selected limit',()=>{
    const text=('**大事なお知らせです。**\n\n'+ 'お知らせの本文。'.repeat(50)+'\n').repeat(15);
    const parts=splitDiscord(text,2000);
    expect(parts.every(p=>p.count<=2000)).toBe(true);
    expect(parts.map(p=>text.slice(p.from,p.to)).join('')).toBe(text);
  });
});
