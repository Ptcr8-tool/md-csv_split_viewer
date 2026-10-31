import {describe,it,expect} from 'vitest';
import {DocumentModel,normalized,preferredEol,lfToRaw,rawToLf,textMap} from '../src/document.js';
import {lineAt,indentText,indentList,fenceInfo,patchCode} from '../src/editing.js';
const apply=(raw,c)=>raw.slice(0,c.from)+c.insert+raw.slice(c.to);

describe('original line separators',()=>{
  it('normalizes CR, CRLF and LF while retaining exact source offsets',()=>{
    const raw='🙂\ra\r\nb\nc\r',logical='🙂\na\nb\nc\n';
    expect(normalized(raw)).toBe(logical);
    for(let at=0;at<=logical.length;at++)expect(rawToLf(raw,lfToRaw(raw,at))).toBe(at);
    expect(preferredEol('a\rb\r')).toBe('\r');
    expect(preferredEol('a\r\nb\r\n')).toBe('\r\n');
    expect(preferredEol('a\nb\n')).toBe('\n');
    expect(preferredEol('a\rb\rc\r\nd\n')).toBe('\r');
    expect(preferredEol('no newline')).toBe('\n');
  });
  it('maps displayed CR/CRLF newlines without skipping following text',()=>{
    const raw='α\r\nβ\rγ\nδ';
    expect(textMap(raw,normalized(raw),10)).toEqual([10,11,13,14,15,16,17,18]);
  });
  it('edits CR-only plain text and inserts literal tabs/newlines without list formatting',()=>{
    const d=new DocumentModel({path:'C:\\notes\\sample.txt',text:'- plain\rsecond\r'});
    d.editNormalized(normalized(d.raw),'- plain\nsecond\n\tlast\n',{from:21,to:21});
    expect(d.raw).toBe('- plain\rsecond\r\tlast\r');
    expect(d.undo()).toBe(true);expect(d.raw).toBe('- plain\rsecond\r');
    expect(d.redo()).toBe(true);expect(d.raw).toBe('- plain\rsecond\r\tlast\r');
  });
  it('keeps untouched mixed separators byte-for-character through an edit',()=>{
    const before='first\r\nkeep\rchange\nlast\r';
    const d=new DocumentModel({text:before});
    d.editNormalized(normalized(before),normalized(before).replace('change','edited'));
    expect(d.raw).toBe(before.replace('change','edited'));
  });
  it('finds CR-only lines and treats both halves of CRLF as the preceding line',()=>{
    const raw='a\r\nb\rc\n';
    for(const at of [0,1,2])expect(lineAt(raw,at)).toEqual({start:0,end:1,text:'a',eol:'\r\n'});
    for(const at of [3,4])expect(lineAt(raw,at)).toEqual({start:3,end:4,text:'b',eol:'\r'});
    expect(lineAt(raw,5)).toEqual({start:5,end:6,text:'c',eol:'\n'});
    expect(lineAt(raw,7)).toEqual({start:7,end:7,text:'',eol:''});
    expect(lineAt('\rfirst\r',0)).toEqual({start:0,end:0,text:'',eol:'\r'});
    expect(lineAt('\rfirst\r',7)).toEqual({start:7,end:7,text:'',eol:''});
  });
  it('indents a selected CR-only range without including the next line',()=>{
    const raw='one\rtwo\rthree',c=indentText(raw,{from:0,to:8}),changed=apply(raw,c);
    expect(changed).toBe('\tone\r\ttwo\rthree');
    expect(apply(changed,indentText(changed,c.selection,true))).toBe(raw);
  });
  it('keeps CR-only list descendants and code fences intact when edited',()=>{
    const raw='- parent\r- child\r  - nested\r- tail',at=raw.indexOf('child'),c=indentList(raw,{from:at,to:at}),changed=apply(raw,c);
    expect(changed).toBe('- parent\r  - child\r    - nested\r- tail');
    expect(apply(changed,indentList(changed,c.selection,true))).toBe(raw);
    const code='```text\rbody\r```',info=fenceInfo(code,0,code.length);
    expect(info.fenced).toBe(true);expect(code.slice(info.contentFrom,info.contentTo)).toBe('body');
    expect(apply(code,patchCode(code,info,info.contentFrom,info.contentTo,'new'))).toBe('```text\rnew\r```');
  });
});

