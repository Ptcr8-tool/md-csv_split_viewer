import { EditorState, EditorSelection, Compartment, Prec } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { LanguageDescription, syntaxHighlighting } from '@codemirror/language';
import { sourceHighlightStyle, sourceEditorTheme } from './source-theme.js';
import TurndownService from 'turndown';
import { gfm as turndownGfm } from 'turndown-plugin-gfm';
import DOMPurify from 'dompurify';
import { DocumentModel, normalized, difference, rawToLf, lfToRaw, preferredEol, escapeLiteral, replaceRich } from './document.js';
import { RichRenderer, parseMarkdown } from './render.js';
import {collectImageReferences} from './image-references.js';
import {fileKind,isMarkdown,previewKind,filetypeLabel} from './file-types.js';
import {TextPreview} from './text-preview.js';
import {normalizeCsvView} from './csv-view.js';
import {initialViewMode,isViewMode,presentationFor,presentationCapabilities,normalizeFileTypeSettings,updateFileTypeSettings} from './view-preference.js';
import {APP_TITLE} from './brand.js';
import {applicationShell} from './app-shell.js';
import {installToolbarFolding} from './toolbar-folding.js';
import {encodingChoices,defaultBom,readBrowserFile,encodeBrowserText,MAX_BROWSER_FILE_BYTES} from './text-codecs.js';
import './file-editor.css';
import { splitDiscord } from './discord.js';
import { host, isDesktop, onHost } from './bridge.js';
import {languages,codePresets,codeLanguage} from './code-languages.js';
import {visibleWhitespace,applyWhitespaceStyles,refreshWhitespaceMarkers} from './whitespace.js';
import {countLineEndings,replaceLineEndings} from './eol-tools.js';
import {sourceWrapExtension,sourceWrapMode} from './source-wrap.js';
import {showSettings} from './settings-panel.js';
import {createPaneHub,paneSide,setupViewControls} from './panes.js';
import './panes.css';
import {lineAt,listLine,indentList,enterList,backspaceList,indentText,fenceInfo,patchCode,codeFence,toggleList,markdownLink} from './editing.js';
import {WorkspaceFeatures} from './workspace-features.js';
import {safeBrowserUrl} from './navigation.js';
import {showHelp} from './help.js';
import {UpdateController} from './updates.js';
import {RecoveryWriter} from './recovery.js';
import {installFileDropOverlay} from './file-drop-overlay.js';
import {buildPrintContent,setPrintContent} from './print.js';
import './style.css';
import './themes.css';
import './workspace-features.css';

const $=s=>document.querySelector(s);
$('#app').innerHTML=applicationShell();
installToolbarFolding();

