import { languages } from '@codemirror/language-data';
import { highlightTree, classHighlighter } from '@lezer/highlight';

export {languages};
export const codePresets=[
  {id:'',label:'プレーンテキスト',sample:''},
  {id:'html',label:'HTML',sample:'<!doctype html>\n<html lang="ja">\n<head>\n  <meta charset="UTF-8">\n  <title>タイトル</title>\n</head>\n<body>\n  <h1>見出し</h1>\n</body>\n</html>'},
  {id:'css',label:'CSS',sample:'body {\n  color: #222;\n  background: #fff;\n}'},
  {id:'javascript',label:'JavaScript',sample:'function greet(name) {\n  return `Hello, '+ '${name}' +'!`;\n}'},
  {id:'typescript',label:'TypeScript',sample:'function greet(name: string): string {\n  return `Hello, '+ '${name}' +'!`;\n}'},
  {id:'json',label:'JSON',sample:'{\n  "title": "メモ",\n  "enabled": true\n}'},
  {id:'python',label:'Python',sample:'def greet(name):\n    return f"Hello, {name}!"'},
  {id:'csharp',label:'C#',sample:'Console.WriteLine("Hello, world!");'},
  {id:'sql',label:'SQL',sample:'SELECT name, created_at\nFROM items\nWHERE enabled = 1;'},
  {id:'bash',label:'Bash / Shell',sample:'#!/usr/bin/env bash\necho "Hello, world!"'},
  {id:'powershell',label:'PowerShell',sample:'$message = "Hello, world!"\nWrite-Host $message'},
  {id:'yaml',label:'YAML',sample:'title: メモ\nenabled: true\nitems:\n  - first\n  - second'},
  {id:'markdown',label:'Markdown',sample:'# 見出し\n\n- 項目'}
];
const aliases={csharp:'C#',cs:'C#',bash:'Shell',sh:'Shell',shell:'Shell',ps1:'PowerShell',powershell:'PowerShell',yml:'YAML',md:'Markdown'};
export function codeLanguage(name){
  const key=(aliases[name?.toLowerCase()]||name||'').toLowerCase();
  return languages.find(l=>l.name.toLowerCase()===key||l.alias.some(a=>a.toLowerCase()===key)||l.extensions.includes(key));
}
export function codeHighlights(value,name,refresh){
  const description=codeLanguage(name);if(!description)return [];
  if(!description.support){description.load().then(()=>refresh?.()).catch(()=>{});return [];}
  const ranges=[];
  highlightTree(description.support.language.parser.parse(value),classHighlighter,(from,to,classes)=>ranges.push({from,to,classes}));
  return ranges;
}
