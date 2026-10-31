import {test,expect} from 'vitest';
import {markdownLink} from '../src/editing.js';
import {parseMarkdown} from '../src/render.js';
import {safeMarkdownUrl,safeBrowserUrl} from '../src/url-policy.js';

test('dialog Markdown escapes labels and delimiters and round trips through the parser',()=>{
  const label='a] [b\\c',url='https://example.com/a b)<>\nend';
  for(const image of [false,true]){
    const markdown=markdownLink(label,url,{image});
    const parsed=parseMarkdown(markdown).children[0].children[0];
    expect(parsed.type).toBe(image?'image':'link');
    expect(image?parsed.alt:parsed.children[0].value).toBe(label);
    expect(parsed.url).toBe('https://example.com/a b)%3C%3E%0Aend');
  }
});

test('Markdown destinations reject control-obfuscated and non-allowlisted schemes',()=>{
  for(const url of ['javascript:alert(1)','java\tscript:alert(1)','vbscript:x','data:text/html;base64,QQ==','data:image/svg+xml;base64,QQ==']){
    expect(safeMarkdownUrl(url)).toBe(false);expect(safeMarkdownUrl(url,{image:true})).toBe(false);
  }
  for(const url of ['./image.png','https://example.com/a.png','file:///C:/image.png','C:\\image.png','mdsplit-asset://a/b.png','data:image/png;base64,AA=='])expect(safeMarkdownUrl(url,{image:true})).toBe(true);
  expect(safeMarkdownUrl('mailto:contact@example.com')).toBe(true);
  expect(safeBrowserUrl('https://example.com/')).toBe('https://example.com/');
  expect(safeBrowserUrl('https://user:pass@example.com/')).toBeNull();
});

test('editable empty list items support tabs and do not confuse sentinel-like source text',()=>{
  const tree=parseMarkdown('\\uFDD0\n\n- \t',true);
  expect(tree.children[0].children[0].value).toBe('\\uFDD0');
  expect(tree.children.at(-1).type).toBe('list');
});