let settings={openPolicy:'tabs',sessionPolicy:'clear',startupFormat:'md',theme:'dark',colorTheme:'black',fontSize:15,wrap:true,sync:true,outlineVisible:true,viewMode:'split',defaultViewMode:'last',welcomeShown:false,updateCheckDays:7,ratio:0.47,limit:2000,softBreaks:true,showLineBreaks:false,showFullWidthSpaces:false,showTabs:false,showSpaces:false};
const textPreview=new TextPreview($('#text-preview'),{
  dialogOpen(open){csvDialogOpen=!!open;if(paneSession)paneSession.setDialogOpen(open);else paneHub?.refresh();},
  viewChanged(id,view){const d=documents.find(d=>d.id===id);if(d){d.csvView=normalizeCsvView(view);publishPeers();}},
  saveView(id,view){return guard(()=>csvSidecar('save',id,view))();},
  loadView(id){return guard(()=>csvSidecar('load',id))();},
  canEdit(id){const d=documents.find(d=>d.id===id);return !!d&&!d.composing&&!$('#app').inert&&!paneSession?.isLocked()&&!paneHub?.childDialogOpen()&&(!d.componentEditing||d.componentEditing===window);},
  history(redo){history(redo);},
  patch({docId,from,to,insert,kind}){const d=documents.find(d=>d.id===docId);if(!d||d.composing||$('#app').inert||paneSession?.isLocked()||paneHub?.childDialogOpen()||d.componentEditing&&d.componentEditing!==window)return false;const expected=d.raw.slice(0,from)+insert+d.raw.slice(to);if(d===current())apply(from,to,insert,kind==='command'?'command':'csv',{keepTextPreviewEditor:true});else{d.replace(from,to,insert,kind==='command'?'command':'csv');renderTabs();saveRecovery();}return d.raw===expected;},
  position(id,at){const d=documents.find(d=>d.id===id);if(d&&d===current()){const position=Math.min(d.raw.length,Math.max(0,at));d.selection=lastSelection={from:position,to:position};features.active(position);updateStatus();publishPosition(position);}},
  editing(id,active){const d=documents.find(d=>d.id===id);if(d){if(active){d.componentEditing=window;const at=textPreview.editing?.from;if(d===current()&&typeof at==='number'){features.active(at);publishPosition(at);}}else if(d.componentEditing===window)d.componentEditing=null;}},
  composing(id,active){const d=documents.find(d=>d.id===id);if(d){if(active){d.composing=true;d.compositionOwner=window;}else if(d.compositionOwner===window){d.composing=false;d.compositionOwner=null;}publishPeers();}}
});
const detachedSide=paneSide();let paneSession=null,paneHub=null,updateView=()=>{},csvDialogOpen=false;
let documents=[],activeId=null,mode='normal',side='source',cm=null,refreshing=false,composing=false,compositionRange=null,sourceBusy=false,renderTimer=0,recoveryTimer=0,scrollLock=0,showChunks=false;
let lastSelection={from:0,to:0},plainPasteNext=false,sourceCompositionDocument=null;const languageConfig=new Compartment();let sourceLanguageKey=null,languageEpoch=0;const wrapConfig=new Compartment(),sourceThemeConfig=new Compartment(),whitespaceConfig=new Compartment();
const rich=new RichRenderer($('#preview'),{
  patch:(from,to,insert,options={})=>apply(from,to,insert,'command',options),
  refresh:()=>render(),copyText:text=>guard(()=>copyText(text))(),openLink:url=>guard(()=>openLink(url))(),
  imageUrl:(url,id)=>imageUrl(url,id),editImage:(from,to,node)=>guard(()=>editImage(from,to,node))(),copyDiagram:(stage,format)=>guard(()=>diagramCopy(stage,format))(),
  codeLanguage:(info,value)=>apply(info.languageFrom,info.languageTo,value,'command',{selection:{from:info.contentFrom+value.length-(info.languageTo-info.languageFrom),to:info.contentFrom+value.length-(info.languageTo-info.languageFrom)}}),toggleHeading:from=>features.toggleHeading(from)
});
const td=new TurndownService({headingStyle:'atx',codeBlockStyle:'fenced',bulletListMarker:'-'});td.use(turndownGfm);
const current=()=>documents.find(d=>d.id===activeId);
const md=()=>isMarkdown(current());
const isHtml=()=>fileKind(current())==='html';
function effectiveView(){if(detachedSide==='source')return 'source';if(detachedSide==='preview')return md()||previewKind(current())?'preview':'source';return md()||previewKind(current())?current()?.previewViewMode||initialViewMode(settings,fileKind(current())):'source';}
// On a narrow window, start with the navigation tucked away without changing
// the stored Markdown preference. An explicit toggle remains persistent.
const narrowOutline=window.matchMedia('(max-width: 800px)');
let autoHideOutline=narrowOutline.matches;
function viewSettings(){return {...settings,...presentationFor(settings,fileKind(current())),...(autoHideOutline?{outlineVisible:false}:{}),viewMode:effectiveView()};}
async function setPresentationSettings(change){await setSettings({fileTypeSettings:updateFileTypeSettings(settings,fileKind(current()),change)});saveRecovery();}
async function toggleOutline(){const next=!viewSettings().outlineVisible;autoHideOutline=false;await setPresentationSettings({outlineVisible:next});}
async function setViewSettings(change){if(isViewMode(change.viewMode)&&presentationCapabilities(fileKind(current())).view)current().previewViewMode=change.viewMode;await setPresentationSettings(change);}
const listen=(selector,event,fn)=>$(selector).addEventListener(event,fn);
$('[data-cmd="outline"]').id='outline-toggle';$('[data-cmd="sync"]').id='sync-toggle';
const features=new WorkspaceFeatures({current,editor:()=>cm,settings:viewSettings,isMarkdown:md,isHtml,textPreview:()=>textPreview,rich,guard,notify,render,dialog,apply,openLink,onScrollAnchor(anchor){if(paneSession)paneSession.scroll(anchor);else paneHub?.scroll(activeId,anchor);},selectSource(s){if(!md()&&!isHtml()&&effectiveView()==='preview'){current().previewViewMode='split';updateDocumentLayout();updateView();cm?.requestMeasure();}lastSelection=current().selection=s;if(md()&&effectiveView()==='preview'){side='preview';rich.restoreSelection(s.from,s.to);return;}side='source';cm.dispatch({selection:EditorSelection.range(rawToLf(current().raw,s.from),rawToLf(current().raw,s.to)),effects:EditorView.scrollIntoView(rawToLf(current().raw,s.from),{y:'center'})});cm.focus();}});
async function toggleOutlineFromPane(focusTarget){if(sourceBusy||composing||current()?.composing){notify('入力の変換を確定してから操作してください。');return;}await toggleOutline();$(focusTarget).focus();}
listen('#source-wrap-mode','change',guard(async event=>{const wrapMode=event.target.value;await setSettings({wrapMode,wrap:wrapMode!=='none'});}));
listen('#outline-close','click',guard(()=>toggleOutlineFromPane('#outline-drawer')));
listen('#outline-drawer','click',guard(()=>toggleOutlineFromPane('#outline-close')));
narrowOutline.addEventListener('change',event=>{autoHideOutline=event.matches;if(current()&&cm){updateDocumentLayout();features.render();cm.requestMeasure();}});
const recoveryWriter=new RecoveryWriter({host,documents:()=>documents,ensureRegistered,mode:()=>mode,activeId:()=>activeId,isDesktop});
const updates=new UpdateController({settings:()=>settings,documents:()=>documents,notify,dialog,saveDocument,switchDocument,render,ensureRegistered,clearRecoveryTimer:()=>clearTimeout(recoveryTimer),writeRecovery:reason=>recoveryWriter.write(reason),mode:()=>mode,activeId:()=>activeId});
function notify(text,error=false){const n=$('#toast');n.textContent=text;n.className=error?'visible error':'visible';clearTimeout(n._timer);n._timer=setTimeout(()=>n.className='',error?6500:2600);}
function guard(fn){return (...args)=>{try{return Promise.resolve(fn(...args)).catch(e=>notify(e.message||String(e),true));}catch(e){notify(e.message||String(e),true);}};}
function newDocument(data={}){const d=new DocumentModel(data);d.nativeRegistration=isDesktop?host('document.register',{id:d.id,name:d.name}).catch(error=>{d.registrationError=error;}):Promise.resolve();d.previewViewMode=initialViewMode(settings,fileKind(d));documents.push(d);switchDocument(d.id);if(d.encodingNotice)notify(d.encodingNotice);return d;}
async function ensureRegistered(d){if(d.nativeRegistration)await d.nativeRegistration;if(d.registrationError)throw d.registrationError;}
function switchDocument(id){activeId=id;lastSelection=current().selection;side=md()&&effectiveView()==='preview'?'preview':'source';render({resetSource:true});saveRecovery();}
function selection(){const d=current();if(!d)return {from:0,to:0};if(md()&&side==='preview'){const s=rich.selection();if(s)lastSelection=s;}else if(cm){const s=cm.state.selection.main;lastSelection={from:lfToRaw(d.raw,s.from),to:lfToRaw(d.raw,s.to)};}return {...lastSelection};}
const markdownCommands=new Set(['bold','italic','strike','underline','spoiler','inlinecode','bullet','number','check','quote','subtext','link','image','table','code','mermaid','details','rule','copy-rich']);
function clearRichState(){rich.source='';rich.leaves=[];rich.formats=[];rich.images=[];rich.codeBlocks=[];rich.headings=[];if($('#preview').childNodes.length)$('#preview').replaceChildren();}
function updateDocumentLayout(){const undoParent=md()?$('.formatbar'):$('#text-edit-actions');for(const command of ['undo','redo']){const b=$('[data-cmd="'+command+'"]');if(b.parentElement!==undoParent)undoParent.append(b);}$('#text-edit-actions').hidden=md();$('#source').setAttribute('aria-label',md()?'Markdown原文':filetypeLabel(current())+'原文');const kind=fileKind(current()),hasPreview=md()||!!previewKind(current());$('#app').dataset.documentKind=kind;$('.editor-panes').dataset.view=effectiveView();$('#outline-panel').hidden=!presentationCapabilities(kind).outline||!viewSettings().outlineVisible;$('#outline-drawer').hidden=!presentationCapabilities(kind).outline||viewSettings().outlineVisible||!!detachedSide;$('[data-cmd="outline"]').hidden=!presentationCapabilities(kind).outline;for(const cmd of ['mode-normal','mode-discord'])$('[data-cmd="'+cmd+'"]').hidden=!md();$('.render-toggle').hidden=!md();$('[data-cmd="sync"]').hidden=!presentationCapabilities(kind).sync;$('.view-controls').hidden=!hasPreview;$('[data-cmd="copy-rich"]').hidden=!md();$('[data-cmd="popout-preview"]').hidden=!hasPreview;if(!md()){$('.chunks-panel').hidden=true;showChunks=false;}}
function configureSourceLanguage(){const d=current(),kind=fileKind(d),key=kind+':'+d.name;if(key===sourceLanguageKey)return;sourceLanguageKey=key;const editor=cm,epoch=++languageEpoch;const install=extension=>{if(editor!==cm||epoch!==languageEpoch)return;if(sourceBusy||composing){setTimeout(()=>install(extension),50);return;}editor.dispatch({effects:languageConfig.reconfigure(extension)});};if(kind==='markdown'){install(markdown({codeLanguages:languages}));return;}const language=LanguageDescription.matchFilename(languages,d.name)||codeLanguage(kind);if(!language){install([]);return;}if(language.support)install(language.support);else{install([]);language.load().then(install).catch(()=>{});}}
function createEditor(text){
  const customKeys=[{key:'Mod-z',run:()=>{history(false);return true;}},{key:'Mod-y',run:()=>{history(true);return true;}},{key:'Mod-Shift-z',run:()=>{history(true);return true;}},{key:'Tab',run:()=>sourceKey('tab')},{key:'Shift-Tab',run:()=>sourceKey('outdent')},{key:'Backspace',run:()=>sourceKey('backspace')},{key:'Enter',run:()=>sourceKey('enter')}];
  sourceLanguageKey=null;
  cm=new EditorView({parent:$('#source'),state:EditorState.create({doc:normalized(text),extensions:[features.extensions(),lineNumbers(),highlightActiveLine(),drawSelection(),languageConfig.of(md()?markdown({codeLanguages:languages}):[]),syntaxHighlighting(sourceHighlightStyle),sourceThemeConfig.of(sourceEditorTheme(document.documentElement.dataset.theme==='dark')),whitespaceConfig.of(visibleWhitespace(settings,()=>current()?.raw??'')),Prec.highest(keymap.of(customKeys)),keymap.of(defaultKeymap),wrapConfig.of(sourceWrapExtension(settings)),EditorView.updateListener.of(u=>{
    if(refreshing||!current())return;
    if(u.docChanged){const d=current();if(peerInputLocked()||u.startState.doc.toString()!==normalized(d.raw)){scheduleRender();notify('別の表示から更新されました。もう一度入力してください。');return;}side='source';const s=u.state.selection.main;d.editNormalized(normalized(d.raw),u.state.doc.toString(),{from:s.from,to:s.to});lastSelection=d.selection;saveRecovery();scheduleRender();}
    if(u.selectionSet){const d=current(),s=u.state.selection.main;d.selection=lastSelection={from:lfToRaw(d.raw,s.from),to:lfToRaw(d.raw,s.to)};updateStatus();features.active(d.selection.from);publishPosition(d.selection.from);}
  }),EditorView.domEventHandlers({mousedown:(e,view)=>features.sourcePointer(e,view),dblclick:(e,view)=>features.sourcePointer(e,view),focus:()=>{side='source';updateToolbar();},compositionstart:()=>{if(peerInputLocked())return true;sourceBusy=true;sourceCompositionDocument=current();current().composing=true;current().compositionOwner=window;publishPeers();},compositionend:()=>{const d=sourceCompositionDocument;if(!d)return;setTimeout(()=>{if(sourceCompositionDocument!==d)return;sourceCompositionDocument=null;sourceBusy=false;if(d.compositionOwner===window){d.composing=false;d.compositionOwner=null;}publishPeers();scheduleRender();},0);}})]})});
  cm.scrollDOM.addEventListener('scroll',()=>features.onScroll('source'));
}
function scheduleRender(){clearTimeout(renderTimer);renderTimer=setTimeout(()=>{if(!sourceBusy&&!composing)render();else scheduleRender();},35);}
function render(options={}){
  if(!current()||composing)return;clearTimeout(renderTimer);const d=current();
  const rightActive=md()&&side==='preview'&&document.hasFocus()&&($('#preview').contains(document.activeElement)||document.activeElement===$('#preview'));
  if(rightActive&&rich.source===d.raw){const s=rich.selection();if(s)lastSelection=s;}
  refreshing=true;
  if(options.resetSource&&cm){cm.destroy();$('#source').replaceChildren();cm=null;}
  if(!cm)createEditor(d.raw);
  const target=normalized(d.raw),present=cm.state.doc.toString();
  if(present!==target){const c=difference(present,target);cm.dispatch({changes:c,selection:{anchor:rawToLf(d.raw,d.selection.from),head:rawToLf(d.raw,d.selection.to)}});}
  if(settings.showLineBreaks)cm.dispatch({effects:refreshWhitespaceMarkers.of(null)});
  configureSourceLanguage();
  if(md()){textPreview.clear();$('#preview').hidden=false;rich.render(d.raw,mode,d.id,{...settings,selection:d.selection});}
  else{side='source';$('#preview').hidden=true;clearRichState();textPreview.render(d.raw,previewKind(d),{docId:d.id,fontSize:settings.fontSize,csvView:d.csvView});}
  updateDocumentLayout();
  if(rightActive)rich.restoreSelection(lastSelection.from,lastSelection.to,true);
  features.render();updateView();refreshing=false;renderTabs();updateToolbar();updateStatus();updateTitle();
  if(showChunks)renderChunks();
}
function apply(from,to,insert,kind='command',options={}){
  const d=current();if(!d||peerInputLocked())return;
  if(d.replace(from,to,insert,kind,options.selection)){lastSelection=d.selection;
    if(options.keepDiagramEditor){rich.rebase(from,to,insert);const c=difference(cm.state.doc.toString(),normalized(d.raw));refreshing=true;cm.dispatch({changes:c});refreshing=false;updateStatus();renderTabs();}
    else if(options.keepTextPreviewEditor){render();}
    else {render();if(md()&&side==='preview')rich.restoreSelection(d.selection.from,d.selection.to);else{refreshing=true;cm.dispatch({selection:EditorSelection.range(rawToLf(d.raw,d.selection.from),rawToLf(d.raw,d.selection.to))});refreshing=false;cm.focus();}}
    saveRecovery();
  }
}
function history(redo){if(peerInputLocked())return;if(!md()&&!textPreview.finishEdit())return;if((redo?current().redo():current().undo())){lastSelection=current().selection;render();if(md()&&side==='preview')rich.restoreSelection(lastSelection.from,lastSelection.to);else{cm.dispatch({selection:EditorSelection.range(rawToLf(current().raw,lastSelection.from),rawToLf(current().raw,lastSelection.to))});cm.focus();}saveRecovery();}}
function applyFor(d,from,to,insert){if(!documents.includes(d)||d.composing||$('#app').inert)return;if(d.id===activeId)apply(from,to,insert);else{d.replace(from,to,insert);renderTabs();saveRecovery();}}
function renderTabs(){const bar=$('.tabbar');bar.replaceChildren();for(const d of documents){const n=document.createElement('div');n.className='tab'+(d.id===activeId?' active':'');const b=document.createElement('button');b.className='tab-name';b.title=d.path||d.name;b.textContent=(d.dirty?'● ':'')+d.name;b.onclick=()=>switchDocument(d.id);const close=document.createElement('button');close.className='tab-close';close.textContent='×';close.setAttribute('aria-label',d.name+'を閉じる');close.onclick=guard(()=>closeDocument(d.id));n.append(b,close);bar.append(n);}}
function updateToolbar(){
  $('#source-wrap-mode').value=sourceWrapMode(settings);
  const markdownFile=md(),label=filetypeLabel(current()),pk=previewKind(current());
  $('#app').dataset.documentKind=fileKind(current());$('#source-label').textContent=markdownFile?'MARKDOWN':label.toUpperCase();
  const newType=fileKind(current()),knownNew=['markdown','text','html','json','csv','tsv','xml'];$('#new-format').value=knownNew.includes(newType)?({markdown:'md',text:'txt'}[newType]||newType):'txt';
  $('[data-cmd="copy-source"]').setAttribute('aria-label',markdownFile?'全文をMarkdownでコピー':'全文の原文をコピー');
  $('[data-cmd="copy-source"]').title=markdownFile?'全文をMarkdownでコピー':'全文の原文をコピー';
  $('.target-label').textContent=markdownFile?(side==='preview'?'文章を編集中':'原文を編集中'):label+'を編集中';
  $('[data-cmd="mode-normal"]').classList.toggle('selected',mode==='normal');$('[data-cmd="mode-discord"]').classList.toggle('selected',mode==='discord');
  $('[data-cmd="layout-windows"]').classList.toggle('selected',settings.openPolicy==='windows');$('[data-cmd="layout-tabs"]').classList.toggle('selected',settings.openPolicy==='tabs');
  for(const c of ['underline','spoiler','subtext'])$(`[data-cmd="${c}"]`).hidden=mode!=='discord';
  for(const c of ['table','check','mermaid','details','rule'])$(`[data-cmd="${c}"]`).disabled=!markdownFile||mode==='discord';
  $('#heading').querySelectorAll('option').forEach(o=>o.disabled=mode==='discord'&&Number(o.value)>3);
  $('#render-label').textContent=mode==='discord'?'DISCORD':'DOCUMENT';$('#preview-note').textContent=mode==='discord'?'Discord向けの表示':'そのまま編集できます';$('.discord-controls').hidden=!markdownFile||mode!=='discord';if(!markdownFile){$('#render-label').textContent=pk?'PREVIEW':'TEXT';$('#preview-note').textContent=pk==='html'?'読み取り専用プレビュー':pk?'セルをダブルクリックして編集':'';}
  $('[data-cmd="undo"]').disabled=!current()?.undoStack.length;$('[data-cmd="redo"]').disabled=!current()?.redoStack.length;
  const paper=settings.colorTheme?.startsWith('parchment');
  $('.brightness-controls').setAttribute('aria-disabled',String(!!paper));
  for(const value of ['light','dark','system']){const b=$('[data-cmd="theme-'+value+'"]');b.disabled=!!paper;b.classList.toggle('selected',settings.theme===value);b.setAttribute('aria-pressed',String(settings.theme===value));b.title=paper?'羊皮紙では明るさを固定します':{light:'ライト',dark:'ダーク',system:'システムに合わせる'}[value];}
  const pos=lastSelection.from;
  for(const cmd of ['bold','italic','strike','underline']){const tag={bold:'strong',italic:'em',strike:'s',underline:'u'}[cmd];const active=Array.from($('#preview').querySelectorAll(tag)).some(n=>{const leaves=n.querySelectorAll('[data-from]');return leaves.length&&pos>=Number(leaves[0].dataset.from)&&pos<=Number(leaves[leaves.length-1].dataset.to);});$(`[data-cmd="${cmd}"]`).classList.toggle('applied',active);}
}
function updateStatus(){const d=current();if(!d)return;$('#save-state').textContent=d.dirty?'未保存の変更':'保存済み';$('#save-state').title=$('#save-state').textContent;$('#save-state').classList.toggle('unsaved',d.dirty);const p=rawToLf(d.raw,lastSelection.from);const line=cm?.state.doc.lineAt(Math.min(p,cm.state.doc.length));$('#position').textContent=line?`${line.number}行 ${p-line.from+1}列`:'';$('#count').textContent=d.raw.length.toLocaleString()+'字';$('#encoding').textContent=(encodingChoices.find(c=>c.id===d.encoding)?.label||d.encoding)+(d.hasBom&&!defaultBom(d.encoding)?' · BOM':'');$('#encoding').title=d.encodingNotice||'文字コードを変更・開き直す';$('#encoding').classList.toggle('guessed',!!d.encodingGuessed);$('#limit-status').textContent=`${d.raw.length.toLocaleString()} / ${settings.limit.toLocaleString()}`;$('#limit-status').classList.toggle('over',d.raw.length>settings.limit);$('#limit').value=[2000,4000].includes(settings.limit)?String(settings.limit):'custom';}
function updateTitle(){const d=current();if(d)host('window.title',{title:`${d.dirty?'● ':''}${d.name}${detachedSide?' · '+(detachedSide==='source'?'原文':'展開表示'):''} — ${APP_TITLE}`}).catch(()=>{});}
function saveRecovery(){if(paneSession){paneSession.changed();return;}publishPeers();clearTimeout(recoveryTimer);recoveryTimer=setTimeout(()=>recoveryWriter.write().catch(e=>notify('復元データを保存できません: '+e.message,true)),650);}
async function setSettings(change){if(paneSession){await paneSession.setSettings(change);return;}if(change.fileTypeSettings&&current()){const kind=fileKind(current());if(presentationFor(settings,kind).outlineVisible!==presentationFor({...settings,...change},kind).outlineVisible)autoHideOutline=false;}settings={...settings,...change};settings.fileTypeSettings=normalizeFileTypeSettings(settings);applySettings();await host('settings.set',settings);publishPeers();}
function applySettings(){
  if(!md()||effectiveView()==='source')side='source';else if(effectiveView()==='preview')side='preview';
  const palette=['black','green','red','blue','parchment','parchment-texture'].includes(settings.colorTheme)?settings.colorTheme:'black';
  document.documentElement.dataset.palette=palette;
  document.documentElement.dataset.theme=palette.startsWith('parchment')?'light':settings.theme==='system'?(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'):settings.theme;
  document.documentElement.style.setProperty('--font-size',settings.fontSize+'px');document.documentElement.style.setProperty('--split',settings.ratio*100+'%');$('#zoom-label').textContent=Math.round(settings.fontSize/15*100)+'%';
  if(cm)cm.dispatch({effects:[wrapConfig.reconfigure(sourceWrapExtension(settings)),sourceThemeConfig.reconfigure(sourceEditorTheme(document.documentElement.dataset.theme==='dark')),whitespaceConfig.reconfigure(visibleWhitespace(settings,()=>current()?.raw??''))]});
  applyWhitespaceStyles(settings);
  if(current())render();updateToolbar();updateView();
}
function sourceCodeAt(raw,from,to=from){
  let found=null;const visit=node=>{if(node.type==='code'&&node.position.start.offset<=from&&node.position.end.offset>=to)found=fenceInfo(raw,node.position.start.offset,node.position.end.offset);for(const child of node.children||[])visit(child);};visit(parseMarkdown(raw));return found;
}
function applyEdit(change,kind='command'){if(!change)return false;apply(change.from,change.to,change.insert,kind,{selection:change.selection});return true;}
function sourceKey(action){
  if(sourceBusy||composing||!current())return false;
  const selected=cm.state.selection.main,raw=current().raw,s={from:lfToRaw(raw,selected.from),to:lfToRaw(raw,selected.to)},item=md()?listLine(raw,s.from):null,code=md()?sourceCodeAt(raw,s.from,s.to):null;side='source';
  if(action==='tab'||action==='outdent'){
    const list=!code&&item&&(s.from<=item.contentFrom||s.to>s.from);
    return applyEdit(list?indentList(raw,s,action==='outdent')||indentText(raw,s,true):indentText(raw,s,action==='outdent'));
  }
  if(!md())return action==='tab'||action==='outdent'?applyEdit(indentText(raw,s,action==='outdent')):false;
  if(code)return false;
  if(action==='enter')return applyEdit(enterList(raw,s));
  if(action==='backspace'){
    if(item?.indent&&s.from===s.to&&s.from<=item.start+item.indent.length)return applyEdit(indentList(raw,s,true));
    return applyEdit(backspaceList(raw,s));
  }
  return false;
}
function advanceClosingMarkup(position){
  let end=position;for(let i=0;i<rich.formats.length;i++)for(const f of rich.formats)if(f.kind!=='code-block'&&end>=f.contentTo&&end<f.to)end=f.to;
  return end;
}
function richListStart(position,item){const node=getSelection().focusNode?.parentElement?.closest('li');return !!item&&(position===item.contentFrom||rich.first(node)?.map[0]===position);}
function balancedBreak(position,insert){
  const active=rich.formats.filter(f=>f.kind!=='code-block'&&position>f.contentFrom&&position<f.contentTo).sort((a,b)=>a.from-b.from);
  return active.toReversed().map(f=>f.close).join('')+insert+active.map(f=>f.open).join('');
}

listen('#preview','focus',()=>{if(!md())return;side='preview';updateToolbar();});
document.addEventListener('selectionchange',()=>{if(composing||!current()||!md())return;const s=rich.selection();if(s){side='preview';lastSelection=current().selection=s;updateStatus();updateToolbar();features.active(s.from);publishPosition(s.from);}});
listen('#preview','beforeinput',e=>{
  if(!md()||e.target.closest?.('textarea,select,input,button')||composing||e.isComposing)return;
  const s=rich.selection();if(!s)return;
  if(peerInputLocked()||rich.source!==current().raw){e.preventDefault();render();return;}
  if(e.inputType==='historyUndo'||e.inputType==='historyRedo'){e.preventDefault();history(e.inputType==='historyRedo');return;}
  if(e.inputType.startsWith('format')){e.preventDefault();return;}
  if(!['insertText','insertParagraph','insertLineBreak','deleteContentBackward','deleteContentForward','deleteByCut','deleteWordBackward','deleteWordForward','insertReplacementText'].includes(e.inputType)){e.preventDefault();return;}
  e.preventDefault();let {from,to}=s,insert=e.data||'';const raw=current().raw,info=rich.codeAt(from,to);
  const sel=getSelection(),leaf=rich.leaves.find(l=>l.node===sel.focusNode),literal=!!info||leaf?.kind==='code'||leaf?.kind==='raw',inCell=sel.focusNode?.parentElement?.closest('[data-cell]');
  if(e.inputType.startsWith('delete')){
    const item=listLine(raw,from);
    if(e.inputType==='deleteContentBackward'&&!info&&from===to&&applyEdit(backspaceList(raw,richListStart(from,item)?{from:item.contentFrom,to:item.contentFrom}:s)))return;
    insert='';if(from===to){if(e.inputType.endsWith('Backward'))from=rich.neighbor(from,-1);else to=rich.neighbor(to,1);}
    if(info){from=Math.max(info.contentFrom,from);to=Math.min(info.contentTo,to);}
  }else if(e.inputType==='insertParagraph'||e.inputType==='insertLineBreak'){
    if(inCell){notify('表内の移動はTab、セル内のTab入力はCtrl+Tabです。');return;}
    const eol=preferredEol(raw);insert=eol;
    if(info){const line=lineAt(raw,from),indent=line.text.match(/^[ \t]*/)[0];insert=eol+indent;}
    else if(!literal){
      if(e.inputType==='insertParagraph'){
        if(from===to){for(const f of rich.formats)if(f.kind!=='code-block'&&from===f.contentFrom)from=to=f.from;from=to=advanceClosingMarkup(from);}
        const next=enterList(raw,{from,to});if(next){if(next.from===from&&next.to===to){next.insert=balancedBreak(from,next.insert);next.selection={from:from+next.insert.length,to:from+next.insert.length};}applyEdit(next);return;}
      }
      insert=mode==='normal'?(e.inputType==='insertLineBreak'?'  '+eol:eol+eol):eol;
      if(from===to&&e.inputType==='insertParagraph')insert=balancedBreak(from,insert);
    }
  }else insert=escapeLiteral(insert,literal,!!inCell);
  if(info){applyEdit(patchCode(raw,info,from,to,insert),'rich');return;}
  const c=replaceRich(raw,from,to,insert,rich.formats);apply(c.from,c.to,c.insert,'rich');
});
listen('#preview','compositionstart',e=>{if(e.target.closest('textarea,select,input')||peerInputLocked())return;composing=true;current().composing=true;current().compositionOwner=window;publishPeers();const s=rich.selection();compositionRange={...s,documentId:current().id,formats:[...rich.formats],code:s?rich.codeAt(s.from,s.to):null,literal:rich.leaves.find(l=>l.node===getSelection().focusNode)?.kind==='code'};});
listen('#preview','compositionend',e=>{if(e.target.closest('textarea,select,input'))return;const s=compositionRange,data=e.data;if(!s)return;compositionRange=null;setTimeout(()=>{composing=false;const d=documents.find(d=>d.id===s?.documentId);if(d){d.composing=false;d.compositionOwner=null;}if(d&&s.from!=null&&data){const c=s.code?patchCode(d.raw,s.code,s.from,s.to,data):replaceRich(d.raw,s.from,s.to,escapeLiteral(data,s.literal),s.formats);if(d.id===activeId)applyEdit(c,'rich');else{d.replace(c.from,c.to,c.insert,'rich',c.selection);render({resetSource:true});saveRecovery();}}else render();publishPeers();},0);});
listen('#preview','keydown',e=>{
  if(e.isComposing||composing||e.target.closest('textarea,select,input,button'))return;
  if(e.key==='Tab'&&!e.altKey&&!e.metaKey){
    const cell=getSelection().focusNode?.parentElement?.closest('[data-cell]');if(e.ctrlKey&&!cell)return;e.stopPropagation();
    if(cell&&!e.ctrlKey){e.preventDefault();const cells=Array.from(cell.closest('table').querySelectorAll('[data-cell]')),next=cells[cells.indexOf(cell)+(e.shiftKey?-1:1)];if(next)rich.restoreIn(next);else if(!e.shiftKey)tableAction('row-after');return;}
    e.preventDefault();const s=selection(),raw=current().raw,info=rich.codeAt(s.from,s.to),item=listLine(raw,s.from);
    if(info){const change=indentText(raw,s,e.shiftKey);applyEdit(patchCode(raw,info,change.from,change.to,change.insert));}
    else if(item&&(s.from<=item.contentFrom||richListStart(s.from,item)||s.to>s.from))applyEdit(indentList(raw,s,e.shiftKey)||indentText(raw,s,true));
    else applyEdit(indentText(raw,s,e.shiftKey));
  }
});

async function copyText(text){if(isDesktop)await host('clipboard.text',{text});else await navigator.clipboard.writeText(text);notify('コピーしました');}
function clipboardContent(range){const frag=range.cloneContents();frag.querySelectorAll?.('.component-tools,.code-tools,.heading-fold,textarea,.diagram-error').forEach(n=>n.remove());const shell=document.createElement('div');shell.append(frag);const plain=shell.cloneNode(true);for(const n of plain.querySelectorAll('.mermaid-block')){const from=Number(n.dataset.from),to=Number(n.dataset.to);n.replaceWith(document.createTextNode(current().raw.slice(from,to)));}for(const n of shell.querySelectorAll('*')){for(const a of Array.from(n.attributes))if(a.name.startsWith('data-')||a.name==='contenteditable')n.removeAttribute(a.name);}return {html:shell.innerHTML,text:plain.textContent.replaceAll('\u200b','')};}
listen('#preview','copy',e=>{if(e.target.closest?.('textarea'))return;const s=rich.selection();if(!s)return;e.preventDefault();if(mode==='discord'){let text=current().raw.slice(s.from,s.to);const formats=rich.formats.filter(f=>s.from>=f.contentFrom&&s.to<=f.contentTo).sort((a,b)=>a.from-b.from);text=formats.map(f=>f.open).join('')+text+formats.toReversed().map(f=>f.close).join('');e.clipboardData.setData('text/plain',text);}else{const data=clipboardContent(getSelection().getRangeAt(0));e.clipboardData.setData('text/html',data.html);e.clipboardData.setData('text/plain',data.text);}});
listen('#preview','cut',e=>{if(e.target.closest?.('textarea'))return;const s=rich.selection();if(!s)return;e.preventDefault();const data=mode==='discord'?{text:current().raw.slice(s.from,s.to)}:clipboardContent(getSelection().getRangeAt(0));e.clipboardData.setData('text/plain',data.text);if(data.html)e.clipboardData.setData('text/html',data.html);const info=rich.codeAt(s.from,s.to);const c=info?patchCode(current().raw,info,s.from,s.to,''):replaceRich(current().raw,s.from,s.to,'',rich.formats);applyEdit(c);});
document.addEventListener('paste',guard(async e=>{
  if(e.target.closest('dialog,#search-panel,textarea.diagram-code'))return;
  const files=Array.from(e.clipboardData?.files||[]).filter(f=>f.type.startsWith('image/'));if(files.length){e.preventDefault();e.stopPropagation();if(!md()){notify('画像の挿入はMarkdown文書で利用できます。');return;}await importImages(files);return;}
  if(!md())return;
  if(side!=='preview'||!$('#preview').contains(e.target))return;e.preventDefault();const s=selection();const html=e.clipboardData.getData('text/html'),text=e.clipboardData.getData('text/plain');const info=rich.codeAt(s.from,s.to),literal=!!info||rich.leaves.find(l=>l.node===getSelection().focusNode)?.kind==='code';const insert=literal?text:html&&!plainPasteNext?td.turndown(DOMPurify.sanitize(html)):escapeLiteral(text);plainPasteNext=false;if(info)applyEdit(patchCode(current().raw,info,s.from,s.to,insert));else apply(s.from,s.to,insert);
}),{capture:true});
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='v')plainPasteNext=e.shiftKey;},true);
// Capture file drops before CodeMirror or browser navigation can consume them,
// including drops on the toolbar, tab strip, outline and preview chrome.
installFileDropOverlay({getContext:()=>({markdown:md(),canOpenHere:!paneSession||(isDesktop&&typeof window.chrome.webview.postMessageWithAdditionalObjects==='function')})});
document.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files'))e.preventDefault();},{capture:true});
document.addEventListener('drop',guard(async e=>{
  if(!e.dataTransfer?.files.length)return;e.preventDefault();e.stopPropagation();
  const files=Array.from(e.dataTransfer.files),images=files.filter(f=>f.type.startsWith('image/')),textFiles=files.filter(f=>!f.type.startsWith('image/'));
  if(images.length){if(md())await importImages(images);else notify('画像の挿入はMarkdown文書で利用できます。');}
  if(!textFiles.length)return;
  if(isDesktop&&typeof window.chrome.webview.postMessageWithAdditionalObjects==='function')await host('file.drop',{},textFiles);
  else if(paneSession){paneSession.focusOwner();notify('ファイルは元のウィンドウへドロップしてください。');}
  else for(const file of textFiles)await openBrowserFile(file);
}),{capture:true});

