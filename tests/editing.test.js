import {test,expect} from 'vitest';
import {lineAt,listLine,enterList,backspaceList,indentList,indentText,fenceInfo,patchCode,codeFence} from '../src/editing.js';
const apply=(raw,c)=>raw.slice(0,c.from)+c.insert+raw.slice(c.to);

test('empty list exit preserves surrounding CRLF and creates a paragraph boundary',()=>{
  const raw='__keep__  \r\n\r\n- first\r\n- ',at=raw.length,c=enterList(raw,{from:at,to:at});
  expect(apply(raw,c)).toBe('__keep__  \r\n\r\n- first\r\n\r\n');expect(c.selection.from).toBe(apply(raw,c).length);
});
test('checked items continue as unchecked and ordered marker punctuation is retained',()=>{
  for(const [raw,expected] of [['- [x] done','- [x] done\n- [ ] '],['9) nine','9) nine\n10) ']])expect(apply(raw,enterList(raw,{from:raw.length,to:raw.length}))).toBe(expected);
});
test('list indentation carries its descendants and reverses exactly',()=>{
  const raw='- parent\r\n- child\r\n  - nested\r\n- tail',from=raw.indexOf('child'),c=indentList(raw,{from,to:from});const changed=apply(raw,c);
  expect(changed).toBe('- parent\r\n  - child\r\n    - nested\r\n- tail');expect(apply(changed,indentList(changed,c.selection,true))).toBe(raw);
});
test('ordered-list child uses its parent marker width and Backspace removes one level',()=>{
  const raw='10. parent\n11. child',at=raw.indexOf('child'),c=indentList(raw,{from:at,to:at}),changed=apply(raw,c);
  expect(changed).toBe('10. parent\n    11. child');expect(apply(changed,backspaceList(changed,c.selection))).toBe(raw);
});
test('plain Tab is a literal U+0009 and line lookup handles a leading newline',()=>{
  expect(apply('ab',indentText('ab',{from:1,to:1}))).toBe('a\tb');expect(lineAt('\na',0)).toMatchObject({start:0,end:0,text:''});
});
test('empty tight fenced blocks retain a separator when their body is edited',()=>{
  const raw='```html\r\n```',info=fenceInfo(raw,0,raw.length),c=patchCode(raw,info,info.contentFrom,info.contentTo,'<h1>Hi</h1>');
  expect(info.contentFrom).toBe(info.contentTo);expect(apply(raw,c)).toBe('```html\r\n<h1>Hi</h1>\r\n```');
});
test('deleting all code keeps both fences and a later empty-line caret stays inside',()=>{
  const raw='~~~js\r\nhello\r\n~~~',info=fenceInfo(raw,0,raw.length),c=patchCode(raw,info,info.contentFrom,info.contentTo,'');const empty=apply(raw,c);
  expect(empty).toBe('~~~js\r\n\r\n~~~');const next=fenceInfo(empty,0,empty.length);expect(apply(empty,patchCode(empty,next,next.contentFrom,next.contentTo,'\r\n'))).toBe('~~~js\r\n\r\n\r\n~~~');
});
test('embedded closing fences expand only delimiters and keep following Markdown unchanged',()=>{
  const raw='```text\nbody\n```\n\n__keep__',info=fenceInfo(raw,0,16),c=patchCode(raw,info,info.contentFrom,info.contentTo,'```');
  expect(apply(raw,c)).toBe('````text\n```\n````\n\n__keep__');expect(codeFence('```','html')).toBe('````html\n```\n````');
});
test('an unfinished opening fence becomes editable code instead of a language suffix',()=>{
  const raw='```html',info=fenceInfo(raw,0,raw.length),c=patchCode(raw,info,info.contentFrom,info.contentTo,'text');expect(apply(raw,c)).toBe('```html\ntext');
});
