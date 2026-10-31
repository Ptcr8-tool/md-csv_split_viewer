import {describe,it,expect} from 'vitest';
import {encodingChoices,defaultBom,readBrowserFile,encodeBrowserText,MAX_BROWSER_FILE_BYTES} from '../src/text-codecs.js';
import sharedDetectionCases from './fixtures/codec-detection.json';
const file=(bytes,name='sample.txt')=>({name,size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer});
describe('shared browser and Windows detection vectors',()=>{
  for(const vector of sharedDetectionCases)it(vector.name,async()=>{
    if(vector.error){await expect(readBrowserFile(file(vector.bytes),vector.forced)).rejects.toThrow();return;}
    const read=await readBrowserFile(file(vector.bytes),vector.forced);
    expect({text:read.text,encoding:read.encoding,guessed:read.encodingGuessed,bom:read.hasBom}).toEqual({text:vector.text,encoding:vector.encoding,guessed:vector.guessed,bom:vector.bom});
  });
});
describe('browser Unicode file codecs',()=>{
  it('automatically opens and losslessly saves UTF-8 BOM CSV with complex emoji and quoted multiline fields',async()=>{
    const text='名前,本文\r\n"友人","家族 👨‍👩‍👧‍👦 🇯🇵 ❤️\r\n笑顔 😀"\r\n';
    const bytes=encodeBrowserText(text,'utf8bom',true),read=await readBrowserFile(file(bytes,'emoji.csv'));
    expect(read.text).toBe(text);expect(read.encoding).toBe('utf8bom');expect(read.hasBom).toBe(true);
    expect(encodeBrowserText(read.text,read.encoding,read.hasBom)).toEqual(bytes);
  });
  it('round trips all Unicode encodings, BOM choices, astral characters and mixed line endings exactly',async()=>{
    const text='日本語\r\n🙂 é\n\t 　末尾\r';
    for(const encoding of ['utf8','utf8bom','utf16le','utf16be','utf32le','utf32be'])for(const bom of [false,true]){
      const bytes=encodeBrowserText(text,encoding,bom),read=await readBrowserFile(file(bytes),encoding);
      expect(read.text).toBe(text);expect(read.savedText).toBe(text);expect(read.hasBom).toBe(bom);expect(read.savedHasBom).toBe(bom);expect(read.encodingGuessed).toBe(false);expect(read.encoding).toBe(encoding.startsWith('utf8')?bom?'utf8bom':'utf8':encoding);
    }
  });
  it('detects UTF-32 before overlapping UTF-16 BOM and preserves a content BOM after the encoding BOM',async()=>{
    for(const encoding of ['utf32le','utf32be','utf16le','utf16be','utf8bom']){
      const read=await readBrowserFile(file(encodeBrowserText('\ufeffcontent',encoding,true)));expect(read.text).toBe('\ufeffcontent');expect(read.encoding).toBe(encoding);expect(read.hasBom).toBe(true);
    }
  });
  it('recognizes plausible BOM-less UTF-16 and marks automatic inference clearly',async()=>{
    for(const encoding of ['utf16le','utf16be']){const read=await readBrowserFile(file(encodeBrowserText('alpha\r\nbeta',encoding,false)));expect(read.text).toBe('alpha\r\nbeta');expect(read.encoding).toBe(encoding);expect(read.hasBom).toBe(false);expect(read.encodingGuessed).toBe(true);expect(read.encodingNotice).toContain('推測');}
  });
  it('never replaces invalid Unicode bytes or lone JavaScript surrogates silently',async()=>{
    for(const [bytes,encoding] of [[[0xc0,0xaf],'utf8'],[[0x00,0xd8],'utf16le'],[[0,0,0x11,0],'utf32le'],[[0,0xd8,0,0],'utf32le'],[[0,0,0],'utf32be']])await expect(readBrowserFile(file(bytes),encoding)).rejects.toThrow();
    for(const text of ['\ud800','x\udc00','\ud800x'])for(const encoding of ['utf8','utf16le','utf32be'])expect(()=>encodeBrowserText(text,encoding)).toThrow(/Unicode/);
    expect((await readBrowserFile(file(encodeBrowserText('valid � character','utf8')))).text).toBe('valid � character');
  });
  it('rejects a forced encoding conflicting with the BOM and normalizes explicit UTF-8 labels by actual BOM',async()=>{
    await expect(readBrowserFile(file(encodeBrowserText('hello','utf16le',true)),'utf8')).rejects.toThrow(/BOM/);
    expect((await readBrowserFile(file(encodeBrowserText('hello','utf8',false)),'utf8bom')).encoding).toBe('utf8');expect((await readBrowserFile(file(encodeBrowserText('hello','utf8',true)),'utf8')).encoding).toBe('utf8bom');
  });
  it('guards binary data and file size, while manual encoding remains an explicit escape hatch',async()=>{
    await expect(readBrowserFile(file([65,0,66]))).rejects.toThrow(/バイナリ/);expect((await readBrowserFile(file([65,0,66]),'utf8')).text).toBe('A\0B');await expect(readBrowserFile(file([1,2,3,4,5]))).rejects.toThrow(/バイナリ/);
    let read=false;await expect(readBrowserFile({name:'large.txt',size:MAX_BROWSER_FILE_BYTES+1,arrayBuffer:async()=>{read=true;return new ArrayBuffer(0);}})).rejects.toThrow(/64MB/);expect(read).toBe(false);
  });
  it('permits a file reported above the browser size guard only when the caller explicitly confirms',async()=>{
    let reads=0;const data=new TextEncoder().encode('絵文字 😀');
    const large={name:'large.csv',size:MAX_BROWSER_FILE_BYTES+1,arrayBuffer:async()=>{reads++;return data.buffer;}};
    await expect(readBrowserFile(large)).rejects.toThrow(/64MB/);expect(reads).toBe(0);
    expect((await readBrowserFile(large,undefined,{allowLarge:true})).text).toBe('絵文字 😀');expect(reads).toBe(1);
  });
  it('uses defined BOM defaults and can save an empty file in every Unicode encoding',async()=>{
    expect(defaultBom('utf8')).toBe(false);expect(defaultBom('utf8bom')).toBe(true);expect(defaultBom('shiftjis')).toBe(false);
    for(const encoding of ['utf16le','utf16be','utf32le','utf32be']){expect(defaultBom(encoding)).toBe(true);expect((await readBrowserFile(file(encodeBrowserText('',encoding)),encoding)).text).toBe('');}
    expect(new Set(encodingChoices.map(choice=>choice.id)).size).toBe(13);
  });
});
describe('browser legacy decoding',()=>{
  it('opens CP932 and EUC-JP examples with a visible inference notice',async()=>{
    for(const [bytes,encoding] of [[[0x82,0xb1,0x82,0xf1,0x82,0xc9,0x82,0xbf,0x82,0xcd],'shiftjis'],[[0xa4,0xb3,0xa4,0xf3,0xa4,0xcb,0xa4,0xc1,0xa4,0xcf],'eucjp']]){const read=await readBrowserFile(file(bytes));expect(read.text).toBe('こんにちは');expect(read.encoding).toBe(encoding);expect(read.encodingGuessed).toBe(true);expect(read.encodingNotice).toContain('開き直し');}
  });
  it('recognizes ISO-2022-JP escapes before binary controls and supports explicit other code pages',async()=>{
    const jis=[0x1b,0x24,0x42,0x46,0x7c,0x4b,0x5c,0x38,0x6c,0x1b,0x28,0x42];expect((await readBrowserFile(file(jis))).text).toBe('日本語');
    expect((await readBrowserFile(file([...new Uint8Array(70000).fill(65),...jis]))).text).toBe('A'.repeat(70000)+'日本語');
    for(const [bytes,encoding,text] of [[[0x63,0x61,0x66,0xe9,0x20,0x80],'windows1252','café €'],[[0xc4,0xe3,0xba,0xc3],'gb18030','你好'],[[0xa7,0x41,0xa6,0x6e],'big5','你好'],[[0xb0,0xa1],'korean949','가']])expect((await readBrowserFile(file(bytes),encoding)).text).toBe(text);
  });
  it('requires Windows for legacy output and never emits UTF-8 under a legacy encoding selection',()=>{
    for(const choice of encodingChoices.filter(choice=>!choice.id.startsWith('utf')))expect(()=>encodeBrowserText('日本語',choice.id)).toThrow(/この文字コードでの保存はWindows版/);
  });
});