async function dialog(title,body,setup=()=>{}){const modal=$('#modal');$('#dialog-title').textContent=title;$('#dialog-body').innerHTML=body;setup($('#dialog-body'));modal.returnValue='';modal.showModal();paneSession?.setDialogOpen(true);return new Promise(resolve=>modal.addEventListener('close',()=>{paneSession?.setDialogOpen(false);resolve(modal.returnValue==='ok');},{once:true}));}
async function printPane(target){
  if(!current()||(!md()&&!textPreview.finishEdit()))return;
  const d=current(),kind=fileKind(d),isGrid=target==='preview'&&(kind==='csv'||kind==='tsv');
  if(isGrid&&!textPreview.parsed){notify('先に表のプレビューを表示してください。',true);return;}
  const large=d.raw.length>2*1024*1024||(isGrid&&textPreview.parsed.rowCount*textPreview.parsed.columnCount>20000);
  const choices=isGrid?'<label class="field">表の印刷対象<select id="print-scope"><option value="visible">表示中の行・列（絞り込みと非表示を反映、全ページ）</option><option value="all">すべての行・列（絞り込みと非表示を無視）</option></select></label>':'';
  const body='<p>次に開く印刷画面で、用紙サイズ・向き・ページ範囲を選べます。PDFは出力先に「Microsoft Print to PDF」などを選択してください。</p>'+choices+(target==='preview'&&kind==='html'?'<p>HTMLの外部通信とスクリプトは無効です。安全のためスタイルシートを除くので、プレビューと見た目が異なる場合があります。</p>':'')+(target==='preview'&&md()?'<p>外部 URL の画像は印刷されません。文書内の画像や埋め込み画像を使用してください。</p>':'')+(large?'<p>大きな文書です。印刷プレビューの作成に時間やメモリが必要になることがあります。</p>':'');
  if(!await dialog(target==='source'?'原文を印刷・PDF出力':'展開表示を印刷・PDF出力',body))return;
  if(current()!==d)throw new Error('文書が変更されたため、印刷を中止しました。');
  const scope=isGrid?$('#print-scope').value:'visible';
  const snapshot=d.raw;
  if(md()&&target==='preview'){
    if(rich.source!==d.raw){clearTimeout(renderTimer);render();}
    // Mermaid is rendered asynchronously. Do not send a placeholder or a
    // previously rendered diagram to the print preview.
    const deadline=Date.now()+20000;
    while(true){
      if(current()!==d||d.raw!==snapshot)throw new Error('文書が変更されたため、印刷を中止しました。');
      const diagrams=[...$('#preview').querySelectorAll('.mermaid-block')];
      if(diagrams.some(block=>{const error=block.querySelector('.diagram-error');return error&&!error.hidden;}))throw new Error('図を描画できないため印刷を中止しました。Mermaidの内容を確認してください。');
      if(diagrams.every(block=>block.querySelector('.mermaid-stage svg')))break;
      if(Date.now()>deadline)throw new Error('図の描画が完了しないため印刷を中止しました。');
      await new Promise(resolve=>setTimeout(resolve,100));
    }
  }
  const content=buildPrintContent({side:target,raw:d.raw,kind,preview:$('#preview'),textPreview,fontSize:settings.fontSize,scope});
  setPrintContent(content);
  // The root remains mounted for the whole browser print preview lifecycle.
  // It is invisible during normal editing and replaced on the next request.
  await new Promise(resolve=>requestAnimationFrame(resolve));
  if(isDesktop)await host('print.show');else window.print();
}
function field(label,id,value='',type='text'){const wrap=document.createElement('label');wrap.className='field';wrap.textContent=label;const input=document.createElement('input');input.id=id;input.type=type;input.value=value;wrap.append(input);return wrap;}
async function promptFields(title,fields){const values={};const ok=await dialog(title,'',body=>{for(const f of fields)body.append(field(f.label,f.id,f.value||'',f.type||'text'));});if(!ok)return null;for(const f of fields)values[f.id]=$('#'+f.id).value;return values;}
function wrap(before,after=before,placeholder='文字'){const s=selection(),raw=current().raw;let text=raw.slice(s.from,s.to)||placeholder;const existing=rich.formats.find(f=>f.open===before&&s.from>=f.contentFrom&&s.to<=f.contentTo);if(existing){apply(existing.from,existing.to,raw.slice(existing.contentFrom,existing.contentTo));return;}apply(s.from,s.to,before+text+after);lastSelection=current().selection={from:s.from+before.length,to:s.from+before.length+text.length};if(md()&&side==='preview')rich.restoreSelection(lastSelection.from,lastSelection.to);else cm.dispatch({selection:EditorSelection.range(rawToLf(current().raw,lastSelection.from),rawToLf(current().raw,lastSelection.to))});}
function prefixLines(prefix){const s=selection(),raw=current().raw;const from=raw.lastIndexOf('\n',s.from-1)+1;const next=raw.indexOf('\n',s.to);const to=next<0?raw.length:next;const changed=raw.slice(from,to).split(/(\r?\n)/).map((line,i)=>i%2?line:typeof prefix==='function'?prefix(line,i/2):prefix+line).join('');apply(from,to,changed);}
function insertBlock(text){const s=selection(),raw=current().raw,eol=preferredEol(raw);const before=s.from&&raw[s.from-1]!=='\n'?eol+eol:'';const after=s.to<raw.length&&raw[s.to]!=='\n'?eol+eol:eol;apply(s.from,s.to,before+text.replace(/\n/g,eol)+after);}
async function link(){const s=selection();const result=await promptFields('リンクを挿入',[{id:'link-text',label:'表示する文章',value:current().raw.slice(s.from,s.to)},{id:'link-url',label:'URL',value:'https://'}]);if(!result||!result['link-url'])return;apply(s.from,s.to,markdownLink(result['link-text']||result['link-url'],result['link-url']));}
async function imageDialog(){const s=selection();const ok=await dialog('画像を挿入','<p class="muted">PCの画像を選ぶか、画像のURLを入力してください。</p><button type="button" class="secondary" id="choose-image">PCから画像を選ぶ</button><label class="field">画像URL<input id="image-url" type="url" placeholder="https://…"></label><label class="field">代替テキスト<input id="image-alt"></label>',()=>{$('#choose-image').onclick=()=>{$('#modal').close('cancel');$('#image-input').click();};});if(ok&&$('#image-url').value)apply(s.from,s.to,markdownLink($('#image-alt').value,$('#image-url').value,{image:true}));}
async function editImage(from,to,node){lastSelection={from,to};const r=await promptFields('画像の参照先と代替テキスト',[{id:'edit-image-alt',label:'代替テキスト',value:node.alt},{id:'edit-image-url',label:'画像URL・相対パス',value:node.url}]);if(r)apply(from,to,markdownLink(r['edit-image-alt'],r['edit-image-url'],{image:true}));}
function importImages(files){
  if(!md())return Promise.reject(new Error('画像の挿入はMarkdown文書で利用できます。'));
  const d=current(),anchor=d.trackRange(selection());
  const job=async()=>{try{const refs=[];for(const f of files){if(f.size>32*1024*1024)throw new Error('画像は1枚32MBまでです。');const bytes=new Uint8Array(await f.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));const base64=btoa(binary);if(isDesktop){await ensureRegistered(d);const r=await host('image.import',{document:d.serialize(),name:f.name,base64});refs.push(`![${f.name.replace(/[\[\]]/g,'')}](<${r.url}>)`);}else refs.push(`![${f.name}](data:${f.type};base64,${base64})`);}
    while(documents.includes(d)&&anchor.valid&&(d.composing||$('#app').inert||$('#modal').open||paneSession?.isLocked()||paneHub?.childDialogOpen()))await new Promise(resolve=>setTimeout(resolve,50));
    if(anchor.valid&&documents.includes(d))applyFor(d,anchor.from,anchor.to,refs.join('\n\n'));else notify('画像の挿入は取り消されました。');
  }finally{anchor.dispose();}};
  d.pendingImports=(d.pendingImports||0)+1;d.importPromise=(d.importPromise||Promise.resolve()).catch(()=>{}).then(job).finally(()=>d.pendingImports--);return d.importPromise;
}
function imageUrl(url,id){if(/^(https?:|data:|blob:)/i.test(url))return url;if(!isDesktop)return url.startsWith('mdsplit-asset:')?'':url;return `https://assets.mdsplit.local/${id}/${encodeURIComponent(url)}`;}
async function diagramCopy(stage,format){const svg=stage.querySelector('svg');if(!svg)throw new Error('図を描画してから操作してください。');const text=new XMLSerializer().serializeToString(svg);if(format==='svg'){await saveBytes('diagram.svg','image/svg+xml',new TextEncoder().encode(text));return;}const image=new Image();const url=URL.createObjectURL(new Blob([text],{type:'image/svg+xml'}));try{await new Promise((ok,no)=>{image.onload=ok;image.onerror=no;image.src=url;});const box=svg.viewBox.baseVal;const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.ceil((box.width||image.width)*2));canvas.height=Math.max(1,Math.ceil((box.height||image.height)*2));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/png');const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(format==='png-file'){await saveBytes('diagram.png','image/png',new Uint8Array(await blob.arrayBuffer()));notify('図をPNGとして保存しました');return;}if(isDesktop)await host('clipboard.image',{base64:data.split(',')[1]});else await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);notify('図をPNGとしてコピーしました');}finally{URL.revokeObjectURL(url);}}
async function saveBytes(name,mime,bytes){if(isDesktop){let binary='';for(const b of bytes)binary+=String.fromCharCode(b);await host('file.export',{name,base64:btoa(binary)});}else download(name,mime,new Blob([bytes],{type:mime}));}
function download(name,mime,blob){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),30000);}
async function insertCodeBlock(){
  const d=current(),s=selection(),anchor=d.trackRange(s),selected=d.raw.slice(s.from,s.to);let automatic=selected;
  try{
    const ok=await dialog('コードブロックを挿入',"<label class=\"field\">言語・プリセット<select id=\"code-preset\"></select></label><label class=\"field\">コード<textarea id=\"code-preset-body\" class=\"code-preset-body\" spellcheck=\"false\"></textarea></label><p class=\"muted\">言語を選ぶとサンプルを入れられます。入力済みのコードは維持します。</p>",()=>{
      for(const preset of codePresets){const option=document.createElement('option');option.value=preset.id;option.textContent=preset.label;$('#code-preset').append(option);}
      $('#code-preset-body').value=selected;
      $('#code-preset').addEventListener('change',()=>{const input=$('#code-preset-body');if(!selected&&input.value===automatic){automatic=codePresets.find(p=>p.id===$('#code-preset').value)?.sample||'';input.value=automatic;}});
      $('#code-preset-body').addEventListener('keydown',e=>{if(e.key==='Tab'){e.preventDefault();const n=e.target;n.setRangeText('\t',n.selectionStart,n.selectionEnd,'end');n.dispatchEvent(new Event('input',{bubbles:true}));}});
    });
    if(!ok||!anchor.valid||!documents.includes(d))return;
    const body=normalized($('#code-preset-body').value),language=$('#code-preset').value,eol=preferredEol(d.raw),block=codeFence(body,language).replace(/\n/g,eol),before=anchor.from&&d.raw[anchor.from-1]!=='\n'?eol+eol:'',after=anchor.to<d.raw.length&&d.raw[anchor.to]!=='\n'?eol+eol:eol;
    const contentFrom=anchor.from+before.length+block.indexOf('\n')+1,contentTo=contentFrom+body.replace(/\n/g,eol).length;
    if(current()===d)apply(anchor.from,anchor.to,before+block+after,'command',{selection:{from:contentFrom,to:contentTo}});
    else applyFor(d,anchor.from,anchor.to,before+block+after);
  }finally{anchor.dispose();}
}

