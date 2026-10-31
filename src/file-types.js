const typeExtensions=Object.freeze({
  markdown:['md','markdown'],text:['txt','text','log'],html:['html','htm','xhtml'],csv:['csv'],tsv:['tsv'],json:['json','jsonc','json5'],xml:['xml','svg','xsd','xsl','xslt'],
  javascript:['js','mjs','cjs','jsx'],typescript:['ts','mts','cts','tsx'],css:['css'],scss:['scss','sass'],less:['less'],yaml:['yaml','yml'],toml:['toml'],ini:['ini','cfg','conf','properties'],
  python:['py','pyw','pyi'],ruby:['rb'],php:['php'],sql:['sql'],shell:['sh','bash','zsh'],powershell:['ps1','psm1','psd1'],batch:['bat','cmd'],c:['c','h'],cpp:['cpp','cxx','cc','hpp','hxx'],csharp:['cs'],java:['java'],go:['go'],rust:['rs'],swift:['swift'],kotlin:['kt','kts'],r:['r'],lua:['lua'],perl:['pl','pm'],vue:['vue'],svelte:['svelte']
});
const extensionTypes=new Map(Object.entries(typeExtensions).flatMap(([kind,extensions])=>extensions.map(extension=>[extension,kind])));
const labels={markdown:'Markdown',text:'テキスト',html:'HTML',csv:'CSV',tsv:'TSV',json:'JSON',xml:'XML',javascript:'JavaScript',typescript:'TypeScript',css:'CSS',scss:'SCSS / Sass',less:'Less',yaml:'YAML',toml:'TOML',ini:'設定ファイル',python:'Python',ruby:'Ruby',php:'PHP',sql:'SQL',shell:'Shell',powershell:'PowerShell',batch:'バッチ',c:'C',cpp:'C++',csharp:'C#',java:'Java',go:'Go',rust:'Rust',swift:'Swift',kotlin:'Kotlin',r:'R',lua:'Lua',perl:'Perl',vue:'Vue',svelte:'Svelte'};
export const supportedTextExtensions=Object.freeze([...extensionTypes.keys()].map(extension=>'.'+extension));
export const SUPPORTED_TEXT_ACCEPT=supportedTextExtensions.join(',');
export function fileKind(doc){
  const name=String(typeof doc==='string'?doc:doc?.path||doc?.name||'').replaceAll('\\','/').split('/').at(-1)||'';
  const dot=name.lastIndexOf('.');if(dot<1)return 'text';
  return extensionTypes.get(name.slice(dot+1).toLowerCase())||'text';
}
const kindOf=value=>typeof value==='string'&&Object.hasOwn(labels,value)?value:fileKind(value);
export const isMarkdown=doc=>fileKind(doc)==='markdown';
export const previewKind=doc=>['html','csv','tsv'].includes(kindOf(doc))?kindOf(doc):null;
export const filetypeLabel=doc=>labels[kindOf(doc)]||labels.text;
