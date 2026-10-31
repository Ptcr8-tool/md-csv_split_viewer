import {describe,it,expect} from 'vitest';
import {toggleList} from '../src/editing.js';
import {safeBrowserUrl,linkAt,outlineFromHeadings} from '../src/navigation.js';
import {runSearch} from '../src/search-core.js';
const change=(raw,selection,kind)=>{const c=toggleList(raw,selection,kind);return raw.slice(0,c.from)+c.insert+raw.slice(c.to);};
describe('list toggle and conversion',()=>{
  it('removes the same kind without losing CRLF or indentation',()=>{const raw='__keep__\r\n\r\n  - one\r\n  - two\r\n\r\nend';expect(change(raw,{from:raw.indexOf('one'),to:raw.indexOf('two')+3},'bullet')).toBe(raw.replace('  - one','  one').replace('  - two','  two'));});
  it('changes the other kind, including checkboxes, instead of stacking markers',()=>{for(const raw of ['- text','7. text','- [x] text'])expect(change(raw,{from:raw.length,to:raw.length},raw.startsWith('7')?'bullet':'number')).toBe(raw.startsWith('7')?'- text':'1. text');});
  it('preserves child indentation when marker widths change',()=>{const raw='- parent\r\n  - child\r\n    - grandchild\r\n- next';expect(change(raw,{from:2,to:2},'number')).toBe('1. parent\r\n   - child\r\n     - grandchild\r\n- next');});
  it('adds a list to ordinary text and removes a numbered list',()=>{expect(change('  text',{from:2,to:2},'bullet')).toBe('  - text');expect(change('8. text',{from:4,to:4},'number')).toBe('text');});
});
describe('link navigation',()=>{
  it('finds Markdown, reference and plain URLs',()=>{for(const raw of ['[name](https://example.com/path)','[name][ref]\n\n[ref]: https://example.com/path'])expect(linkAt(raw,3)).toBe('https://example.com/path');expect(linkAt('URL: https://example.com/path).',15)).toBe('https://example.com/path');});
  it('rejects executable, file, credential and whitespace URLs',()=>{for(const url of ['javascript:alert(1)','file:///C:/test.exe','ms-settings:defaultapps','https://user:pass@example.com/','https://a.com/\n'])expect(safeBrowserUrl(url)).toBeNull();});
  it('closes sections at the next heading of equal or higher level',()=>{const raw='# A\n\na\n\n## B\n\nb\n\n# C\n\nc';const result=outlineFromHeadings([{from:0,to:3,level:1},{from:raw.indexOf('##'),to:raw.indexOf('##')+4,level:2},{from:raw.indexOf('# C'),to:raw.indexOf('# C')+3,level:1}],raw);expect(result[0].end).toBe(raw.indexOf('# C'));expect(result[1].end).toBe(result[0].end);expect(result[2].end).toBe(raw.length);});
});
describe('search and replacement',()=>{
  it('replaces captures using original context, including lookbehind',()=>{expect(runSearch({text:'a=123 b=45',pattern:'(?<==)(\\d+)',replacement:'[$1]',regex:true,action:'all'}).text).toBe('a=[123] b=[45]');});
  it('preserves unrelated mixed line endings and supports empty replacement',()=>{expect(runSearch({text:'keep\r\nold\nend\r\n',pattern:'old',replacement:'',action:'all'}).text).toBe('keep\r\n\nend\r\n');});
  it('supports replacement escapes and named groups',()=>{expect(runSearch({text:'key=value',pattern:'(?<key>\\w+)=(\\w+)',replacement:'${key}\\t$2\\r\\n',regex:true,action:'all'}).text).toBe('key\tvalue\r\n');});
  it('finds backward, wraps and handles zero-width expressions',()=>{expect(runSearch({text:'ab ab',pattern:'ab',direction:-1,from:0})).toMatchObject({from:3,to:5});expect(runSearch({text:'a\nb',pattern:'^',replacement:'> ',regex:true,action:'all'}).text).toBe('> a\n> b');});
  it('finds a new match before replacing when selection is not a match',()=>{expect(runSearch({text:'aa bb',pattern:'bb',replacement:'X',action:'replace',from:0,to:0})).toMatchObject({from:3,to:5,count:1});});
});