async function insertTable(){const values=await promptFields('表を挿入',[{id:'table-columns',label:'列数（1〜20）',value:'3',type:'number'},{id:'table-rows',label:'本文の行数（1〜100）',value:'2',type:'number'}]);if(!values)return;const cols=Math.min(20,Math.max(1,Number(values['table-columns'])||3)),rows=Math.min(100,Math.max(1,Number(values['table-rows'])||2));const head='| '+Array.from({length:cols},(_,i)=>'見出し'+(i+1)).join(' | ')+' |';const sep='| '+Array(cols).fill('---').join(' | ')+' |';insertBlock([head,sep,...Array(rows).fill('| '+Array(cols).fill('内容').join(' | ')+' |')].join('\n'));}
function splitTableRow(line){const cells=[];let start=0,slashes=0;for(let i=0;i<line.length;i++){if(line[i]==='|'&&slashes%2===0){cells.push(line.slice(start,i));start=i+1;}slashes=line[i]==='\\'?slashes+1:0;}cells.push(line.slice(start));return cells;}
function tableAction(action){const s=selection();const node=parseMarkdown(current().raw).children.find(n=>n.type==='table'&&n.position.start.offset<=s.from&&n.position.end.offset>=s.from);if(!node){notify('表の中にカーソルを置いてください。');return;}const raw=current().raw.slice(node.position.start.offset,node.position.end.offset),eol=preferredEol(raw),lines=raw.split(/\r?\n/);const cells=Array.from($('#preview').querySelectorAll('[data-cell]'));const cell=cells.find(n=>Number(n.dataset.from)<=s.from&&Number(n.dataset.to)>=s.from);const row=Number(cell?.dataset.row||0),col=Number(cell?.dataset.col||0);
  if(action==='row-after')lines.splice(row===0?2:row+2,0,'| '+Array(node.children[0].children.length).fill(' ').join(' | ')+' |');
  else if(action==='row-remove'){if(row===0){notify('見出し行は削除できません。');return;}lines.splice(row+1,1);}
  else if(action==='column-after'){for(let i=0;i<lines.length;i++){const pieces=splitTableRow(lines[i]);const offset=pieces[0].trim()===''?1:0;pieces.splice(offset+col+1,0,i===1?' --- ':' 内容 ');lines[i]=pieces.join('|');}}
  else if(action==='column-remove'){if(node.children[0].children.length===1)return;for(let i=0;i<lines.length;i++){const pieces=splitTableRow(lines[i]);const offset=pieces[0].trim()===''?1:0;pieces.splice(offset+col,1);lines[i]=pieces.join('|');}}
  apply(node.position.start.offset,node.position.end.offset,lines.join(eol));}
