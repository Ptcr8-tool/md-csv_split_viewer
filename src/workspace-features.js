import {EditorView} from '@codemirror/view';
import {foldedRanges,foldEffect,unfoldEffect} from '@codemirror/language';
import {rawToLf,lfToRaw} from './document.js';
import {lineAt} from './editing.js';
import {linkedEditor,activeSourceLine} from './linked-editor.js';
import {linkAt,outlineFromHeadings} from './navigation.js';
import {host,isDesktop} from './bridge.js';
import {searchText,regexSamples} from './search.js';
import {PreviewActiveLine} from './active-line.js';
import {htmlOutline,HTML_OUTLINE_MANUAL_THRESHOLD} from './html-outline.js';
const $=s=>document.querySelector(s);
export class WorkspaceFeatures{
  constructor(api){
    this.api=api;this.headings=[];this.owner='source';this.suppressUntil=0;
    // UI tests wait for the actual scroll-synchronization guard, not a guessed delay.
    // Vite removes this hook from production builds.
    if(import.meta.env.DEV)window.__mdSplitScrollReady=()=>performance.now()>=this.suppressUntil;
    this.previewActiveLine=new PreviewActiveLine($('#preview'),position=>{const d=api.current();if(!d)return null;position=Math.min(d.raw.length,Math.max(0,position??d.selection.from));return {line:lineAt(d.raw,position),position,leaves:api.rich.leaves};});
    for(const [selector,side] of [['#source','source'],['#preview','preview'],['#text-preview','preview']])for(const event of ['wheel','pointerdown','focusin'])$(selector).addEventListener(event,()=>{this.owner=side;});
    $('#preview').addEventListener('scroll',()=>this.onScroll('preview'));
    $('#text-preview').addEventListener('scroll',event=>{if(event.target===this.grid()?.scroller)this.onScroll('preview');},true);
    $('#text-preview').addEventListener('csv-viewport-change',()=>{this.owner='preview';this.suppressUntil=0;this.onScroll('preview');});
    $('#preview').addEventListener('click',e=>{if(e.ctrlKey&&!e.target.closest('a,button,input,select,textarea'))this.previewLink(e);});
    $('#preview').addEventListener('dblclick',e=>{if(!e.target.closest('a,button,input,select,textarea'))this.previewLink(e);});
    $('#search-panel').addEventListener('click',e=>{const action=e.target.closest('[data-search]')?.dataset.search;if(action==='close')$('#search-panel').hidden=true;else if(action==='samples')this.samples();else if(action)this.api.guard(()=>this.search(action))();});
    $('#find-text').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();this.api.guard(()=>this.search(e.shiftKey?'prev':'next'))();}if(e.key==='Escape'){$('#search-panel').hidden=true;api.editor()?.focus();}});
    $('#outline-expand').onclick=()=>this.foldAll(false);$('#outline-collapse').onclick=()=>this.foldAll(true);
    document.addEventListener('keydown',e=>{if(e.key==='F3'&&!e.target.closest('dialog')){e.preventDefault();if($('#search-panel').hidden)this.openSearch();else this.api.guard(()=>this.search(e.shiftKey?'prev':'next'))();}});
  }
  extensions(){return linkedEditor(()=>this.headings,from=>this.toggleHeading(from));}
  sourcePointer(e,view){if(!e.ctrlKey&&e.type!=='dblclick')return false;const at=view.posAtCoords({x:e.clientX,y:e.clientY});if(at===null)return false;const url=linkAt(this.api.current().raw,lfToRaw(this.api.current().raw,at),this.api.isMarkdown?.()!==false);if(!url)return false;e.preventDefault();this.api.guard(()=>this.api.openLink(url))();return true;}
  previewLink(e){const s=this.api.rich.selection();if(!s)return;const url=linkAt(this.api.current().raw,s.from);if(url){e.preventDefault();this.api.guard(()=>this.api.openLink(url))();}}
  closedAnchors(){const d=this.api.current();if(!d.foldAnchors)d.foldAnchors=[];d.foldAnchors=d.foldAnchors.filter(a=>a.valid);return d.foldAnchors;}
  render(){
    const {api}=this,d=api.current(),cm=api.editor();if(!d||!cm)return;
    const html=api.isHtml?.()===true;
    if(api.isMarkdown?.()===false&&!html){this.headings=[];$('#outline-panel').hidden=true;$('#outline-tree').replaceChildren();$('#sync-toggle').classList.toggle('selected',!!api.settings().sync);$('#sync-toggle').setAttribute('aria-pressed',String(!!api.settings().sync));this.active(d.selection.from);return;}
    if(html&&d.raw.length>HTML_OUTLINE_MANUAL_THRESHOLD){
      if(this.htmlOutlineState?.doc!==d)this.htmlOutlineState={doc:d,raw:null,headings:null};
      const state=this.htmlOutlineState;
      if(state.raw!==d.raw){
        this.headings=[];const effects=[];foldedRanges(cm.state).between(0,cm.state.doc.length,(from,to)=>effects.push(unfoldEffect.of({from,to})));if(effects.length)cm.dispatch({effects});
        $('#outline-panel').hidden=api.settings().outlineVisible===false;$('#outline-toggle').classList.toggle('selected',api.settings().outlineVisible!==false);$('#outline-toggle').setAttribute('aria-pressed',String(api.settings().outlineVisible!==false));
        const list=$('#outline-tree');list.replaceChildren();const message=document.createElement('p');message.className='muted';message.textContent='大きなHTMLの見出し作成には時間やメモリが必要になる場合があります。';const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=state.raw===null?'見出しを表示':'見出しを更新';button.onclick=()=>{const raw=d.raw;button.disabled=true;message.textContent='見出しを作成しています。';setTimeout(()=>{if(api.current()!==d||d.raw!==raw)return;try{state.headings=htmlOutline(raw);state.raw=raw;this.render();}catch(error){message.textContent='見出しを作成できませんでした。原文はそのまま編集できます。';button.disabled=false;}},0);};list.append(message,button);this.active(d.selection.from);return;
      }
    }else if(html)this.htmlOutlineState=null;
    const anchors=this.closedAnchors();const outline=html?(this.htmlOutlineState?.doc===d&&this.htmlOutlineState.raw===d.raw?this.htmlOutlineState.headings:htmlOutline(d.raw)):outlineFromHeadings(api.rich.headings,d.raw);this.headings=outline.map(h=>({...h,lfFrom:cm.state.doc.lineAt(rawToLf(d.raw,h.from)).from,closed:anchors.some(a=>a.from===h.from)}));
    const effects=[];foldedRanges(cm.state).between(0,cm.state.doc.length,(from,to)=>effects.push(unfoldEffect.of({from,to})));
    for(const h of this.headings)if(h.closed&&h.foldTo>h.to)effects.push(foldEffect.of({from:rawToLf(d.raw,h.to),to:rawToLf(d.raw,h.foldTo)}));
    if(effects.length)cm.dispatch({effects});
    for(const node of $('#preview').querySelectorAll('[data-block]')){const from=Number(node.dataset.from);node.hidden=this.headings.some(h=>h.closed&&from>h.from&&from<h.end);const heading=this.headings.find(h=>h.from===from),b=node.querySelector(':scope > .heading-fold');if(heading&&b){b.textContent=heading.closed?'▸':'▾';b.setAttribute('aria-expanded',String(!heading.closed));b.setAttribute('aria-label',heading.closed?'見出しを開く':'見出しを折りたたむ');b.disabled=heading.foldTo<=heading.to;node.classList.toggle('section-collapsed',heading.closed);}}
    $('#outline-panel').hidden=api.settings().outlineVisible===false;$('#outline-toggle').classList.toggle('selected',api.settings().outlineVisible!==false);$('#outline-toggle').setAttribute('aria-pressed',String(api.settings().outlineVisible!==false));
    $('#sync-toggle').classList.toggle('selected',api.settings().sync);$('#sync-toggle').setAttribute('aria-pressed',String(api.settings().sync));
    const list=$('#outline-tree');list.replaceChildren();if(!this.headings.length){const n=document.createElement('p');n.className='muted';n.textContent=html?'HTMLに h1〜h6 を追加すると、ここに一覧が表示されます。':'見出し（#）を追加すると、ここに一覧が表示されます。';list.append(n);}
    const closedEnds=[];for(const h of this.headings){while(closedEnds.length&&h.from>=closedEnds.at(-1))closedEnds.pop();const row=document.createElement('div');row.className='outline-row';row.style.paddingLeft=(h.level-1)*13+'px';row.dataset.from=h.from;row.hidden=closedEnds.length>0;if(h.closed)closedEnds.push(h.end);const fold=document.createElement('button');fold.className='outline-fold';fold.type='button';fold.textContent=h.closed?'▸':'▾';fold.disabled=h.foldTo<=h.to;fold.setAttribute('aria-label',(h.closed?'開く: ':'折りたたむ: ')+h.text);fold.setAttribute('aria-expanded',String(!h.closed));fold.onclick=()=>this.toggleHeading(h.from);const jump=document.createElement('button');jump.className='outline-jump';jump.type='button';jump.textContent=h.text||'（空の見出し）';jump.title='見出し'+h.level+': '+h.text;jump.onclick=()=>this.jump(h.from);row.append(fold,jump);list.append(row);}
    this.active(d.selection.from);
  }
  toggleHeading(from){const h=this.headings.find(h=>h.from===from);if(!h||h.foldTo<=h.to)return;const anchors=this.closedAnchors(),old=anchors.find(a=>a.from===from);if(old){old.dispose();this.api.current().foldAnchors=anchors.filter(a=>a!==old);}else anchors.push(this.api.current().trackRange({from,to:from}));this.suppressUntil=performance.now()+150;this.api.render();}
  foldAll(closed){for(const a of this.closedAnchors())a.dispose();this.api.current().foldAnchors=closed?this.headings.filter(h=>h.foldTo>h.to).map(h=>this.api.current().trackRange({from:h.from,to:h.from})):[];this.suppressUntil=performance.now()+150;this.api.render();}
  reveal(from,to=from){const anchors=this.closedAnchors(),open=this.headings.filter(h=>h.closed&&to>=h.to&&from<h.end);for(const h of open)anchors.find(a=>a.from===h.from)?.dispose();this.api.current().foldAnchors=anchors.filter(a=>!open.some(h=>a.from===h.from));this.api.render();}
  jump(from){this.reveal(from);this.api.selectSource({from,to:from});this.scrollPreview(from);this.active(from);}
  active(position){
    const d=this.api.current(),cm=this.api.editor();if(!d||!cm)return;const line=lineAt(d.raw,position);cm.dispatch({effects:activeSourceLine.of(rawToLf(d.raw,line.start))});
    if(this.api.isMarkdown?.()!==false)this.previewActiveLine.set(position);
    this.grid()?.setActivePosition(position);
    const active=this.headings.findLast(h=>h.from<=position);$('#outline-tree').querySelectorAll('.outline-row').forEach(n=>n.classList.toggle('active',Number(n.dataset.from)===active?.from));
  }
  grid(){const grid=this.api.textPreview?.();return grid?.visible&&['csv','tsv'].includes(grid.kind)?grid:null;}
  visibleLeaf(raw){return this.api.rich.leaves.find(l=>l.to>=raw&&!l.node.parentElement?.closest('[hidden]'))||this.api.rich.leaves.findLast(l=>!l.node.parentElement?.closest('[hidden]'));}
  scrollPreview(raw){const grid=this.grid();if(grid){this.suppressUntil=performance.now()+120;grid.scrollToPosition(raw);return;}if(this.api.isHtml?.()){const heading=this.headings.findLast(h=>h.from<=raw),frame=this.api.textPreview?.()?.container?.querySelector('iframe.text-preview-html');if(heading&&frame?.contentWindow)frame.contentWindow.location='about:srcdoc#mdsplit-heading-'+heading.from;return;}const leaf=this.visibleLeaf(raw);if(!leaf)return;const p=$('#preview'),r=document.createRange();let at=leaf.map.findIndex(n=>n>=raw);if(at<0)at=0;r.setStart(leaf.node,Math.min(at,leaf.node.length));r.setEnd(leaf.node,Math.min(at+1,leaf.node.length));const box=r.getBoundingClientRect();this.suppressUntil=performance.now()+120;p.scrollTop+=box.top-p.getBoundingClientRect().top-16;}
  followScroll({position=0,bottom=false}={}){
    const cm=this.api.editor(),d=this.api.current(),p=$('#preview');if(!cm||!d||!this.api.settings().sync)return;
    const at=Math.min(d.raw.length,Math.max(0,Number.isFinite(position)?position:0));this.suppressUntil=performance.now()+150;
    if(cm.scrollDOM.clientHeight>0){if(bottom)cm.scrollDOM.scrollTop=cm.scrollDOM.scrollHeight;else cm.dispatch({effects:EditorView.scrollIntoView(rawToLf(d.raw,at),{y:'start',yMargin:0})});}
    const grid=this.grid();if(grid)grid.scrollToPosition(at,{bottom});else if(p.clientHeight>0){if(bottom)p.scrollTop=p.scrollHeight;else this.scrollPreview(at);}
    this.suppressUntil=performance.now()+150;
  }
  onScroll(owner){
    if(!this.api.settings().sync||this.owner!==owner||performance.now()<this.suppressUntil)return;
    const cm=this.api.editor(),d=this.api.current(),p=$('#preview');if(!cm||!d)return;const grid=this.grid();this.suppressUntil=performance.now()+90;
    if(owner==='source'){
      const bottom=cm.scrollDOM.scrollTop+cm.scrollDOM.clientHeight>=cm.scrollDOM.scrollHeight-3;
      const box=cm.scrollDOM.getBoundingClientRect(),visual=grid?cm.posAtCoords({x:Math.max(box.left+5,cm.contentDOM.getBoundingClientRect().left+5),y:box.top+3},false):null;
      const position=bottom?d.raw.length:lfToRaw(d.raw,visual??cm.lineBlockAtHeight(Math.max(0,cm.scrollDOM.scrollTop)).from);
      if(grid)grid.scrollToPosition(position,{bottom});else if(p.clientHeight>0){if(bottom)p.scrollTop=p.scrollHeight;else this.scrollPreview(position);}
      this.api.onScrollAnchor?.({position,bottom});
    }else{
      if(grid){const anchor=grid.scrollAnchor();if(!anchor)return;if(cm.scrollDOM.clientHeight>0){if(anchor.bottom)cm.scrollDOM.scrollTop=cm.scrollDOM.scrollHeight;else cm.dispatch({effects:EditorView.scrollIntoView(rawToLf(d.raw,anchor.position),{y:'start',yMargin:0})});}this.api.onScrollAnchor?.(anchor);return;}
      if(p.scrollTop+p.clientHeight>=p.scrollHeight-3){if(cm.scrollDOM.clientHeight>0)cm.scrollDOM.scrollTop=cm.scrollDOM.scrollHeight;this.api.onScrollAnchor?.({position:d.raw.length,bottom:true});return;}
      const top=p.getBoundingClientRect().top+16,leaf=this.api.rich.leaves.find(l=>!l.node.parentElement?.closest('[hidden]')&&l.node.parentElement.getBoundingClientRect().bottom>=top);if(!leaf)return;
      if(cm.scrollDOM.clientHeight>0)cm.dispatch({effects:EditorView.scrollIntoView(rawToLf(d.raw,leaf.from),{y:'start',yMargin:0})});
      this.api.onScrollAnchor?.({position:leaf.from,bottom:false});
    }
  }
  // Snapshot before the toolbar finalizes an active CSV cell editor. The native
  // search panel works on Markdown/CSV source, not the rendered document.
  captureSearchSelection(){
    const d=this.api.current(),cm=this.api.editor(),active=document.activeElement;
    let text='',richSelection=false;
    if(d&&cm?.hasFocus){const s=cm.state.selection.main;if(!s.empty)text=d.raw.slice(lfToRaw(d.raw,s.from),lfToRaw(d.raw,s.to));}
    else if(active?.matches?.('#text-preview textarea.text-preview-cell-input, #preview textarea.diagram-code')){
      const from=active.selectionStart,to=active.selectionEnd;if(Number.isInteger(from)&&to>from)text=active.value.slice(from,to);
    }else if(active?.closest?.('#text-preview .text-preview-scroll')){
      const selected=window.getSelection(),node=selected?.anchorNode,focus=selected?.focusNode;
      const cell=node?.parentElement?.closest?.('[data-cell-row][data-cell-column]');
      if(selected&&!selected.isCollapsed&&cell&&cell.contains(focus)){text=selected.toString();richSelection=!!text&&!d?.raw.includes(text);}
    }else if(active&&$('#preview').contains(active)){
      const selected=window.getSelection();
      if(selected&&!selected.isCollapsed&&$('#preview').contains(selected.anchorNode)&&$('#preview').contains(selected.focusNode)){
        text=selected.toString();const range=this.api.rich.selection();richSelection=!!range&&d?.raw.slice(range.from,range.to)!==text;
      }
    }
    return {document:d,text,richSelection};
  }
  rememberSearchSelection(){this.pendingSearchSelection=this.captureSearchSelection();}
  openSearch(replace=false,forwarded=null){
    const snapshot=forwarded?{document:this.api.current(),text:String(forwarded.text||''),richSelection:!!forwarded.richSelection}:(this.pendingSearchSelection||this.captureSearchSelection());this.pendingSearchSelection=null;
    $('#search-panel').hidden=false;$('#replace-row').hidden=!replace;
    if(snapshot.document===this.api.current()&&snapshot.text){
      if(/[\r\n]/.test(snapshot.text))$('#search-message').textContent='複数行の選択は検索欄に転記できません。1行を選択してください。';
      else{
        $('#find-text').value=snapshot.text;$('#find-regex').checked=false;
        $('#search-message').textContent=snapshot.richSelection?'選択した表示文字を転記しました。原文に書式記号が含まれる場合は一致しないことがあります。':'選択した文字を転記しました（正規表現オフ）。';
      }
    }
    $('#find-text').focus();$('#find-text').select();
  }
  async search(action){
    const d=this.api.current(),revision=d.revision,selection=d.selection,backward=action==='prev',find=action==='next'||backward;$('#search-message').textContent='検索中…';
    const request={text:d.raw,pattern:$('#find-text').value,replacement:$('#replace-text').value,regex:$('#find-regex').checked,ignoreCase:!$('#find-case').checked,action:find?'find':action,direction:backward?-1:1,from:backward?selection.from:action==='replace'?selection.from:selection.to,to:selection.to};
    try{const result=await searchText(request,d);if(d!==this.api.current()||d.revision!==revision||d.raw!==request.text){$('#search-message').textContent='文章が変わりました。もう一度検索してください。';return;}if(!result.count){$('#search-message').textContent='見つかりませんでした';return;}if(result.text!==undefined)this.api.apply(0,d.raw.length,result.text);
      this.reveal(result.from,result.to);d.selection={from:result.from,to:result.to};this.api.selectSource(d.selection);this.suppressUntil=performance.now()+150;this.scrollPreview(result.from);this.active(result.from);$('#search-message').textContent=result.count.toLocaleString()+(find?'件一致':'件置換');
    }catch(e){$('#search-message').textContent=e.message;}
  }
  async samples(){await this.api.dialog('正規表現のサンプル','<p class="muted">検索と置換に入力するサンプルを選びます。Windows版は.NETの正規表現です。サクラエディタと共通する基本記法を使えますが、完全互換ではありません。置換は $1、${名前} または \\1、改行は \\r\\n、Tabは \\t です。</p><div id="regex-samples"></div>',()=>{for(const sample of regexSamples){const b=document.createElement('button');b.type='button';b.className='regex-sample secondary';const label=document.createElement('strong');label.textContent=sample.label;const code=document.createElement('code');code.textContent=sample.pattern;const description=document.createElement('small');description.textContent=sample.description;b.append(label,code,description);b.onclick=()=>{$('#find-text').value=sample.pattern;$('#replace-text').value=sample.replacement;$('#find-regex').checked=true;$('#replace-row').hidden=false;$('#modal').close('cancel');};$('#regex-samples').append(b);}});}
  async recent(){if(!isDesktop){this.api.notify('最近開いたファイルはWindows版で利用できます。');return;}const entries=await host('recent.list');await this.api.dialog('最近開いたファイル','<div id="recent-files"></div><p class="muted">ファイル名を選ぶと開きます。見つからないファイルは移動・削除された可能性があります。</p><button type="button" id="clear-recent" class="secondary">履歴を消去</button>',()=>{if(!entries.length){$('#recent-files').textContent='まだ履歴はありません。';}for(const entry of entries){const b=document.createElement('button');b.type='button';b.className='recent-file secondary';b.disabled=!entry.exists;const name=document.createElement('strong');name.textContent=entry.name;const path=document.createElement('small');path.textContent=entry.path+(entry.exists?'':'（見つかりません）');b.append(name,path);b.onclick=this.api.guard(async()=>{await host('recent.open',{id:entry.id});$('#modal').close('cancel');});$('#recent-files').append(b);}$('#clear-recent').onclick=this.api.guard(async()=>{await host('recent.clear');$('#recent-files').textContent='履歴を消去しました。ファイルは削除していません。';});});}
}
