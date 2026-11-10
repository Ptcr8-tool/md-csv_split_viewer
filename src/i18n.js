import {shellTranslations} from './i18n-shell.js';
import {settingsTranslations} from './i18n-settings.js';

const translations={...shellTranslations,...settingsTranslations};
const originals=new WeakMap();
let language='ja';
export function preferredLanguage(locale){return !locale||/^ja(?:-|$)/i.test(locale)?'ja':'en';}
export function normalizeLanguage(value,locale){return value==='ja'||value==='en'?value:preferredLanguage(locale);}
export function setUiLanguage(value){const previous=language;language=normalizeLanguage(value,globalThis.navigator?.language);if(typeof document!=='undefined'){document.documentElement.lang=language;if(previous!==language)document.dispatchEvent(new Event('mdsplit-languagechange'));}}
export function currentUiLanguage(){return language;}

// Only call on application-owned control roots. Never traverse editable content,
// the outline tree, open file tabs, previews, recent-file lists, or document text.
export function translateControls(root){
  if(!root)return;
  const blocked='[contenteditable], #source, #preview, #text-preview, #outline-tree, .tabbar, #chunks, .cm-editor, [data-document-content]';
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT,{
    acceptNode(node){const el=node.nodeType===Node.ELEMENT_NODE?node:node.parentElement;return el?.matches(blocked)||el?.closest(blocked)?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT;}
  });
  const nodes=[root];while(walker.nextNode())nodes.push(walker.currentNode);
  for(const node of nodes){
    if(node.nodeType===Node.TEXT_NODE){
      const value=node.nodeValue,trimmed=value.trim();if(!trimmed)continue;
      const previous=originals.get(node);const source=previous&&value===previous.rendered?previous.source:value;
      const key=source.trim(),translated=language==='en'?translations[key]:null;
      const next=translated?source.replace(key,translated):source;
      if(next!==value)node.nodeValue=next;
      if(translations[key])originals.set(node,{source,rendered:next});
    }else if(node.nodeType===Node.ELEMENT_NODE){
      for(const attr of ['title','aria-label','placeholder']){
        const value=node.getAttribute(attr);if(!value)continue;
        let records=originals.get(node);if(!records||records.source)records={};
        const old=records[attr],source=old&&value===old.rendered?old.source:value;
        const next=language==='en'?(translations[source]||source):source;
        if(next!==value)node.setAttribute(attr,next);
        if(translations[source]){records[attr]={source,rendered:next};originals.set(node,records);}
      }
    }
  }
}
export function translateShell(){
  for(const selector of ['.topbar','.formatbar','#search-panel','.outline-heading','#outline-drawer','.pane-heading','.chunks-heading','.statusbar','.dialog-heading','.dialog-actions'])for(const root of document.querySelectorAll(selector))translateControls(root);
}