async function tableMenu(){if(!await dialog('表の操作','<select id="table-operation"><option value="row-after">選択行の下に行を追加</option><option value="row-remove">選択行を削除</option><option value="column-after">選択列の右に列を追加</option><option value="column-remove">選択列を削除</option></select>'))return;tableAction($('#table-operation').value);}

function collectImages(d){if(!isMarkdown(d))return [];return collectImageReferences(d.raw,d.id===activeId&&rich.source===d.raw?rich.images:[]);}
async function saveDocument(d=current(),saveAs=false){
  if(paneSession)return paneSession.save(saveAs);
  if(d.composing||paneHub?.childDialogOpen()){notify('入力の変換・別ウィンドウの操作を終えてから保存してください。');return false;}
  if(d.saving)return false;
  if(d.importPromise)await d.importPromise;
  if(!isDesktop){const bytes=encodeBrowserText(d.raw,d.encoding,d.hasBom);download(d.name,'application/octet-stream',new Blob([bytes],{type:'application/octet-stream'}));d.saved=d.raw;d.savedEncoding=d.encoding;d.savedHasBom=d.hasBom;d.needsInitialSave=false;render();return true;}
  await ensureRegistered(d);
  d.saving=true;const submitted=d.raw,submittedEncoding=d.encoding,submittedBom=d.hasBom;
  try{
    const r=await host('file.save',{document:d.serialize(),saveAs,images:collectImages(d)});if(!r)return false;
    if(d.raw===submitted){if(r.text!==d.raw)d.replace(0,d.raw.length,r.text);}
    else if(r.replacements?.length){
      const changes=collectImages(d).map(ref=>{const replacement=r.replacements.find(x=>x.oldUrl===ref.url);return replacement?{from:ref.urlFrom,to:ref.urlTo,insert:replacement.newUrl}:null;}).filter(Boolean).sort((a,b)=>b.from-a.from);
      for(const c of changes)d.replace(c.from,c.to,c.insert);
    }
    const previousKind=fileKind(d);d.path=r.path;d.name=r.name;if(previousKind!==fileKind(d))d.previewViewMode=initialViewMode(settings,fileKind(d));if(d.encoding===submittedEncoding&&d.hasBom===submittedBom){d.encoding=r.encoding||submittedEncoding;d.hasBom=r.hasBom??submittedBom;d.encodingGuessed=r.encodingGuessed??false;d.encodingNotice=r.encodingNotice||null;}d.savedEncoding=r.encoding||submittedEncoding;d.savedHasBom=r.hasBom??submittedBom;d.fingerprint=r.fingerprint;d.saved=r.text;render();saveRecovery();notify(d.dirty?'保存しました。保存後の変更があります。':'保存しました');return true;
  }finally{d.saving=false;}
}
async function confirmCloseDocument(d){if(d.composing){notify('入力の変換を確定してから閉じてください。');return false;}if(!d.dirty)return true;const ok=await dialog('変更を保存しますか？','<p id="close-file-name"></p><p class="muted">保存しない場合、今回の変更は破棄されます。</p><div class="close-choices"><button type="button" id="discard" class="secondary">保存せずに閉じる</button></div>',()=>{$('#close-file-name').textContent=d.name;$('#modal .primary').textContent='保存して閉じる';$('#discard').onclick=()=>$('#modal').close('discard');});const choice=$('#modal').returnValue;$('#modal .primary').textContent='適用';if(!ok&&choice!=='discard')return false;if(ok){if(!await saveDocument(d))return false;if(d.dirty){notify('保存後に変更された内容があります。もう一度確認してください。',true);return false;}}return true;}
async function closeDocument(id){if(paneSession){await closeWindow();return true;}const d=documents.find(x=>x.id===id);if(!d||!await confirmCloseDocument(d))return false;await recoveryWriter.exclusive(async()=>{if(isDesktop){await ensureRegistered(d);await host('document.close',{id:d.id});}documents=documents.filter(x=>x.id!==id);});paneHub?.closeDocument(id);if(!documents.length)newDocument();else if(id===activeId)switchDocument(documents.at(-1).id);else renderTabs();saveRecovery();return true;}
// Confirm every document before closing any of them, so a later cancellation
// never silently drops a tab that was already confirmed for discard.
async function closeAllDocuments(){
  if(closingWindow||paneSession)return;
  if($('#modal').open||csvDialogOpen||paneHub?.childDialogOpen()){notify('開いている操作画面を閉じてから操作してください。');return;}
  if(!md()&&!textPreview.finishEdit())return;
  if(documents.some(d=>d.composing||d.pendingImports)){notify('入力の変換や画像の取り込みが完了してから操作してください。');return;}
  closingWindow=true;
  const originalActive=activeId,initialDocs=[...documents],state=d=>[d.raw,d.saved,d.encoding,d.savedEncoding,d.hasBom,d.savedHasBom,d.path,d.name],checked=new Map(initialDocs.map(d=>[d,state(d)]));
  let locked=false,removed=false;
  try{
    for(const d of initialDocs)if(d.dirty){switchDocument(d.id);if(!await confirmCloseDocument(d))return;checked.set(d,state(d));}
    if(documents.length!==initialDocs.length||documents.some((d,i)=>d!==initialDocs[i]||d.pendingImports||d.composing||state(d).some((value,n)=>value!==checked.get(d)[n]))){notify('確認中に文書が変更されました。もう一度操作してください。',true);return;}
    $('#app').inert=true;locked=true;publishPeers();clearTimeout(recoveryTimer);
    await recoveryWriter.exclusive(async()=>{
      if(isDesktop)for(const d of initialDocs)await ensureRegistered(d);
      for(const d of initialDocs){
        if(isDesktop)await host('document.close',{id:d.id});
        documents=documents.filter(x=>x!==d);removed=true;paneHub?.closeDocument(d.id);
      }
    });
  }finally{
    if(locked){$('#app').inert=false;publishPeers();}
    if(removed){if(!documents.length)newDocument({name:'無題.'+(['md','csv','txt','html','json','tsv','xml'].includes(settings.startupFormat)?settings.startupFormat:'md')});else switchDocument(documents.some(d=>d.id===originalActive)?originalActive:documents.at(-1).id);saveRecovery();}
    else if(documents.some(d=>d.id===originalActive)&&activeId!==originalActive)switchDocument(originalActive);
    closingWindow=false;
  }
}
let closingWindow=false;
async function closeWindow(override){if(closingWindow)return;if(paneSession){if(sourceBusy||composing||current()?.composing&&current()?.compositionOwner===window){notify('入力の変換を確定してから閉じてください。');return;}if(isDesktop)await host('window.close');else window.close();return;}if($('#modal').open||csvDialogOpen||paneHub?.childDialogOpen()){notify('開いている操作画面を閉じてから終了してください。');return;}if(!md()&&!textPreview.finishEdit())return;if(documents.some(d=>d.composing)){notify('入力の変換を確定してから閉じてください。');return;}if(documents.some(d=>d.pendingImports)){notify('画像の取り込みが完了してから終了してください。');return;}closingWindow=true;const originalActive=activeId,initialDocs=[...documents];const state=d=>[d.raw,d.saved,d.encoding,d.savedEncoding,d.hasBom,d.savedHasBom,d.path,d.name];const checked=new Map(initialDocs.map(d=>[d,state(d)]));let locked=false,closed=false;try{for(const d of initialDocs)if(d.dirty){switchDocument(d.id);if(!await confirmCloseDocument(d)){if(documents.some(item=>item.id===originalActive))switchDocument(originalActive);return;}checked.set(d,state(d));}if(documents.some(item=>item.id===originalActive))switchDocument(originalActive);if(documents.length!==initialDocs.length||documents.some((d,i)=>d!==initialDocs[i]||d.pendingImports||state(d).some((value,n)=>value!==checked.get(d)[n]))){notify('終了確認中に文書が変更されました。もう一度終了してください。',true);return;}const policy=['clear','all','active'].includes(override)?override:['clear','all','active'].includes(settings.sessionPolicy)?settings.sessionPolicy:'clear';$('#app').inert=true;locked=true;publishPeers();clearTimeout(recoveryTimer);await recoveryWriter.write();await host('session.save',{policy,documentIds:documents.map(d=>d.id),activeId:originalActive,mode});await host('window.close');closed=true;}finally{if(locked&&!closed){$('#app').inert=false;publishPeers();}if(!closed)closingWindow=false;}}
function acceptFiles(items){for(const item of items){const old=documents.find(d=>d.path&&d.path.toLowerCase()===item.path?.toLowerCase());if(old)switchDocument(old.id);else newDocument(item);}}
async function openFiles(){$('#file-input').dataset.encoding='';if(isDesktop){const items=await host('file.open');if(items)acceptFiles(items);}else $('#file-input').click();}
async function encodingDialog(){
  const d=current();const ok=await dialog('文字コード',`<label class="field">文字コード<select id="chosen-encoding">${encodingChoices.map(c=>'<option value="'+c.id+'">'+c.label+'</option>').join('')}</select></label><label class="checkbox" id="encoding-bom-field"><input type="checkbox" id="encoding-bom">BOMを付けて保存する（UTF-16／32）</label><label class="field">操作<select id="encoding-action"><option value="save">次の保存から、この文字コードを使う</option><option value="reopen">この文字コードで元ファイルを開き直す</option><option value="open">この文字コードで別のファイルを開く</option></select></label><p class="muted" id="encoding-notice"></p>`,()=>{
    $('#chosen-encoding').value=d.encoding;$('#encoding-bom').checked=d.hasBom??defaultBom(d.encoding);$('#encoding-notice').textContent=d.encodingNotice||'文字化けした場合は文字コードを選んで開き直せます。保存形式の変更は次に保存したときに反映します。';
    $('#encoding-action').querySelector('[value="reopen"]').disabled=!d.path&&!d.browserFile;
    const updateBom=()=>{$('#encoding-bom-field').hidden=!/^utf(?:16|32)/.test($('#chosen-encoding').value);$('#encoding-bom').disabled=$('#encoding-action').value!=='save';};
    $('#chosen-encoding').onchange=()=>{$('#encoding-bom').checked=defaultBom($('#chosen-encoding').value);updateBom();};$('#encoding-action').onchange=updateBom;updateBom();
  });if(!ok)return;const encoding=$('#chosen-encoding').value,action=$('#encoding-action').value;
  if(action==='open'){if(isDesktop){const items=await host('file.open',{encoding});if(items)acceptFiles(items);}else{const input=$('#file-input');input.dataset.encoding=encoding;input.click();}return;}
  if(action==='reopen'){
    if(d.dirty&&!await dialog('編集内容を破棄して開き直しますか？','<p class="muted">元ファイルを読み直すと、現在の未保存の変更は破棄されます。</p>'))return;
    if(d.composing||d.saving){notify('入力の変換や保存の完了をお待ちください。');return;}
    const data=d.browserFile&&!d.path?await readBrowserFileWithConsent(d.browserFile,encoding):await host('file.reopen',{id:d.id,encoding});if(!data)return;if(d.browserFile&&!d.path)data.needsInitialSave=false;for(const a of d.anchors)a.valid=false;const fresh=new DocumentModel(data);fresh.id=d.id;Object.assign(d,fresh);switchDocument(d.id);publishPeers();if(d.encodingNotice)notify(d.encodingNotice);
  }else{d.encoding=encoding;d.hasBom=/^utf(?:16|32)/.test(encoding)?$('#encoding-bom').checked:defaultBom(encoding);d.encodingGuessed=false;d.encodingNotice=null;updateStatus();renderTabs();updateTitle();saveRecovery();}
}
listen('#encoding','click',guard(encodingDialog));
async function lineEndingsDialog(){
  if(!current()||sourceBusy||composing||current().composing||peerInputLocked()){notify('入力の変換を確定してから操作してください。');return;}
  if(!md()&&!textPreview.finishEdit())return;
  const d=current(),raw=d.raw,revision=d.revision,counts=countLineEndings(raw);
  const ok=await dialog('改行コードの一括変換',`<p class="muted">文書全体の改行コードを変更します。CSVの引用符内やコードブロック内の改行も対象です。</p><p id="line-ending-counts"></p><label class="field">対象<select id="line-ending-from"><option value="CRLF">CRLF</option><option value="LF">LF</option><option value="CR">CR</option><option value="all">すべて</option></select></label><label class="field">変更後<select id="line-ending-to"><option value="LF">LF</option><option value="CRLF">CRLF</option><option value="CR">CR</option><option value="remove">改行を削除して行をつなぐ</option></select></label><p id="line-ending-summary" role="status"></p>`,body=>{
    const from=body.querySelector('#line-ending-from'),to=body.querySelector('#line-ending-to'),summary=body.querySelector('#line-ending-summary');
    body.querySelector('#line-ending-counts').textContent=`CRLF: ${counts.CRLF.toLocaleString()}件 / LF: ${counts.LF.toLocaleString()}件 / CR: ${counts.CR.toLocaleString()}件`;
    from.value=counts.CRLF?'CRLF':counts.LF?'LF':'CR';
    const update=()=>{const total=from.value==='all'?counts.CRLF+counts.LF+counts.CR:counts[from.value];summary.textContent=to.value==='remove'?`${total.toLocaleString()}件の改行を削除し、前後の行をつなぎます。元に戻すことができます。`:`${total.toLocaleString()}件の対象を ${to.value} に変更します。元に戻すことができます。`;};
    from.addEventListener('change',update);to.addEventListener('change',update);update();
  });
  if(!ok)return;
  if(current()!==d||d.raw!==raw||d.revision!==revision||d.composing||d.pendingImports||peerInputLocked()){notify('確認中に文書が変更されました。もう一度操作してください。',true);return;}
  const result=replaceLineEndings(raw,$('#line-ending-from').value,$('#line-ending-to').value,d.selection);
  if(result.text===raw){notify('変更する改行コードはありません。');return;}
  for(const anchor of d.anchors)anchor.valid=false;
  apply(0,raw.length,result.text,'command',{selection:result.selection});
  notify(`${result.count.toLocaleString()}件の改行を処理しました。保存するとファイルに反映されます。`);
}
listen('#line-endings','click',guard(lineEndingsDialog));
const approvedBrowserFiles=new WeakSet();
async function readBrowserFileWithConsent(file,encoding){
  if(file.size>MAX_BROWSER_FILE_BYTES&&!approvedBrowserFiles.has(file)){
    const ok=await dialog('大きなファイルを開きますか？','<p>大きなファイルを開くと、読み込みに時間がかかり、メモリ不足や動作停止が発生する場合があります。</p><p class="muted">キャンセルするとファイルを開かずに戻ります。</p>');
    if(!ok)return null;approvedBrowserFiles.add(file);
  }
  return readBrowserFile(file,encoding,{allowLarge:approvedBrowserFiles.has(file)});
}
async function openBrowserFile(file,encoding){const data=await readBrowserFileWithConsent(file,encoding);if(!data)return null;data.needsInitialSave=false;const d=newDocument(data);d.browserFile=file;return d;}
listen('#file-input','change',guard(async e=>{try{for(const f of e.target.files)await openBrowserFile(f,e.target.dataset.encoding||undefined);}finally{e.target.value='';delete e.target.dataset.encoding;}}));
listen('#image-input','change',guard(async e=>{await importImages(Array.from(e.target.files));e.target.value='';}));
function searchDialog(){if(paneSession&&!md()&&detachedSide==='preview'){const selected=features.pendingSearchSelection||features.captureSearchSelection();features.pendingSearchSelection=null;return paneSession.search(true,{text:selected.text,richSelection:selected.richSelection});}features.openSearch(true);}
function settingsDialog(){const documentAtOpen=current(),kindAtOpen=fileKind(documentAtOpen);return showSettings({settings:()=>settings,fileKind:()=>kindAtOpen,dialog,setSettings:async change=>{const before=presentationFor(settings,kindAtOpen),after=presentationFor({...settings,...change},kindAtOpen);if(isViewMode(after.defaultViewMode)&&after.defaultViewMode!==before.defaultViewMode)documentAtOpen.previewViewMode=after.defaultViewMode;await setSettings(change);saveRecovery();},previewSettings(change){settings={...settings,...change};applySettings();},updates,host,notify,guard});}
async function openWelcome(){const {welcomeDocument}=await import('./welcome.js');newDocument(welcomeDocument());}