describe('encoding and view metadata',()=>{
  it('infers legacy BOM defaults and respects explicit BOM-less Unicode files',()=>{
    for(const encoding of ['utf8bom','utf16le','utf16be','utf32le','utf32be']){
      const d=new DocumentModel({path:'file.txt',encoding,hasBom:null,savedHasBom:null});
      expect(d.hasBom).toBe(true);expect(d.savedHasBom).toBe(true);expect(d.dirty).toBe(false);
      const withoutBom=new DocumentModel({path:'file.txt',encoding,hasBom:false});
      expect(withoutBom.hasBom).toBe(false);expect(withoutBom.savedHasBom).toBe(false);expect(withoutBom.dirty).toBe(false);
    }
    for(const encoding of ['utf8','shiftjis','eucjp','cp1252'])expect(new DocumentModel({encoding}).hasBom).toBe(false);
  });
  it('tracks BOM-only changes as unsaved while view-only choices stay clean',()=>{
    const d=new DocumentModel({path:'file.txt',text:'unchanged',encoding:'utf8'});
    d.previewViewMode='source';expect(d.dirty).toBe(false);
    d.hasBom=true;expect(d.dirty).toBe(true);
    d.savedHasBom=true;expect(d.dirty).toBe(false);
  });
  it('round-trips guessed encoding, original BOM state, format and per-document view',()=>{
    const d=new DocumentModel({path:'file.csv',name:'file.csv',text:'a,b\r1,2',encoding:'utf16le',savedEncoding:'utf16le',hasBom:false,savedHasBom:true,encodingGuessed:true,encodingNotice:'BOMなしのため推定しています。',format:'csv',previewViewMode:'preview'});
    const serialized=d.serialize(),restored=new DocumentModel(JSON.parse(JSON.stringify(serialized)));
    expect(restored.serialize()).toEqual(serialized);expect(restored.dirty).toBe(true);
    expect(restored.previewViewMode).toBe('preview');expect(restored.encodingNotice).toBe('BOMなしのため推定しています。');
  });
  it('uses safe defaults for older or invalid recovery metadata',()=>{
    const d=new DocumentModel({encoding:'utf8',savedEncoding:'utf16be',previewViewMode:'arbitrary',encodingGuessed:'yes',encodingNotice:{html:'ignored'}});
    expect(d.hasBom).toBe(false);expect(d.savedHasBom).toBe(true);
    expect(d.previewViewMode).toBe('split');expect(d.encodingGuessed).toBe(false);expect(d.encodingNotice).toBe(null);expect(d.format).toBe(undefined);
  });
});

describe('saved baselines without writable file paths',()=>{
  it('keeps imported files clean until content, encoding or BOM changes and undo restores cleanliness',()=>{
    const d=new DocumentModel({name:'opened.csv',text:'a,b\r\n🙂,1\r\n',savedText:'a,b\r\n🙂,1\r\n',needsInitialSave:false});
    expect(d.path).toBe(null);expect(d.dirty).toBe(false);
    d.replace(d.raw.indexOf('1'),d.raw.indexOf('1')+1,'2');expect(d.dirty).toBe(true);
    expect(d.undo()).toBe(true);expect(d.dirty).toBe(false);
    d.encoding='utf8bom';expect(d.dirty).toBe(true);d.encoding='utf8';expect(d.dirty).toBe(false);
    d.hasBom=true;expect(d.dirty).toBe(true);d.hasBom=false;expect(d.dirty).toBe(false);
    d.previewViewMode='preview';expect(d.dirty).toBe(false);
  });
  it('persists imported-file cleanliness through serialization without losing newly created unsaved text',()=>{
    const clean=new DocumentModel({name:'opened.txt',text:'unchanged',needsInitialSave:false});
    const restored=new DocumentModel(JSON.parse(JSON.stringify(clean.serialize())));expect(restored.dirty).toBe(false);expect(restored.needsInitialSave).toBe(false);
    const unsaved=new DocumentModel({name:'new.txt',text:'not yet saved'});expect(unsaved.dirty).toBe(true);
    expect(new DocumentModel(JSON.parse(JSON.stringify(unsaved.serialize()))).dirty).toBe(true);
    // Missing metadata in an older recovery must never suppress its save prompt.
    expect(new DocumentModel({name:'old.md',text:'recovered',savedText:'recovered'}).dirty).toBe(true);
  });
  it('treats the untouched welcome guide as clean but asks to save edits',()=>{
    const d=new DocumentModel({name:'guide.md',text:'# Guide',savedText:'# Guide',needsInitialSave:false});
    expect(d.dirty).toBe(false);d.replace(2,7,'Edited');expect(d.dirty).toBe(true);d.undo();expect(d.dirty).toBe(false);
  });
});
