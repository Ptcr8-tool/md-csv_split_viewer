import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileKind,isMarkdown,previewKind,filetypeLabel,SUPPORTED_TEXT_ACCEPT,supportedTextExtensions} from '../src/file-types.js';
import {parseDelimited,encodeDelimitedCell,PREVIEW_LIMITS} from '../src/text-preview.js';

describe('file kind routing',()=>{
  it('keeps native open/save filter extensions and kinds consistent with the browser editor',()=>{
    const native=readFileSync(new URL('../native/TextFileTypes.cs',import.meta.url),'utf8');
    const entries=[...native.matchAll(/new\("[^"\r\n]+",\s*\[([^\]]*)\],\s*"([a-z]+)"\)/g)];
    expect(entries.length).toBeGreaterThan(20);
    const kinds=new Map();
    for(const [,list,kind] of entries)for(const [,extension] of list.matchAll(/"([a-z0-9]+)"/g)){
      expect(kinds.has(extension)).toBe(false);
      kinds.set(extension,kind);
      expect(fileKind(`file.${extension}`),extension).toBe(kind);
      expect(fileKind(`C:\\folder\\FILE.${extension.toUpperCase()}`),extension).toBe(kind);
    }
    for(const extension of supportedTextExtensions)expect(kinds.has(extension.slice(1)),extension).toBe(true);
    expect(fileKind('activity.log')).toBe('text');
    expect(previewKind('activity.log')).toBeNull();
    expect(filetypeLabel('activity.log')).toBe('テキスト');
    expect(fileKind('.md')).toBe('text');
  });
  it('uses case-insensitive basename extensions and prioritizes the actual path',()=>{
    expect(fileKind({path:'C:\\notes.folder\\EXAMPLE.CSV',name:'example.md'})).toBe('csv');expect(fileKind({name:'README.MARKDOWN'})).toBe('markdown');expect(fileKind('script.TSX')).toBe('typescript');expect(fileKind('folder.name/README')).toBe('text');expect(fileKind('.env')).toBe('text');expect(fileKind('unknown.exe')).toBe('text');
  });
  it('routes only Markdown into the rich editor and supports previews only for HTML and delimited tables',()=>{
    expect(isMarkdown({name:'note.md'})).toBe(true);expect(isMarkdown({name:'note.txt'})).toBe(false);expect(isMarkdown({name:'note.mdown'})).toBe(false);expect(previewKind({name:'page.xhtml'})).toBe('html');expect(previewKind('csv')).toBe('csv');expect(previewKind('example.tsv')).toBe('tsv');expect(previewKind('example.json')).toBeNull();expect(filetypeLabel('settings.yaml')).toBe('YAML');expect(filetypeLabel('javascript')).toBe('JavaScript');expect(SUPPORTED_TEXT_ACCEPT).toContain('.csv');expect(new Set(supportedTextExtensions).size).toBe(supportedTextExtensions.length);
  });
});
describe('bounded CSV and TSV parsing',()=>{
  it('preserves BOM offsets, quoted separators, escaped quotes, multiline CRLF and empty trailing fields',()=>{
    const raw='\ufeffname,note,last\r\n"a,b","first\r\nsecond ""quoted""",\r\nx,y,';const result=parseDelimited(raw);
    expect(result.rows).toEqual([['name','note','last'],['a,b','first\r\nsecond "quoted"',''],['x','y','']]);expect(result.columnCount).toBe(3);expect(result.rowRanges.map(range=>raw.slice(range.from,range.to))).toEqual(['name,note,last','"a,b","first\r\nsecond ""quoted""",','x,y,']);
  });
  it('does not invent an extra record for a terminal newline and preserves intentional blank records',()=>{
    expect(parseDelimited('').rows).toEqual([]);expect(parseDelimited('\ufeff').rows).toEqual([]);expect(parseDelimited('a,b\r\n').rows).toEqual([['a','b']]);expect(parseDelimited('a\n\n').rows).toEqual([['a'],['']]);expect(parseDelimited(',').rows).toEqual([['','']]);expect(parseDelimited('""').rows).toEqual([['']]);
  });
  it('accepts ragged rows and treats formula-like and HTML-looking content as plain strings',()=>{
    expect(parseDelimited('one\ttwo\n=SUM(A1)\t<img src=x>\tlast',{delimiter:'\t'}).rows).toEqual([['one','two'],['=SUM(A1)','<img src=x>','last']]);expect(parseDelimited('a;"b;c"',{delimiter:';'}).rows).toEqual([['a','b;c']]);
  });
  it('reports malformed quotes rather than silently changing source interpretation',()=>{
    for(const raw of ['"unclosed','ab"cd','"closed"tail','"closed" ,end'])expect(()=>parseDelimited(raw)).toThrow(/引用符/);expect(()=>parseDelimited('a|b',{delimiter:'|'})).toThrow(/区切り文字/);
  });
  it('stops for source, row, column, cell-count and individual-cell limits',()=>{
    for(const [raw,options] of [['12345',{maxSourceLength:4}],['a\nb\nc',{maxRows:2}],['a,b,c',{maxColumns:2}],['a,b\nc,d',{maxCells:3}],['a,b,c\nx',{maxCells:4}],['"long"',{maxCellLength:3}]])expect(()=>parseDelimited(raw,options)).toThrow(/確認が必要/);
    expect(()=>parseDelimited('x'.repeat(PREVIEW_LIMITS.maxSourceLength+1),{maxSourceLength:Infinity})).toThrow(/確認が必要/);expect(()=>parseDelimited('a,'.repeat(PREVIEW_LIMITS.maxColumns+1),{maxColumns:1e9})).toThrow(/列/);
  });
  it('accepts larger rows, columns and cells after explicit user approval',()=>{
    const rows=Array.from({length:1002},(_,i)=>String(i)).join('\n');
    expect(parseDelimited(rows,{unlimited:true}).rowCount).toBe(1002);
    expect(parseDelimited('x,'.repeat(101)+'z',{unlimited:true}).columnCount).toBe(102);
    const value='🙂'.repeat(17000);expect(parseDelimited(value,{unlimited:true}).rows[0][0]).toBe(value);
    const long='x'.repeat(PREVIEW_LIMITS.maxSourceLength+1);expect(parseDelimited(long,{unlimited:true}).rows[0][0]).toBe(long);
  });
  it('maps complete cell tokens in UTF-16 source offsets including BOM, quotes and multiline fields',()=>{
    const raw='\ufeff"🙂","a\r\nb","x""y",\r\nplain,tail',result=parseDelimited(raw);
    expect(result.cellRanges.map(row=>row.map(range=>raw.slice(range.from,range.to)))).toEqual([['"🙂"','"a\r\nb"','"x""y"',''],['plain','tail']]);
    expect(result.cellRanges[0][0]).toEqual({from:1,to:5,quoted:true});expect(result.cellRanges[0][3].from).toBe(result.cellRanges[0][3].to);expect(result.cellRanges[1][0].quoted).toBe(false);
  });
  it('changes one source token while preserving other quotes, spacing, BOM and mixed line endings exactly',()=>{
    const raw='\ufeff"keep", A ,"x""y"\r\nold,,last\nend';
    const cell=parseDelimited(raw).cellRanges[0][1],insert=encodeDelimitedCell('new,value',',',cell.quoted);
    const updated=raw.slice(0,cell.from)+insert+raw.slice(cell.to);
    expect(updated).toBe('\ufeff"keep","new,value","x""y"\r\nold,,last\nend');
    const quoted=parseDelimited(updated).cellRanges[0][2],simple=encodeDelimitedCell('simple',',',quoted.quoted);
    expect(simple).toBe('"simple"');expect(updated.slice(0,quoted.from)+simple+updated.slice(quoted.to)).toBe('\ufeff"keep","new,value","simple"\r\nold,,last\nend');
  });
  it('quotes edited delimiter, quote and newline values and preserves an originally quoted empty token',()=>{
    for(const delimiter of [',','\t',';'])for(const value of ['plain','value'+delimiter+'tail','"quoted"','line\r\nnext']){
      const token=encodeDelimitedCell(value,delimiter);expect(parseDelimited(token,{delimiter}).rows).toEqual([[value]]);
    }
    expect(encodeDelimitedCell('',',',true)).toBe('""');expect(encodeDelimitedCell('plain',',',true)).toBe('"plain"');expect(encodeDelimitedCell('plain')).toBe('plain');
  });
});

describe('CSV view and structural edits',()=>{
  it('normalizes view metadata and discards arbitrary content without interpreting it',async()=>{
    const {normalizeCsvView,csvCellAlignment}=await import('../src/csv-view.js');
    const v=normalizeCsvView({wrap:false,defaultColumnWidth:300,defaultRowHeight:70,freezeRows:2,hiddenColumns:[2,2,-1],columnWidths:{1:250,'__proto__':100},cellAlignment:{'1:2':{horizontal:'right',vertical:'viewport'}},source:'private content',columnAlignment:{1:{horizontal:'center',vertical:'middle'}}});
    expect(v.wrap).toBe(false);expect(v.hiddenColumns).toEqual([2]);expect(v.columnWidths[1]).toBe(250);expect(v.source).toBeUndefined();expect(csvCellAlignment(v,1,2)).toEqual({horizontal:'right',vertical:'viewport'});expect(csvCellAlignment(v,5,1).horizontal).toBe('center');expect(normalizeCsvView(v)).toEqual(v);expect(normalizeCsvView({freezeRows:1000000,freezeColumns:1000000})).toMatchObject({freezeRows:100,freezeColumns:50});
  });
  it('deletes nonadjacent complete records while keeping BOM, multiline tokens and untouched line endings',async()=>{
    const {deleteDelimitedSelection}=await import('../src/csv-view.js');const raw='\ufeffname,note\r\n"keep","one\r\ntwo"\r\nremove,x\nlast,y';
    expect(deleteDelimitedSelection(raw,parseDelimited(raw),'row',[0,2])).toBe('\ufeff"keep","one\r\ntwo"\r\nlast,y');expect(deleteDelimitedSelection(raw,parseDelimited(raw),'row',[3])).toBe('\ufeffname,note\r\n"keep","one\r\ntwo"\r\nremove,x\n');
  });
  it('deletes columns without rewriting other field tokens or record separators',async()=>{
    const {deleteDelimitedSelection}=await import('../src/csv-view.js');const raw='\ufeff" A ",B,"C"\r\n"x""y",z,"line\r\nend"\nragged';
    expect(deleteDelimitedSelection(raw,parseDelimited(raw),'column',[1])).toBe('\ufeff" A ","C"\r\n"x""y","line\r\nend"\nragged');expect(deleteDelimitedSelection(raw,parseDelimited(raw),'column',[0,2])).toBe('\ufeffB\r\nz\n');expect(deleteDelimitedSelection(raw,parseDelimited(raw),'column',[0,1,2])).toBe('\ufeff');
  });
});