function help(){return showHelp(dialog,guard(()=>updates.check(true)),guard(openWelcome));}
function renderChunks(){const list=$('#chunks');list.replaceChildren();try{const chunks=splitDiscord(current().raw,settings.limit);chunks.forEach((part,i)=>{const card=document.createElement('section');card.className='chunk';const head=document.createElement('div');head.className='chunk-head';const label=document.createElement('strong');label.textContent=`${i+1} / ${chunks.length}`;const count=document.createElement('small');count.textContent=part.count.toLocaleString()+'字';const b=document.createElement('button');b.textContent='コピー';b.className='secondary';b.onclick=guard(async()=>{await copyText(part.text);b.textContent='✓ コピー済み';card.classList.add('copied');});head.append(label,count,b);const pre=document.createElement('pre');pre.textContent=part.text;card.append(head,pre);list.append(card);});}catch(e){const p=document.createElement('p');p.className='error-text';p.textContent=e.message;list.append(p);}}
listen('#show-chunks','click',()=>{showChunks=!showChunks;$('.chunks-panel').hidden=!showChunks;if(showChunks)renderChunks();});listen('#close-chunks','click',()=>{showChunks=false;$('.chunks-panel').hidden=true;});
listen('#limit','change',guard(async e=>{let limit=Number(e.target.value);if(e.target.value==='custom'){const r=await promptFields('文字数上限',[{id:'custom-limit',label:'上限（32〜100000文字）',value:String(settings.limit),type:'number'}]);if(!r)return;limit=Number(r['custom-limit']);}await setSettings({limit:Math.max(32,Math.min(100000,limit||2000))});updateStatus();if(showChunks)renderChunks();}));
listen('#heading','change',e=>{if(e.target.value===''||!md())return;const n=Number(e.target.value);prefixLines(line=>(n?'#'.repeat(n)+' ':'')+line.replace(/^ {0,3}#{1,6}\s+/,''));e.target.value='';});
listen('#preview','contextmenu',e=>{if(e.target.closest('[data-cell]')){e.preventDefault();guard(tableMenu)();}});
const commands={
  'view-split':()=>setViewSettings({viewMode:'split'}),'view-source':()=>setViewSettings({viewMode:'source'}),'view-preview':()=>setViewSettings({viewMode:'preview'}),
  'theme-light':()=>setSettings({theme:'light'}),'theme-dark':()=>setSettings({theme:'dark'}),'theme-system':()=>setSettings({theme:'system'}),'popout-source':()=>paneHub?.open('source'),'popout-preview':()=>paneHub?.open('preview'),'focus-owner':()=>paneSession?.focusOwner(),
  recent:()=>features.recent(),outline:toggleOutline,sync:()=>setPresentationSettings({sync:!viewSettings().sync}),replace:searchDialog,
  new:async()=>{const name='無題.'+$('#new-format').value;if(isDesktop)await host('file.new',{name});else newDocument({name});},open:openFiles,save:()=>saveDocument(),saveas:()=>saveDocument(current(),true),closetab:()=>closeDocument(activeId),closeall:()=>closeAllDocuments(),closewindow:()=>closeWindow(),'exit-clear':()=>closeWindow('clear'),'exit-all':()=>closeWindow('all'),'exit-active':()=>closeWindow('active'),undo:()=>history(false),redo:()=>history(true),
  'layout-windows':()=>setSettings({openPolicy:'windows'}),'layout-tabs':()=>setSettings({openPolicy:'tabs'}),
  'mode-normal':()=>setMode('normal'),'mode-discord':()=>setMode('discord'),
  bold:()=>wrap('**'),italic:()=>wrap('*'),strike:()=>wrap('~~'),underline:()=>wrap('__'),spoiler:()=>wrap('||'),inlinecode:()=>wrap('`','`','コード'),
  bullet:()=>applyEdit(toggleList(current().raw,selection(),'bullet')),number:()=>applyEdit(toggleList(current().raw,selection(),'number')),check:()=>applyEdit(toggleList(current().raw,selection(),'check')),quote:()=>prefixLines('> '),subtext:()=>prefixLines('-# '),
  link,image:imageDialog,table:insertTable,code:insertCodeBlock,mermaid:()=>insertBlock('```mermaid\nflowchart TD\n    A[開始] --> B[処理]\n    B --> C[完了]\n```'),details:()=>insertBlock('<details>\n<summary>詳細を見る</summary>\n\n内容を入力\n\n</details>'),rule:()=>insertBlock('---'),
  'print-source':()=>printPane('source'),'print-preview':()=>printPane('preview'),
  'copy-source':()=>copyText(current().raw),'copy-rich':async()=>{if(mode==='discord')return copyText(current().raw);const r=document.createRange();r.selectNodeContents($('#preview'));const data=clipboardContent(r);if(isDesktop)await host('clipboard.rich',data);else await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([data.html],{type:'text/html'}),'text/plain':new Blob([data.text],{type:'text/plain'})})]);notify('コピーしました');},search:searchDialog,settings:settingsDialog,help
};
function setMode(value){if(!md())return;if(paneSession){paneSession.setMode(value);return;}mode=value;showChunks=false;$('.chunks-panel').hidden=true;render();saveRecovery();}
document.addEventListener('mousedown',e=>{const command=e.target.closest('[data-cmd],[data-file-action]');if(command){if(['search','replace'].includes(command.dataset.cmd))features.rememberSearchSelection();if(!md())textPreview.finishEdit();selection();e.preventDefault();}});
document.addEventListener('click',e=>{const b=e.target.closest('[data-cmd],[data-file-action]'),cmd=b?.dataset.cmd||b?.dataset.fileAction;if(b&&!b.disabled&&commands[cmd]){if(sourceBusy||composing||current()?.composing){notify('入力の変換を確定してから操作してください。');return;}if(!md()&&markdownCommands.has(cmd))return;guard(commands[cmd])();}});
document.addEventListener('keydown',e=>{if(e.isComposing||composing||current()?.composing)return;if(e.target.closest('dialog'))return;if(!(e.ctrlKey||e.metaKey))return;const key=e.key.toLowerCase();if(e.ctrlKey&&e.altKey&&!e.metaKey&&!e.shiftKey&&!e.getModifierState('AltGraph')){const wrapMode={x:'none',s:'column',w:'window'}[key];if(wrapMode){e.preventDefault();guard(async()=>{await setSettings({wrapMode,wrap:wrapMode!=='none'});notify({none:'原文を折り返さない',column:'原文を指定桁で折り返す',window:'原文を右端で折り返す'}[wrapMode]);})();}return;}if(e.altKey)return;if(detachedSide&&['n','o'].includes(key)){e.preventDefault();paneSession?.focusOwner();return;}let command={n:'new',o:'open',s:e.shiftKey?'saveas':'save',b:'bold',i:'italic',k:'link',f:'search',h:'replace',w:e.shiftKey?'closewindow':'closetab'}[key];if(command){e.preventDefault();if(!md()&&markdownCommands.has(command))return;guard(commands[command])();}else if(key==='z'&&side==='preview'){e.preventDefault();history(e.shiftKey);}else if(key==='y'&&side==='preview'){e.preventDefault();history(true);}else if(key==='tab'&&!detachedSide&&!e.defaultPrevented){e.preventDefault();const at=documents.findIndex(d=>d.id===activeId);switchDocument(documents[(at+(e.shiftKey?documents.length-1:1))%documents.length].id);}});
listen('.splitter','pointerdown',e=>{e.preventDefault();const divider=e.target;divider.setPointerCapture(e.pointerId);const move=e=>{const box=$('.editor-panes').getBoundingClientRect();settings.ratio=Math.min(.78,Math.max(.22,(e.clientX-box.left)/box.width));document.documentElement.style.setProperty('--split',settings.ratio*100+'%');};const up=()=>{divider.removeEventListener('pointermove',move);divider.removeEventListener('pointerup',up);guard(()=>setSettings({ratio:settings.ratio}))();};divider.addEventListener('pointermove',move);divider.addEventListener('pointerup',up);});
async function openLink(url){const target=safeBrowserUrl(url);if(!target){notify('HTTP・HTTPSのリンクを指定してください。');return;}await host('shell.open',{url:target});}
onHost(guard(async event=>{if(event.type==='editor-command'){if(!$('#modal').open&&!sourceBusy&&!composing&&!current()?.composing&&!$('#app').inert&&['save','saveas','search','replace'].includes(event.command))await commands[event.command]();return;}if(detachedSide){if(event.type==='pane-close-request')await closeWindow();return;}if(event.type==='pane-window-closed'){paneHub?.refresh();return;}if(event.type==='pane-window-error'){notify(event.message||'表示ウィンドウを閉じました。編集内容は元の画面に残っています。');paneHub?.refresh();return;}if(await updates.onEvent(event))return;if(event.type==='files-opened')acceptFiles(event.documents);if(event.type==='activate-document'&&documents.some(d=>d.id===event.id))switchDocument(event.id);if(event.type==='new-document')newDocument(event.document||{});if(event.type==='close-request')await closeWindow();if(event.type==='settings-changed'){settings={...settings,...event.settings};applySettings();}if(event.type==='encoding-open-existing'){notify('すでに開いています。下部の文字コードから開き直してください。');return;}if(event.type==='large-file-changed'){notify('外部でファイルが大きく変更されました。保存時に内容を確認してください。');return;}if(event.type==='file-changed'){const d=documents.find(d=>d.id===event.document.id);if(!d)return;if(!d.dirty&&!d.composing&&!d.componentEditing){Object.assign(d,{raw:event.document.text,saved:event.document.text,fingerprint:event.document.fingerprint,encoding:event.document.encoding,savedEncoding:event.document.encoding,hasBom:event.document.hasBom??defaultBom(event.document.encoding),savedHasBom:event.document.hasBom??defaultBom(event.document.encoding),encodingGuessed:event.document.encodingGuessed??false,encodingNotice:event.document.encodingNotice||null,format:event.document.format});if(d.id===activeId)render({resetSource:true});try{if(isDesktop)await host('file.accept-change',{id:d.id,fingerprint:event.document.fingerprint});}catch{notify('外部変更の確認に失敗しました。次の保存時に確認してください。',true);}saveRecovery();}else{const notice=$('.notice');notice.hidden=false;notice.textContent='このファイルは別のアプリでも変更されています。保存時に変更を確認してください。';}}}));
function peerInputLocked(){return !!current()?.componentEditing&&current().componentEditing!==window||!!current()?.composing&&!composing&&!sourceBusy||!!$('#app').inert||!!paneSession?.isLocked()||!!paneHub?.childDialogOpen()||csvDialogOpen;}
async function csvSidecar(action,id,view){
  const d=documents.find(d=>d.id===id);if(!d||!['csv','tsv'].includes(previewKind(d)))throw new Error('CSV・TSVの文書を開いてください。');
  if(paneSession)return paneSession.csvSidecar(action,view);
  if(isDesktop){
    await ensureRegistered(d);
    const result=await host('csv.view.'+action,{id, ...(action==='save'?{view:normalizeCsvView(view)}:{})});
    if(action==='save'){if(result)notify('表示設定を保存しました。');return !!result;}
    if(!result){notify('表示設定ファイルが見つかりません。');return null;}return normalizeCsvView(result);
  }
  if(action==='save'){download(d.name+'.mdsplit-view.json','application/json',new Blob([JSON.stringify({schema:'md-split.csv-view',version:1,view:normalizeCsvView(view)},null,2)],{type:'application/json'}));return true;}
  return new Promise((resolve,reject)=>{const input=document.createElement('input');input.type='file';input.accept='.json';input.hidden=true;document.body.append(input);const done=value=>{input.remove();resolve(value);};input.addEventListener('cancel',()=>done(null),{once:true});input.addEventListener('change',async()=>{try{const file=input.files?.[0];if(!file)return done(null);if(file.size>2*1024*1024)throw new Error('表示設定ファイルが大きすぎます。');const data=JSON.parse(await file.text());if(data.schema!=='md-split.csv-view'||data.version!==1||!data.view)throw new Error(APP_TITLE+'の表示設定ファイルではありません。');done(normalizeCsvView(data.view));}catch(e){input.remove();reject(e);}},{once:true});input.click();});
}
function publishPeers(){if(paneSession)paneSession.changed();else paneHub?.refresh();}
function publishPosition(at){if(refreshing)return;if(paneSession)paneSession.position(at);else paneHub?.position(activeId,at);}
for(const selector of ['#source','#preview'])$(selector).addEventListener('beforeinput',e=>{if(peerInputLocked()){e.preventDefault();notify('別の表示で入力中です。変換の確定をお待ちください。');}},{capture:true});
async function start(){
  if(detachedSide){
    try{
      paneSession=window.opener?.__mdSplitPanes?.attach(window,{
        refresh(snapshot){settings={...settings,...snapshot.settings,viewMode:detachedSide,outlineVisible:false};mode=snapshot.mode;$('#app').inert=snapshot.locked;lastSelection=current()?.selection||lastSelection;if(current()){if(sourceBusy||composing)scheduleRender();else applySettings();}},
        position(at){if(current())features.active(at);},followScroll(anchor){features.followScroll(anchor);}
      });
      if(!paneSession)throw new Error('元のウィンドウに接続できません。');
      settings={...settings,...paneSession.settings,viewMode:detachedSide,outlineVisible:false};mode=paneSession.mode;
      documents=[paneSession.document];activeId=paneSession.document.id;lastSelection=current().selection;side=detachedSide;$('#app').inert=paneSession.locked;
      window.addEventListener('pagehide',()=>{textPreview.finishEdit({force:true});if(current()?.componentEditing===window)current().componentEditing=null;if(current()?.compositionOwner===window){current().composing=false;current().compositionOwner=null;}paneSession?.detach();});
    }catch(e){$('#app').replaceChildren();const p=document.createElement('p');p.textContent=e.message;$('#app').append(p);return;}
  }else{
    const initial=await host('bootstrap');settings={...settings,...initial.settings};settings.fileTypeSettings=normalizeFileTypeSettings(settings);mode=initial.mode||'normal';
    if(initial.documents?.length)for(const d of initial.documents)newDocument(d);
    else if(initial.showWelcome||!isDesktop&&!settings.welcomeShown){await openWelcome();settings.welcomeShown=true;await host('settings.set',settings);}
    else newDocument({name:'無題.'+(['md','csv','txt','html','json','tsv','xml'].includes(settings.startupFormat)?settings.startupFormat:'md')});
    if(initial.activeId&&documents.some(d=>d.id===initial.activeId))switchDocument(initial.activeId);
    paneHub=createPaneHub({current,documents:()=>documents,settings:id=>({...settings,...presentationFor(settings,fileKind(documents.find(d=>d.id===id)||current()))}),mode:()=>mode,locked:()=>!!$('#app').inert||$('#modal').open||csvDialogOpen,notify,save:saveDocument,setSettings,setMode,csvSidecar,
      changed(id){if(id===activeId){lastSelection=current().selection;if(!sourceBusy&&!composing)render();else scheduleRender();}else renderTabs();saveRecovery();},
      position(id,at){if(id===activeId)features.active(at);},followScroll(id,anchor){if(id===activeId)features.followScroll(anchor);},
      focusOwner(){if(isDesktop)return host('window.focus');window.focus();},
      async search(id,replace,selected){switchDocument(id);if(!md()&&effectiveView()==='preview'){current().previewViewMode='split';updateView();}if(isDesktop)await host('window.focus');else window.focus();features.openSearch(replace,selected);}
    });
    if(initial.recovered)notify(initial.recoveryReason==='update'?'更新前のタブを復元しました。':'前回の未保存内容を復元しました。');updates.startup();
  }
  updateView=setupViewControls({settings:viewSettings,setSettings:guard(setViewSettings),isPopup:detachedSide});
  applySettings();
  if(import.meta.env.DEV)window.__mdSplit={settings:()=>settings,openDocument(data){return newDocument(data).id;},setText(text){const d=current();d.raw=text;d.saved=text;d.selection={from:0,to:0};lastSelection=d.selection;render({resetSource:true});publishPeers();},getText:()=>current().raw,setMode,documents:()=>documents,renderer:rich,model:()=>current(),editor:()=>cm};
}
window.addEventListener('blur',()=>{if(!md())textPreview.finishEdit();});
matchMedia('(prefers-color-scheme:dark)').addEventListener('change',()=>{if(settings.theme==='system')applySettings();});
guard(start)();
