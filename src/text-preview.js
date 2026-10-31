import './text-preview.css';
import {normalizeCsvView,csvColumnLabel,csvCellAlignment,deleteDelimitedSelection} from './csv-view.js';
import {csvSelectionAddress,createCsvSelectionFooter} from './csv-selection-status.js';
import {nextCsvSelection} from './csv-selection.js';
import {csvSelectionBounds,csvCopyText,parseClipboardGrid,pasteCsvGrid,csvChangedRange} from './csv-clipboard.js';
import {convertCsvRange,transposeCsvClipboard} from './csv-conversion.js';
import {openCsvContextMenu} from './csv-context-menu.js';
import {host} from './bridge.js';
import {applyCsvToolbarIcons} from './csv-toolbar-icons.js';
import {csvRowAtPosition,visibleCsvRow} from './csv-links.js';
import {sortDelimitedRows,filteredCsvRows,moveDelimitedColumns} from './csv-sort-filter.js';

import {DelimitedPreviewError,parseDelimited,encodeDelimitedCell} from './csv-parser.js';
export {PREVIEW_LIMITS,DelimitedPreviewError,parseDelimited,encodeDelimitedCell} from './csv-parser.js';
export const CSV_PAGE_ROWS=100,CSV_PAGE_COLUMNS=50;
import {buildHtmlPreview} from './html-preview.js';
export {buildHtmlPreview} from './html-preview.js';

// This is a prompt threshold, not a file size limit. Very large documents can
// still be previewed after explicit confirmation; changes then use refresh.
const HTML_PREVIEW_MANUAL_THRESHOLD=2*1024*1024;


const make=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
const delimiters={auto:null,comma:',',tab:'\t',semicolon:';'};
export class TextPreview{
  constructor(container,api={}){
    this.container=container;this.api=api;this.originalEditable=container.getAttribute('contenteditable');this.clear();
    container.addEventListener('click',event=>this.selectFromEvent(event));
    container.addEventListener('copy',event=>this.copyGrid(event));
    container.addEventListener('paste',event=>this.pasteGrid(event));
    container.addEventListener('contextmenu',event=>this.csvContextMenu(event));
    container.addEventListener('pointerdown',event=>{if(!this.commitHeaderSelection(event))this.beginResize(event);});
    container.addEventListener('dblclick',event=>{const cell=event.target.closest?.('[data-cell-row][data-cell-column]');if(cell&&!event.target.closest('textarea')){event.preventDefault();this.startEdit(Number(cell.dataset.cellRow),Number(cell.dataset.cellColumn));}});
    container.addEventListener('keydown',event=>{if(event.target.closest?.('textarea,input,select,dialog,[contenteditable="true"]'))return;const key=event.key.toLowerCase(),inGrid=event.target.closest?.('.text-preview-scroll');if((event.ctrlKey||event.metaKey)&&inGrid&&this.parsed){if(key==='a'){event.preventDefault();event.stopPropagation();this.selectAll();return;}if((key==='z'||key==='y')&&this.api.history){event.preventDefault();event.stopPropagation();this.api.history(key==='y'||event.shiftKey);this.scroller?.focus({preventScroll:true});return;}}const cell=event.target.closest?.('[data-cell-row][data-cell-column]');if(cell&&event.key==='F2'){event.preventDefault();this.startEdit(Number(cell.dataset.cellRow),Number(cell.dataset.cellColumn));}else if(cell&&event.key==='Enter'&&!event.shiftKey&&!event.ctrlKey&&!event.altKey&&!event.metaKey){event.preventDefault();event.stopPropagation();this.moveAfterEnter(Number(cell.dataset.cellRow),Number(cell.dataset.cellColumn),false);}});
  }
  get visible(){return this._visible;}
  get editing(){return this._editing||null;}
  get hasEditor(){return !!this._editing;}
  clear(){this._cancelDialog?.();this._layoutShape=null;this.finishEdit({redraw:false,force:true});this.container.replaceChildren();this.container.hidden=true;this.container.classList.remove('text-preview');if(this.originalEditable===null)this.container.removeAttribute('contenteditable');else this.container.setAttribute('contenteditable',this.originalEditable);this._visible=false;this._activePosition=null;this._scrollLayout=null;this.raw=null;this.kind=null;this.cache=null;this.options=null;this.csvSettings=null;this.parsed=null;this._parsedRaw=null;this.scroller=null;this.status=null;this.pagination=null;this.view=normalizeCsvView();this.selection=null;this._resizeCleanup?.();this._resizeCleanup=null;}
  render(raw,kind,options={}){
    if(!['html','csv','tsv'].includes(kind)){this.clear();return false;}
    const cache={docId:options.docId??options.documentId??null,fontSize:options.fontSize??14,delimiter:options.delimiter??null,header:options.header??null,view:JSON.stringify(normalizeCsvView(options.csvView??(this.cache?.docId===(options.docId??options.documentId??null)?this.view:{})))};
    if(this._editing&&this.kind===kind&&this.cache?.docId===cache.docId){this.raw=raw;this.cache=cache;this.options=options;this.view=normalizeCsvView(options.csvView??this.view);return true;}
    if(this._editing)this.finishEdit({redraw:false,force:true});
    if(this.raw===raw&&this.kind===kind&&this.cache&&Object.keys(cache).every(key=>this.cache[key]===cache[key]))return true;
    const sameDocument=this.kind===kind&&this.cache?.docId===cache.docId;
    const previousHtmlFrame=sameDocument&&kind==='html'?this.container.querySelector('iframe.text-preview-html'):null;
    this.view=normalizeCsvView(options.csvView??(sameDocument?this.view:{}));if(!sameDocument){this.selection=null;this._layoutShape=null;this._pasteShapes=null;this._activePosition=null;this._scrollLayout=null;}this._cancelDialog?.();this.raw=raw;this.kind=kind;this.cache=cache;this.options=options;this._visible=true;this.container.hidden=false;this.container.classList.add('text-preview');this.container.contentEditable='false';
    // Keep the already approved large preview attached while the user edits;
    // replacing the iframe on every keystroke would reload the large document.
    if(previousHtmlFrame&&raw.length>HTML_PREVIEW_MANUAL_THRESHOLD){for(const child of [...this.container.children])if(child!==previousHtmlFrame)child.remove();}else this.container.replaceChildren();
    this.parsed=null;this.scroller=null;this.status=null;this.addressOutput=null;
    if(kind==='html'){
      const status=make('p','text-preview-status','HTMLプレビュー（読み取り専用） · スクリプト・外部画像・リンク・外部通信は無効です。');
      this.container.insertBefore(status,previousHtmlFrame?.isConnected?previousHtmlFrame:null);
      const makeFrame=()=>{const frame=make('iframe','text-preview-html');frame.title='HTMLプレビュー（読み取り専用）';frame.setAttribute('sandbox','');frame.setAttribute('allow','');frame.referrerPolicy='no-referrer';return frame;};
      if(raw.length>HTML_PREVIEW_MANUAL_THRESHOLD){
        status.textContent='大きなHTMLです。プレビューの作成には時間やメモリが必要になる場合があります。原文はそのまま編集できます。';
        const button=make('button','text-preview-large-button',previousHtmlFrame?'プレビューを更新':'プレビューを表示');button.type='button';this.container.insertBefore(button,previousHtmlFrame?.isConnected?previousHtmlFrame:null);
        button.addEventListener('click',()=>{button.disabled=true;status.textContent='HTMLプレビューを作成しています。';this.container.querySelector('.text-preview-error')?.remove();
          setTimeout(()=>{if(!button.isConnected)return;try{const content=buildHtmlPreview(raw,options);if(!button.isConnected)return;const frame=this.container.querySelector('iframe.text-preview-html')||makeFrame();frame.srcdoc=content;if(!frame.isConnected)this.container.append(frame);status.textContent='HTMLプレビュー（読み取り専用） · 編集後は「プレビューを更新」で反映します。スクリプト・外部通信は無効です。';button.textContent='プレビューを更新';button.disabled=false;}catch(error){if(button.isConnected){status.textContent='HTMLプレビューを作成できませんでした。原文はそのまま編集できます。';this.showError(error);button.disabled=false;}}},0);
        });
      }else{
        try{const frame=makeFrame();frame.srcdoc=buildHtmlPreview(raw,options);this.container.append(frame);}catch(error){this.showError(error);}
      }
      return true;
    }
    this.csvSettings=sameDocument&&this.csvSettings?this.csvSettings:{delimiter:'auto',header:true,allowLarge:false,warningShown:false,rowPage:0,columnPage:0,filter:null};
    if(options.delimiter!==undefined)this.csvSettings.delimiter=Object.hasOwn(delimiters,options.delimiter)?options.delimiter:Object.entries(delimiters).find(([,value])=>value===options.delimiter)?.[0]||'auto';
    if(options.header!==undefined)this.csvSettings.header=options.header!==false;
    const toolbar=make('div','text-preview-toolbar'),label=make('label',null,'区切り文字 '),select=make('select');select.setAttribute('aria-label','区切り文字');
    for(const [value,text] of [['auto','ファイルに合わせる'],['comma','カンマ ,'],['tab','Tab'],['semicolon','セミコロン ;']]){const option=make('option',null,text);option.value=value;select.append(option);}select.value=this.csvSettings.delimiter;label.append(select);toolbar.append(label);
    const headerLabel=make('label','text-preview-header-choice'),header=make('input');header.type='checkbox';header.checked=this.csvSettings.header;headerLabel.append(header,document.createTextNode('先頭行を見出しにする'));toolbar.append(headerLabel);this.buildGridToolbar(toolbar);applyCsvToolbarIcons(toolbar);this.container.append(toolbar);
    this.pagination=make('div','text-preview-pagination');this.container.append(this.pagination);
    this.status=make('p','text-preview-status');this.status.setAttribute('role','status');this.container.append(this.status);this.scroller=make('div','text-preview-scroll');this.scroller.tabIndex=0;this.container.append(this.scroller);const {footer,output}=createCsvSelectionFooter();this.addressOutput=output;this.container.append(footer);
    select.addEventListener('change',()=>{this.csvSettings.delimiter=select.value;this.renderTable();});header.addEventListener('change',()=>{this.csvSettings.header=header.checked;this.renderTable();});this.renderTable();return true;
  }
  showError(error,target=this.container){const message=make('p','text-preview-error',error instanceof Error?error.message:'プレビューを表示できませんでした。');message.setAttribute('role','status');target.append(message);}
  renderTable(){
    const wrapToggle=this.container.querySelector('input[aria-label="セル内で折り返す"]');if(wrapToggle)wrapToggle.checked=this.view.wrap;
    if(this._editing&&!this.finishEdit({redraw:false}))return;
    this.scroller.replaceChildren();
    try{
      const delimiter=delimiters[this.csvSettings.delimiter]??(this.kind==='tsv'?'\t':',');const result=this.parsed&&this._parsedRaw===this.raw&&this.parsed.delimiter===delimiter?this.parsed:parseDelimited(this.raw,{delimiter,unlimited:this.csvSettings.allowLarge});const previous=this._layoutShape;
      if(previous&&(previous.rows!==result.rowCount||previous.columns!==result.columnCount)){
        const same=(a,b)=>a&&a.rows===b.rows&&a.columns===b.columns;
        const next={rows:result.rowCount,columns:result.columnCount};
        const preserve=this._pasteShapes?.some(change=>same(previous,change.before)&&same(next,change.after)||same(previous,change.after)&&same(next,change.before));
        if(!preserve){
          if(previous.rows!==result.rowCount){this.view.rowHeights={};this.view.rowAlignment={};this.view.hiddenRows=[];}
          if(previous.columns!==result.columnCount){this.view.columnWidths={};this.view.columnAlignment={};this.view.hiddenColumns=[];}
          this.view.cellAlignment={};this._pasteShapes=null;this.publishView();
        }
        this.selection=null;
      }
      this._layoutShape={rows:result.rowCount,columns:result.columnCount};this.parsed=result;this._parsedRaw=this.raw;
      const editable=typeof this.api.patch==='function';
      this.status.textContent=result.rowCount.toLocaleString('ja-JP')+'行 · 最大'+result.columnCount.toLocaleString('ja-JP')+'列'+(editable?' · ダブルクリックで編集 · Ctrl+Cでコピー · Ctrl+Vで貼り付け':'（読み取り専用）');
      if(!result.rows.length){this.pagination.replaceChildren();this.pagination.hidden=true;this.scroller.append(make('p','text-preview-empty','内容がありません。'));this.updateSelectionStatus();return;}
      const large=this.csvSettings.allowLarge&&(result.rowCount>1000||result.columnCount>100||result.rowCount*result.columnCount>20000);
      this._filterHiddenRows=filteredCsvRows(result,this.csvSettings.filter,this.csvSettings.header);
      if(this.csvSettings.filter)this.status.textContent+=` · 絞り込み中（${result.rowCount-this._filterHiddenRows.size}行表示）`;
      const hiddenRows=new Set([...this.view.hiddenRows,...this._filterHiddenRows]),hiddenColumns=new Set(this.view.hiddenColumns),headerRows=this.csvSettings.header?1:0;
      const allRows=Array.from({length:Math.max(0,result.rowCount-headerRows)},(_,i)=>i+headerRows).filter(i=>!hiddenRows.has(i));
      const allCols=Array.from({length:result.columnCount},(_,i)=>i).filter(i=>!hiddenColumns.has(i));
      const frozenRows=allRows.filter(i=>i<this.view.freezeRows),frozenCols=allCols.filter(i=>i<this.view.freezeColumns);
      const scrollingRows=allRows.filter(i=>i>=this.view.freezeRows),scrollingCols=allCols.filter(i=>i>=this.view.freezeColumns);
      const rowSize=large?CSV_PAGE_ROWS:Math.max(1,scrollingRows.length),colSize=large?CSV_PAGE_COLUMNS:Math.max(1,scrollingCols.length),rowPages=Math.max(1,Math.ceil(scrollingRows.length/rowSize)),colPages=Math.max(1,Math.ceil(scrollingCols.length/colSize));
      this.csvSettings.rowPage=Math.min(this.csvSettings.rowPage||0,rowPages-1);this.csvSettings.columnPage=Math.min(this.csvSettings.columnPage||0,colPages-1);
      this._scrollLayout={large,rowPages,scrollingRows,hiddenRows};
      const visibleRows=[...frozenRows,...scrollingRows.slice(this.csvSettings.rowPage*rowSize,(this.csvSettings.rowPage+1)*rowSize)],columns=[...frozenCols,...scrollingCols.slice(this.csvSettings.columnPage*colSize,(this.csvSettings.columnPage+1)*colSize)];
      this.pagination.replaceChildren();this.pagination.hidden=!large;
      if(large){
        const add=(label,disabled,fn,axis)=>{const button=make('button',null,label);button.type='button';button.disabled=disabled;button.addEventListener('click',()=>{if(!this.finishEdit({redraw:false}))return;fn();if(axis==='row')this.container.dispatchEvent(new Event('csv-viewport-change'));});this.pagination.append(button);};
        add('前の行',this.csvSettings.rowPage===0,()=>{this.csvSettings.rowPage--;this.renderTable();},'row');this.pagination.append(make('span',null,`行ページ ${this.csvSettings.rowPage+1} / ${rowPages}`));add('次の行',this.csvSettings.rowPage>=rowPages-1,()=>{this.csvSettings.rowPage++;this.renderTable();},'row');
        add('前の列',this.csvSettings.columnPage===0,()=>{this.csvSettings.columnPage--;this.renderTable();},'column');this.pagination.append(make('span',null,`列ページ ${this.csvSettings.columnPage+1} / ${colPages}`));add('次の列',this.csvSettings.columnPage>=colPages-1,()=>{this.csvSettings.columnPage++;this.renderTable();},'column');
      }
      const table=make('table','text-preview-table'),head=make('thead'),body=make('tbody'),group=make('colgroup');table.setAttribute('aria-label',this.kind==='tsv'?'TSVプレビュー':'CSVプレビュー');table.classList.toggle('csv-no-wrap',!this.view.wrap);table.classList.toggle('csv-striped',this.view.stripedRows);
      const numberCol=make('col');numberCol.style.width='44px';group.append(numberCol);let width=44;
      for(const column of columns){const col=make('col');col.dataset.columnSize=column;const w=this.view.columnWidths[column]??this.view.defaultColumnWidth;col.style.width=w+'px';width+=w;group.append(col);}table.style.width=width+'px';table.append(group);
      const numberedRow=(values,index,isHeader)=>{
        const row=make('tr');row.dataset.sourceFrom=String(result.rowRanges[index].from);row.dataset.sourceTo=String(result.rowRanges[index].to);row.dataset.gridRow=index;
        const number=make('th','text-preview-row-number'),choose=make('button','csv-row-select',String(index+1));number.scope='row';if(isHeader)number.append(this.selectAllButton());choose.type='button';choose.dataset.selectRow=index;choose.setAttribute('aria-label',`${index+1}行を選択`);number.append(choose);const resize=make('span','csv-row-resize');resize.dataset.resizeRow=index;resize.title='ドラッグして行の高さを変更';number.append(resize);row.append(number);
        const height=this.view.rowHeights[index]??this.view.defaultRowHeight;if(height){row.style.height=height+'px';row.style.setProperty('--csv-row-height',height+'px');row.classList.add('csv-sized-row');}
        for(const column of columns){const cell=make(isHeader?'th':'td'),content=make('div','csv-cell-content',values[column]??'');cell.dataset.gridColumn=column;cell.dataset.gridRow=index;if(isHeader)cell.append(make('div','csv-column-label',csvColumnLabel(column,this.view.columnLabel)));cell.append(content);if(isHeader){cell.scope='col';cell.dataset.selectColumn=column;cell.title='クリックで列選択 · Ctrlで追加 · Shiftで範囲';const resize=make('span','csv-column-resize');resize.dataset.resizeColumn=column;resize.title='ドラッグして列幅を変更';cell.append(resize);}if(editable){cell.dataset.cellRow=String(index);cell.dataset.cellColumn=String(column);cell.classList.add('text-preview-editable-cell');cell.tabIndex=0;cell.setAttribute('aria-label',`${index+1}行 ${column+1}列を編集`);}this.styleCell(cell,index,column);row.append(cell);}return row;
      };
      if(this.csvSettings.header&&!hiddenRows.has(0))head.append(numberedRow(result.rows[0],0,true));else{const row=make('tr'),corner=make('th','text-preview-row-number');corner.append(this.selectAllButton());row.append(corner);for(const column of columns){const cell=make('th','csv-column-label',csvColumnLabel(column,this.view.columnLabel));cell.dataset.selectColumn=column;cell.dataset.gridColumn=column;const resize=make('span','csv-column-resize');resize.dataset.resizeColumn=column;cell.append(resize);row.append(cell);}head.append(row);}
      for(const index of visibleRows)body.append(numberedRow(result.rows[index],index,false));table.append(head,body);this.scroller.append(table);this.updateSelectionStatus();this.setActivePosition(this._activePosition);this.applySticky();
      requestAnimationFrame(()=>{if(table.isConnected)this.applySticky();});
    }catch(error){this.parsed=null;this.pagination.replaceChildren();this.pagination.hidden=true;this.status.textContent='表のプレビューを表示できません。原文の編集は続けられます。';if(error instanceof DelimitedPreviewError&&error.code==='limit')this.offerLargePreview(error);else this.showError(error,this.scroller);}
  }
  setActivePosition(position){
    this._activePosition=Number.isFinite(position)?position:null;
    const index=this._activePosition===null?-1:csvRowAtPosition(this.parsed?.rowRanges,this._activePosition);
    for(const row of this.scroller?.querySelectorAll('tr[data-grid-row]')||[])row.classList.toggle('csv-active-row',Number(row.dataset.gridRow)===index);
  }
  scrollAnchor(){
    const p=this.scroller;if(!p||!this.parsed||!p.clientHeight)return null;
    const rows=[...p.querySelectorAll('tbody tr[data-grid-row]')],moving=rows.filter(row=>Number(row.dataset.gridRow)>=this.view.freezeRows);
    const top=p.getBoundingClientRect().top+(parseFloat(p.querySelector('table')?.style.getPropertyValue('--csv-sticky-top'))||0)+1;
    const row=moving.find(row=>row.getBoundingClientRect().bottom>top)||moving.at(-1)||rows.at(-1);
    if(!row)return null;
    const index=Number(row.dataset.gridRow),range=this.parsed.rowRanges[index],box=row.getBoundingClientRect();
    const fraction=Math.max(0,Math.min(1,(top-box.top)/Math.max(1,box.height)));
    const bottom=p.scrollTop+p.clientHeight>=p.scrollHeight-3&&(!this._scrollLayout?.large||this.csvSettings.rowPage>=this._scrollLayout.rowPages-1);
    return {position:bottom?this.raw.length:range.from+Math.floor((range.to-range.from)*fraction),bottom};
  }
  scrollToPosition(position,{bottom=false}={}){
    const p=this.scroller;if(!p||!p.clientHeight||!this.parsed||this._editing)return false;
    const at=Math.min(this.raw.length,Math.max(0,Number.isFinite(position)?position:0));
    const logical=csvRowAtPosition(this.parsed.rowRanges,at),layout=this._scrollLayout;
    const index=visibleCsvRow(bottom?this.parsed.rowCount-1:logical,this.parsed.rowCount,layout?.hiddenRows||new Set(this.view.hiddenRows));if(index<0)return false;
    if(layout?.large){const movingIndex=layout.scrollingRows.indexOf(index);if(movingIndex>=0){const page=Math.floor(movingIndex/CSV_PAGE_ROWS);if(page!==this.csvSettings.rowPage){this.csvSettings.rowPage=page;this.renderTable();}}}
    if(bottom){p.scrollTop=p.scrollHeight;return true;}
    const row=p.querySelector('tr[data-grid-row="'+index+'"]');if(!row)return false;
    if(index<this.view.freezeRows||row.parentElement.tagName==='THEAD'){p.scrollTop=0;return true;}
    const range=this.parsed.rowRanges[index],fraction=index===logical?Math.max(0,Math.min(1,(at-range.from)/Math.max(1,range.to-range.from))):0;
    const top=(parseFloat(p.querySelector('table')?.style.getPropertyValue('--csv-sticky-top'))||0);
    const rect=row.getBoundingClientRect();p.scrollTop+=rect.top-p.getBoundingClientRect().top-top+fraction*rect.height;return true;
  }
  selectAllButton(){const button=make('button','csv-select-all','▦');button.type='button';button.dataset.selectAll='';button.setAttribute('aria-label','表全体を選択');button.title='表全体を選択（Ctrl+A）';return button;}
  getView(){return normalizeCsvView(this.view);}
  setView(view,docId=this.cache?.docId){if(docId!==this.cache?.docId||!this.finishEdit())return false;this.view=normalizeCsvView(view);this.selection=null;this.publishView();if(this.scroller&&['csv','tsv'].includes(this.kind))this.renderTable();return true;}
  publishView(){this.view=normalizeCsvView(this.view);if(this.cache)this.cache.view=JSON.stringify(this.view);this.api.viewChanged?.(this.cache?.docId,this.getView());}
  buildGridToolbar(toolbar){
    const wrapLabel=make('label'),wrap=make('input');wrap.type='checkbox';wrap.checked=this.view.wrap;wrap.setAttribute('aria-label','セル内で折り返す');wrapLabel.append(wrap,document.createTextNode('折り返す'));wrap.addEventListener('change',()=>{this.view.wrap=wrap.checked;this.publishView();this.renderTable();});toolbar.append(wrapLabel);
    const button=(text,action)=>{const b=make('button',null,text);b.type='button';b.addEventListener('click',action);toolbar.append(b);return b;};
    button('表示設定',()=>this.openGridSettings());this.hideButton=button('選択を非表示',()=>this.hideSelection());this.deleteButton=button('行・列を削除',()=>this.deleteSelection());button('非表示をすべて解除',()=>{this.view.hiddenRows=[];this.view.hiddenColumns=[];this.publishView();this.renderTable();});
    button('並べ替え・列移動',()=>this.openSortDialog());button('絞り込み',()=>this.openFilterDialog());button('絞り込み解除',()=>{this.csvSettings.filter=null;this.csvSettings.rowPage=0;this.selection=null;this.renderTable();});
    if(this.api.saveView)button('表示設定を保存',async()=>{const id=this.cache?.docId;try{await this.api.saveView(id,this.getView());}catch(e){if(id===this.cache?.docId)this.status.textContent=e.message||'表示設定を保存できませんでした。';}});
    if(this.api.loadView)button('表示設定を読込',async()=>{const id=this.cache?.docId;try{const v=await this.api.loadView(id);if(v&&id===this.cache?.docId)this.setView(v,id);}catch(e){if(id===this.cache?.docId)this.status.textContent=e.message||'表示設定を読み込めませんでした。';}});
    this.selectionLabel=make('span','csv-selection-status','セル・行・列をクリックして選択');toolbar.append(this.selectionLabel);
  }
  commitHeaderSelection(event){
    if(!this._editing||event.button!==0||event.target.closest('dialog,[data-resize-row],[data-resize-column]'))return false;
    const all=event.target.closest('[data-select-all]'),row=event.target.closest('[data-select-row]')||event.target.closest('.text-preview-row-number')?.querySelector('[data-select-row]'),column=event.target.closest('[data-select-column]');if(!all&&!row&&!column)return false;if(all){event.preventDefault();event.stopPropagation();if(this.finishEdit()){this.selectAll();this.scroller?.querySelector('[data-select-all]')?.focus({preventScroll:true});}return true;}
    const kind=row?'row':'column',index=Number(row?row.dataset.selectRow:column.dataset.selectColumn);event.preventDefault();event.stopPropagation();
    if(this.finishEdit()){this.selectRange(kind,index,null,event);const target=this.scroller?.querySelector(row?`[data-select-row="${index}"]`:`[data-select-column="${index}"]`);if(target?.tabIndex>=0)target.focus({preventScroll:true});else this.scroller?.focus({preventScroll:true});}return true;
  }
  selectFromEvent(event){
    if(!this.parsed||event.target.closest('textarea,dialog,[data-resize-row],[data-resize-column]'))return;
    const all=event.target.closest('[data-select-all]'),row=event.target.closest('[data-select-row]')||event.target.closest('.text-preview-row-number')?.querySelector('[data-select-row]'),column=event.target.closest('[data-select-column]'),cell=event.target.closest('[data-cell-row][data-cell-column]');
    if(all){this.selectAll();all.focus({preventScroll:true});}else if(row){this.selectRange('row',Number(row.dataset.selectRow),null,event);row.focus({preventScroll:true});}else if(column){this.selectRange('column',Number(column.dataset.selectColumn),null,event);if(!column.hasAttribute('tabindex'))this.scroller?.focus({preventScroll:true});else column.focus({preventScroll:true});}else if(cell){this.selectRange('cell',Number(cell.dataset.cellRow),Number(cell.dataset.cellColumn),event);cell.focus({preventScroll:true});}
  }
  selectAll(){if(!this.parsed?.rowCount||!this.parsed?.columnCount)return;this.selection={kind:'all',entries:new Set(['all']),anchor:[0,0]};this.updateSelectionStatus();}
  csvContextMenu(event){
    if(!['csv','tsv'].includes(this.kind)||!this.parsed||!event.target.closest?.('.text-preview-scroll')||event.target.closest?.('textarea,input,select,dialog,[contenteditable="true"]'))return;
    const cell=event.target.closest('[data-cell-row][data-cell-column]'),row=event.target.closest('[data-select-row]')||event.target.closest('.text-preview-row-number')?.querySelector('[data-select-row]'),column=event.target.closest('[data-select-column]');
    if(!cell&&!row&&!column)return;
    const r=cell?Number(cell.dataset.cellRow):row?Number(row.dataset.selectRow):null,c=cell?Number(cell.dataset.cellColumn):column?Number(column.dataset.selectColumn):null,s=this.selection;
    const selected=s&&(s.kind==='all'||s.kind==='row'&&r!==null&&s.entries.has(r)||s.kind==='column'&&c!==null&&s.entries.has(c)||s.kind==='cell'&&r!==null&&c!==null&&s.entries.has(`${r}:${c}`));
    if(!selected){if(row)this.selectRange('row',r,null);else if(column)this.selectRange('column',c,null);else this.selectRange('cell',r,c);}
    event.preventDefault();event.stopPropagation();this._closeCsvMenu?.();
    const id=this.cache?.docId,selection=this.selection,raw=this.raw;
    const checked=action=>()=>{if(this.cache?.docId!==id||this.selection!==selection||this.raw!==raw){if(this.status)this.status.textContent='文書または選択が変更されたため、操作を中止しました。';return;}action();};
    const item=(label,action)=>({label,action:checked(action)});const editable=typeof this.api.patch==='function'&&this.api.canEdit?.(id)!==false;
    const mutation=(label,action)=>({label,action:checked(action),disabled:!editable});
    this._closeCsvMenu=openCsvContextMenu(event.clientX,event.clientY,[
      item('コピー',()=>this.csvMenuCopy()),mutation('貼り付け',()=>this.csvMenuPaste('normal')),mutation('改行を除いて貼り付け',()=>this.csvMenuPaste('single-line')),mutation('縦横を入れ替えて貼り付け',()=>this.csvMenuPaste('transpose')),null,
      ...[['全角を半角に','half'],['半角を全角に','full'],['半角カタカナをひらがなに','kana-to-hiragana'],['ひらがなを半角カタカナに','hiragana-to-kana'],['英字を大文字に','upper'],['英字を小文字に','lower']].map(([label,op])=>mutation(label,()=>this.csvConvert(op)))
    ],()=>{this._closeCsvMenu=null;});
  }
  async csvMenuCopy(){
    try{const b=csvSelectionBounds(this.selection,this.parsed.rowCount,this.parsed.columnCount);if(!b)return;this.ensureVisibleClipboardRange(b.top,b.left,b.bottom,b.right);const text=csvCopyText(this.parsed,b);await host('clipboard.text',{text});if(this.status)this.status.textContent='選択範囲をコピーしました。';}catch(error){if(this.status)this.status.textContent=error.message||'コピーできませんでした。';}
  }
  async csvMenuPaste(mode){
    const docId=this.cache?.docId,selection=this.selection,raw=this.raw,parsed=this.parsed;
    try{
      let text=await host('clipboard.readText');
      if(this.cache?.docId!==docId||this.selection!==selection||this.raw!==raw||this.parsed!==parsed)throw new Error('文書または選択が変更されたため、貼り付けを中止しました。');
      if(typeof text!=='string')throw new Error('クリップボードにテキストがありません。');
      if(mode==='single-line')text=text.replace(/\r\n|\r|\n/g,'');
      if(mode==='transpose'){const matrix=transposeCsvClipboard(parseClipboardGrid(text));text=matrix.map(row=>row.map(value=>encodeDelimitedCell(value,'\t',row.length===1&&value==='')).join('\t')).join('\r\n');}
      const clipboardData={types:['text/plain'],getData:()=>text};this.pasteGrid({target:this.scroller,clipboardData,preventDefault(){},stopPropagation(){}});
    }catch(error){if(this.status)this.status.textContent=error.message||'貼り付けできませんでした。';}
  }
  csvConvert(operation){
    const id=this.cache?.docId,before=this.raw;
    try{
      if(typeof this.api.patch!=='function'||this.api.canEdit?.(id)===false)throw new Error('この表は現在編集できません。');
      const bounds=csvSelectionBounds(this.selection,this.parsed.rowCount,this.parsed.columnCount);if(!bounds)return;this.ensureVisibleClipboardRange(bounds.top,bounds.left,bounds.bottom,bounds.right);
      const next=convertCsvRange(before,this.parsed,bounds,operation);if(next===before)return;const change=csvChangedRange(before,next);this.raw=next;
      try{if(this.api.patch({docId:id,...change,kind:'command'})===false)throw new Error();}catch{this.raw=before;throw new Error('変換を反映できませんでした。原文は変更していません。');}
      this.renderTable();this.scroller?.focus({preventScroll:true});
    }catch(error){if(this.status)this.status.textContent=error.message||'文字を変換できませんでした。';}
  }
  clipboardTarget(event){return ['csv','tsv'].includes(this.kind)&&this.parsed&&this.selection?.entries?.size&&event.target.closest?.('.text-preview-scroll')&&!event.target.closest?.('textarea,input,select,dialog,[contenteditable="true"]');}
  ensureVisibleClipboardRange(top,left,bottom,right){if(this.view.hiddenRows.some(index=>index>=top&&index<=bottom)||[...(this._filterHiddenRows||[])].some(index=>index>=top&&index<=bottom)||this.view.hiddenColumns.some(index=>index>=left&&index<=right))throw new Error('選択範囲に非表示の行または列（絞り込みで非表示の行を含む）があります。表示してから操作してください。');}
  copyGrid(event){
    if(!this.clipboardTarget(event)||!event.clipboardData)return;
    event.preventDefault();event.stopPropagation();
    try{const bounds=csvSelectionBounds(this.selection,this.parsed.rowCount,this.parsed.columnCount);if(bounds){this.ensureVisibleClipboardRange(bounds.top,bounds.left,bounds.bottom,bounds.right);event.clipboardData.setData('text/plain',csvCopyText(this.parsed,bounds));}}
    catch(error){if(this.status)this.status.textContent=error.message;}
  }
  pasteGrid(event){
    if(!this.clipboardTarget(event)||!event.clipboardData||!Array.from(event.clipboardData.types||[]).includes('text/plain'))return;
    event.preventDefault();event.stopPropagation();
    const id=this.cache?.docId,before=this.raw;
    if(typeof this.api.patch!=='function'||this.api.canEdit?.(id)===false){if(this.status)this.status.textContent='この表は現在編集できません。';return;}
    let bounds,next,matrix,shape,oldShape;
    try{
      bounds=csvSelectionBounds(this.selection,this.parsed.rowCount,this.parsed.columnCount);if(!bounds)return;
      matrix=parseClipboardGrid(event.clipboardData.getData('text/plain'));
      const width=matrix.reduce((maximum,row)=>Math.max(maximum,row.length),0);
      const fill=matrix.length===1&&width===1;
      this.ensureVisibleClipboardRange(bounds.top,bounds.left,fill?bounds.bottom:bounds.top+matrix.length-1,fill?bounds.right:bounds.left+width-1);
      next=pasteCsvGrid(before,this.parsed,bounds,matrix);if(next===before)return;
      oldShape={rows:this.parsed.rowCount,columns:this.parsed.columnCount};shape={rows:Math.max(this.parsed.rowCount,bounds.top+matrix.length),columns:Math.max(this.parsed.columnCount,bounds.left+width)};
    }catch(error){if(this.status)this.status.textContent=error.message||'貼り付けを反映できませんでした。';return;}
    const change=csvChangedRange(before,next);this.raw=next;
    try{if(this.api.patch({docId:id,...change,kind:'command'})===false)throw new Error();}
    catch{this.raw=before;if(this.status)this.status.textContent='貼り付けを反映できませんでした。原文は変更していません。';return;}
    // Paste only expands a grid; existing row/column indices and their view
    // settings remain valid and must not be cleared by shape reconciliation.
    if(!Array.isArray(this._pasteShapes))this._pasteShapes=[];
    this._pasteShapes.push({before:oldShape,after:shape});if(this._pasteShapes.length>200)this._pasteShapes.shift();
    this._layoutShape=shape;this.renderTable();
    if(this.parsed){this.selectRange('cell',bounds.top,bounds.left);this.scroller?.querySelector(`[data-cell-row="${bounds.top}"][data-cell-column="${bounds.left}"]`)?.focus({preventScroll:true});}
  }
  selectRange(kind,a,b,event={}){
    this.selection=nextCsvSelection(this.selection,kind,a,b,event);const {entries}=this.selection;this.updateSelectionStatus();
    if(entries.size){const row=kind==='column'?Math.max(0,csvRowAtPosition(this.parsed.rowRanges,this._activePosition)):a,col=kind==='cell'?b:kind==='column'?a:0;const at=this.parsed.cellRanges[row]?.[col]?.from??this.parsed.rowRanges[row]?.from;if(at!==undefined){this.setActivePosition(at);this.api.position?.(this.cache?.docId,at);}}
  }
  updateSelectionStatus(){
    if(this.addressOutput)this.addressOutput.textContent=csvSelectionAddress(this.selection,this.parsed?.rowCount||0,this.parsed?.columnCount||0,this.view.columnLabel);
    const s=this.selection;this.selectionLabel&&(this.selectionLabel.textContent=s?.kind==='all'?'すべてのセルを選択':s?.entries.size?`${s.entries.size} ${s.kind==='row'?'行':s.kind==='column'?'列':'セル'}を選択`:'セル・行・列をクリックして選択');const axis=!!s?.entries.size&&(s.kind==='row'||s.kind==='column');if(this.hideButton)this.hideButton.disabled=!axis;if(this.deleteButton)this.deleteButton.disabled=!axis||!this.api.patch;
    for(const cell of this.scroller?.querySelectorAll('[data-grid-row][data-grid-column]')||[]){const row=Number(cell.dataset.gridRow),col=Number(cell.dataset.gridColumn);cell.classList.toggle('csv-selected',!!s&&(s.kind==='all'?true:s.kind==='row'?s.entries.has(row):s.kind==='column'?s.entries.has(col):s.entries.has(`${row}:${col}`)));}
    for(const number of this.scroller?.querySelectorAll('[data-select-row]')||[])number.classList.toggle('csv-selected',s?.kind==='all'||s?.kind==='row'&&s.entries.has(Number(number.dataset.selectRow)));
  }
  styleCell(cell,row,col){const a=csvCellAlignment(this.view,row,col);cell.style.textAlign=a.horizontal;cell.style.verticalAlign=a.vertical==='viewport'?'top':a.vertical;cell.classList.toggle('csv-viewport-align',a.vertical==='viewport');cell.classList.toggle('csv-middle-align',a.vertical==='middle');cell.classList.toggle('csv-bottom-align',a.vertical==='bottom');}
  selectedCsvColumns(){const s=this.selection;if(!s?.entries?.size)return [];if(s.kind==='column')return [...s.entries].sort((a,b)=>a-b);if(s.kind==='cell')return [...new Set([...s.entries].map(k=>Number(k.split(':')[1])))].sort((a,b)=>a-b);return [];}
  csvColumnOptions(select,chosen){for(let column=0;column<this.parsed.columnCount;column++){const heading=this.csvSettings.header?(this.parsed.rows[0]?.[column]||'').replace(/\s+/g,' ').slice(0,50):'';const option=make('option',null,`${csvColumnLabel(column,this.view.columnLabel)}${heading?' · '+heading:''}`);option.value=String(column);select.append(option);}select.value=String(chosen);}
  async openFilterDialog(){
    if(!this.parsed)return;const id=this.cache?.docId,raw=this.raw,old=this.csvSettings.filter,fields={};
    const accepted=await this.gridDialog('列で絞り込み','選んだ列に文字を含む行だけ表示します。絞り込みは保存されず、CSV原文を変更しません。',dialog=>{
      const label=make('label',null,'列'),select=make('select');select.setAttribute('aria-label','絞り込む列');this.csvColumnOptions(select,old?.column??this.selectedCsvColumns()[0]??0);label.append(select);dialog.append(label);fields.column=select;
      const textLabel=make('label',null,'含む文字'),input=make('input');input.type='text';input.setAttribute('aria-label','絞り込む文字');input.value=old?.text||'';textLabel.append(input);dialog.append(textLabel);fields.text=input;
    });
    if(!accepted||id!==this.cache?.docId||raw!==this.raw)return;
    this.csvSettings.filter=fields.text.value?{column:Number(fields.column.value),text:fields.text.value}:null;this.csvSettings.rowPage=0;this.selection=null;this.renderTable();
  }
  async openSortDialog(){
    if(!this.parsed||!this.api.patch||this.api.canEdit?.(this.cache?.docId)===false)return;
    if(this.csvSettings.filter||this.view.hiddenRows.length||this.view.hiddenColumns.length){this.status.textContent='並べ替え・列移動の前に、絞り込みと非表示を解除してください。';return;}
    const id=this.cache?.docId,raw=this.raw,selection=this.selectedCsvColumns(),fields={};
    const accepted=await this.gridDialog('並べ替え・列移動','行全体を列の値で並べ替えるか、選択した連続列を左右に移動します。原文も変更されます（Ctrl+Zで戻せます）。',dialog=>{
      const colLabel=make('label',null,'基準の列'),col=make('select');col.setAttribute('aria-label','並べ替える列');this.csvColumnOptions(col,selection[0]??0);colLabel.append(col);dialog.append(colLabel);fields.column=col;
      const actionLabel=make('label',null,'操作'),action=make('select');action.setAttribute('aria-label','並べ替えの操作');for(const [value,label] of [['asc','列の値で昇順'],['desc','列の値で降順'],['left','選択した列を左へ移動'],['right','選択した列を右へ移動']]){const option=make('option',null,label);option.value=value;action.append(option);}actionLabel.append(action);dialog.append(actionLabel);fields.action=action;
      dialog.append(make('p','muted','列移動は表で選択した連続列に適用します。未選択の場合は基準の列を移動します。移動する範囲が短い行には空欄が追加されます。行・セル単位の表示設定は解除されます。'));
    },'実行');
    if(!accepted||id!==this.cache?.docId||raw!==this.raw)return;
    try{
      const action=fields.action.value,col=Number(fields.column.value),move=action==='left'||action==='right';
      const next=move?moveDelimitedColumns(raw,this.parsed,selection.length?selection:[col],action):sortDelimitedRows(raw,this.parsed,col,{header:this.csvSettings.header,descending:action==='desc'});
      if(next===raw){this.status.textContent='変更はありません。';return;}
      this.raw=next;
      try{if(this.api.patch({docId:id,from:0,to:raw.length,insert:next,kind:'command'})===false)throw Error();}catch(error){this.raw=raw;throw error;}
      this.selection=null;this.view.rowHeights={};this.view.rowAlignment={};this.view.cellAlignment={};if(move){this.view.columnWidths={};this.view.columnAlignment={};}this.publishView();this.renderTable();this.status.textContent+=' · 並べ替えを反映しました（Ctrl+Zで元に戻せます）';
    }catch(error){this.status.textContent=error.message||'並べ替えを反映できませんでした。';}
  }
  hideSelection(){const s=this.selection;if(!s||!['row','column'].includes(s.kind)||!s.entries.size)return;if(this.csvSettings.filter){this.status.textContent='行・列の非表示は、絞り込みを解除してから行ってください。';return;}const key=s.kind==='row'?'hiddenRows':'hiddenColumns';this.view[key]=[...new Set([...this.view[key],...s.entries])];this.selection=null;this.publishView();this.renderTable();}
  async deleteSelection(){
    const s=this.selection;if(!s||!['row','column'].includes(s.kind)||!s.entries.size||!this.parsed||this.api.canEdit?.(this.cache?.docId)===false)return;
    if(this.csvSettings.filter){this.status.textContent='行・列の削除は、絞り込みを解除してから行ってください。';return;}
    const id=this.cache?.docId,raw=this.raw;const ok=await this.gridDialog('選択した行・列を削除',`${s.entries.size} ${s.kind==='row'?'行':'列'}を削除します。CSVの原文も変更します。`,null,'削除');if(!ok||id!==this.cache?.docId||raw!==this.raw)return;
    const next=deleteDelimitedSelection(raw,this.parsed,s.kind,[...s.entries]);if(next===raw)return;this.raw=next;
    try{if(this.api.patch({docId:id,from:0,to:raw.length,insert:next,kind:'command'})===false)throw Error();this.selection=null;this.view=normalizeCsvView();this.publishView();this.renderTable();}catch{this.raw=raw;this.status.textContent='削除を反映できませんでした。';}
  }
  gridDialog(title,message,build,acceptText='適用'){
    if(!this.finishEdit())return Promise.resolve(false);const dialog=make('dialog','csv-settings-dialog');dialog.setAttribute('aria-label',title);dialog.append(make('h2',null,title));if(message)dialog.append(make('p',null,message));if(build)build(dialog);const actions=make('div','text-preview-dialog-actions'),cancel=make('button',null,'キャンセル'),accept=make('button',null,acceptText);cancel.type=accept.type='button';actions.append(cancel,accept);dialog.append(actions);this.container.append(dialog);this.api.dialogOpen?.(true);
    return new Promise(resolve=>{let done=false;const finish=ok=>{if(done)return;done=true;this._cancelDialog=null;this.api.dialogOpen?.(false);resolve(ok);queueMicrotask(()=>dialog.remove());};this._cancelDialog=()=>{if(dialog.open)dialog.close('cancel');finish(false);};cancel.onclick=()=>dialog.close('cancel');accept.onclick=()=>dialog.close('ok');dialog.addEventListener('close',()=>finish(dialog.returnValue==='ok'),{once:true});dialog.showModal();});
  }
  async openGridSettings(){
    const id=this.cache?.docId,s=this.selection,fields={};const chosenRows=s?.kind==='row'?[...s.entries]:s?.kind==='cell'?[...new Set([...s.entries].map(x=>Number(x.split(':')[0])))]:[],chosenCols=s?.kind==='column'?[...s.entries]:s?.kind==='cell'?[...new Set([...s.entries].map(x=>Number(x.split(':')[1])))]:[];
    const selected=s?.kind!=='all'&&s?.entries.size;const a=s?.kind==='cell'?csvCellAlignment(this.view,...[...s.entries][0].split(':').map(Number)):s?.kind==='row'?this.view.rowAlignment[[...s.entries][0]]||this.view.alignment:s?.kind==='column'?this.view.columnAlignment[[...s.entries][0]]||this.view.alignment:this.view.alignment;
    const ok=await this.gridDialog('CSVの表示設定',selected?'選択した範囲のサイズ・配置に適用します。固定範囲は表全体に適用します。':'サイズ・配置の初期値を表全体に適用します。',dialog=>{
      const input=(label,id,value)=>{const l=make('label',null,label),n=make('input');n.type='number';n.id=id;n.value=value;n.min='0';l.append(n);dialog.append(l);fields[id]=n;};
      input('列幅（px）','csv-column-width',chosenCols.length?(this.view.columnWidths[chosenCols[0]]??this.view.defaultColumnWidth):this.view.defaultColumnWidth);input('行の高さ（px、0は自動）','csv-row-height',chosenRows.length?(this.view.rowHeights[chosenRows[0]]??this.view.defaultRowHeight):this.view.defaultRowHeight);input('固定する行数（最大100）','csv-freeze-rows',this.view.freezeRows);input('固定する列数（最大50）','csv-freeze-columns',this.view.freezeColumns);
      const select=(label,id,options,value)=>{const l=make('label',null,label),n=make('select');n.id=id;for(const [v,t] of options){const o=make('option',null,t);o.value=v;n.append(o);}n.value=value;l.append(n);dialog.append(l);fields[id]=n;};select('列番号','csv-column-label',[['letters','アルファベット（A、B、C…）'],['numbers','数字（1、2、3…）']],this.view.columnLabel);select('横位置','csv-horizontal',[['left','左揃え'],['center','中央揃え'],['right','右揃え']],a.horizontal);select('縦位置','csv-vertical',[['top','上揃え'],['middle','中央揃え'],['bottom','下揃え'],['viewport','画面表示に合わせる']],a.vertical);
      select('Enterキーの移動方向','csv-enter-direction',[['down','下'],['up','上'],['right','右'],['left','左'],['none','移動しない']],this.view.enterDirection);
      select('行の背景','csv-striped-rows',[['off','通常'],['on','交互に色を付ける']],this.view.stripedRows?'on':'off');
      const reset=make('button','csv-reset-view','表示設定を初期化');reset.type='button';reset.onclick=()=>{this.setView({});dialog.close('cancel');};dialog.append(reset);
    });if(!ok||id!==this.cache?.docId)return;
    const width=Number(fields['csv-column-width'].value),height=Number(fields['csv-row-height'].value),alignment={horizontal:fields['csv-horizontal'].value,vertical:fields['csv-vertical'].value};
    if(selected){for(const col of chosenCols)this.view.columnWidths[col]=width;for(const row of chosenRows){if(height)this.view.rowHeights[row]=height;else delete this.view.rowHeights[row];}if(s.kind==='cell')for(const cell of s.entries)this.view.cellAlignment[cell]=alignment;else{const target=s.kind==='row'?'rowAlignment':'columnAlignment';for(const index of s.entries)this.view[target][index]=alignment;for(const key of Object.keys(this.view.cellAlignment))if(s.entries.has(Number(key.split(':')[s.kind==='row'?0:1])))delete this.view.cellAlignment[key];}}
    else{this.view.defaultColumnWidth=width;this.view.defaultRowHeight=height;this.view.alignment=alignment;this.view.rowHeights={};this.view.columnWidths={};this.view.rowAlignment={};this.view.columnAlignment={};this.view.cellAlignment={};}
    this.view.columnLabel=fields['csv-column-label'].value;this.view.freezeRows=Number(fields['csv-freeze-rows'].value);this.view.freezeColumns=Number(fields['csv-freeze-columns'].value);this.view.enterDirection=fields['csv-enter-direction'].value;this.view.stripedRows=fields['csv-striped-rows'].value==='on';this.publishView();this.renderTable();
  }
  beginResize(event){
    const handle=event.target.closest('[data-resize-row],[data-resize-column]');if(!handle||event.button!==0||!this.scroller)return;event.preventDefault();event.stopPropagation();if(!this.finishEdit({redraw:false}))return;const column=handle.dataset.resizeColumn!==undefined,index=Number(column?handle.dataset.resizeColumn:handle.dataset.resizeRow),start=column?event.clientX:event.clientY,rect=handle.closest(column?'th':'tr').getBoundingClientRect(),initial=column?rect.width:rect.height;let value=initial;
    const move=e=>{value=Math.max(column?40:20,Math.min(column?4000:5000,Math.round(initial+(column?e.clientX:e.clientY)-start)));if(column){const col=this.scroller.querySelector(`col[data-column-size="${index}"]`);if(col)col.style.width=value+'px';const table=this.scroller.querySelector('table');if(table)table.style.width=[...table.querySelectorAll('col')].reduce((sum,c)=>sum+parseFloat(c.style.width||'0'),0)+'px';}else{const row=this.scroller.querySelector(`tr[data-grid-row="${index}"]`);if(row){row.classList.add('csv-sized-row');row.style.height=value+'px';row.style.setProperty('--csv-row-height',value+'px');}}this.applySticky();};
    const finish=()=>{cleanup();this.view[column?'columnWidths':'rowHeights'][index]=value;this.publishView();this.renderTable();};const cleanup=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',finish);this._resizeCleanup=null;};this._resizeCleanup?.();this._resizeCleanup=cleanup;window.addEventListener('pointermove',move);window.addEventListener('pointerup',finish,{once:true});window.addEventListener('pointercancel',finish,{once:true});
  }
  applySticky(){
    if(!this.scroller)return;const table=this.scroller.querySelector('table');if(!table)return;const header=table.querySelector('thead'),headHeight=header?.getBoundingClientRect().height||0;table.style.setProperty('--csv-sticky-top',headHeight+'px');let top=headHeight;
    for(const row of table.querySelectorAll('tbody tr')){const frozen=Number(row.dataset.gridRow)<this.view.freezeRows;for(const cell of row.children){cell.classList.toggle('csv-frozen-row',frozen);if(frozen)cell.style.top=top+'px';else cell.style.removeProperty('top');}if(frozen)top+=row.getBoundingClientRect().height;}
    table.style.setProperty('--csv-sticky-top',top+'px');
    let left=44;const columns=[...table.querySelectorAll('col[data-column-size]')];for(const col of columns){const index=Number(col.dataset.columnSize),frozen=index<this.view.freezeColumns;for(const cell of table.querySelectorAll(`[data-grid-column="${index}"]`)){cell.classList.toggle('csv-frozen-column',frozen);if(frozen)cell.style.left=left+'px';else cell.style.removeProperty('left');}if(frozen)left+=parseFloat(col.style.width);}
  }
  offerLargePreview(error){
    this.showError(error,this.scroller);
    const button=make('button','text-preview-large-button','大きな表の表示を選択');button.type='button';this.scroller.append(button);
    const show=()=>{
      if(this.container.querySelector('.text-preview-large-dialog'))return;
      const dialog=make('dialog','text-preview-large-dialog');dialog.setAttribute('aria-label','大きな表のプレビュー');
      dialog.append(make('h2',null,'大きな表を表示しますか？'),make('p',null,'このCSVは大きいため、解析に時間がかかったり、メモリを多く使う場合があります。表はページに分けて表示します。原文はそのまま編集できます。'));
      const actions=make('div','text-preview-dialog-actions'),cancel=make('button',null,'表示しない'),accept=make('button',null,'表示する');cancel.type=accept.type='button';actions.append(cancel,accept);dialog.append(actions);this.container.append(dialog);
      cancel.addEventListener('click',()=>dialog.close());accept.addEventListener('click',()=>{this.csvSettings.allowLarge=true;dialog.close();this.renderTable();});dialog.addEventListener('close',()=>dialog.remove());
      try{dialog.showModal();}catch{dialog.setAttribute('open','');}
    };
    button.addEventListener('click',show);
    if(!this.csvSettings.warningShown){this.csvSettings.warningShown=true;show();}
  }
  moveAfterEnter(row,column,edit){
    if(!this.parsed)return;
    const direction=this.view.enterDirection,delta={down:[1,0],up:[-1,0],right:[0,1],left:[0,-1],none:[0,0]}[direction]||[1,0];
    let nextRow=row+delta[0],nextColumn=column+delta[1];
    while((delta[0]||delta[1])&&nextRow>=0&&nextRow<this.parsed.rowCount&&nextColumn>=0&&nextColumn<this.parsed.columnCount&&(this.view.hiddenRows.includes(nextRow)||this._filterHiddenRows?.has(nextRow)||this.view.hiddenColumns.includes(nextColumn))){nextRow+=delta[0];nextColumn+=delta[1];}
    if(nextRow<0||nextRow>=this.parsed.rowCount||nextColumn<0||nextColumn>=this.parsed.columnCount){nextRow=row;nextColumn=column;edit=false;}
    if(direction==='none')edit=false;
    let target=this.scroller?.querySelector(`[data-cell-row="${nextRow}"][data-cell-column="${nextColumn}"]`);
    if(!target&&this.csvSettings.allowLarge){
      const rows=this._scrollLayout?.scrollingRows||[],columns=Array.from({length:this.parsed.columnCount},(_,i)=>i).filter(i=>!this.view.hiddenColumns.includes(i)&&i>=this.view.freezeColumns),rowAt=rows.indexOf(nextRow),colAt=columns.indexOf(nextColumn);
      if(rowAt>=0)this.csvSettings.rowPage=Math.floor(rowAt/CSV_PAGE_ROWS);if(colAt>=0)this.csvSettings.columnPage=Math.floor(colAt/CSV_PAGE_COLUMNS);
      this.renderTable();target=this.scroller?.querySelector(`[data-cell-row="${nextRow}"][data-cell-column="${nextColumn}"]`);
    }
    if(!target)return;
    this.selectRange('cell',nextRow,nextColumn);
    if(edit)this.startEdit(nextRow,nextColumn);else target.focus();
  }
  startEdit(rowIndex,columnIndex){
    if(!['csv','tsv'].includes(this.kind)||typeof this.api.patch!=='function'||!this.parsed)return false;
    const docId=this.cache?.docId;if(this.api.canEdit?.(docId)===false){if(this.status)this.status.textContent='別のウィンドウでの編集を終えてから、このセルを編集してください。';return false;}
    if(this._editing&&!this.finishEdit())return false;
    let cell=this.scroller?.querySelector(`[data-cell-row="${rowIndex}"][data-cell-column="${columnIndex}"]`);const values=this.parsed.rows[rowIndex];
    if(!cell&&values&&this.csvSettings.allowLarge){const headerRows=this.csvSettings.header?1:0;this.csvSettings.rowPage=Math.floor(Math.max(0,rowIndex-headerRows)/CSV_PAGE_ROWS);this.csvSettings.columnPage=Math.floor(columnIndex/CSV_PAGE_COLUMNS);this.renderTable();cell=this.scroller?.querySelector(`[data-cell-row="${rowIndex}"][data-cell-column="${columnIndex}"]`);}
    if(!cell||!values)return false;
    const range=this.parsed.cellRanges[rowIndex][columnIndex],from=range?.from??this.parsed.rowRanges[rowIndex].to,to=range?.to??from;
    const prefix=range?'':this.parsed.delimiter.repeat(columnIndex-values.length+1),originalValue=values[columnIndex]??'',input=make('textarea','text-preview-cell-input');
    input.value=originalValue;input.spellcheck=false;input.setAttribute('aria-label',`${rowIndex+1}行 ${columnIndex+1}列の値`);
    const field={docId,rowIndex,columnIndex,from,currentTo:to,originalToken:this.raw.slice(from,to),originalValue,lastValue:input.value,quoted:range?.quoted||false,prefix,delimiter:this.parsed.delimiter,eol:originalValue.match(/\r\n|\r|\n/)?.[0]||this.raw.match(/\r\n|\r|\n/)?.[0]||'\n',input,composing:false};
    this._editing=field;cell.classList.add('text-preview-editing-cell');cell.replaceChildren(input);this.setActivePosition(from);this.api.position?.(docId,from);this.api.editing?.(docId,true);
    const change=()=>{if(this._editing===field&&!field.composing)this.applyCellInput(field);};
    input.addEventListener('input',change);
    input.addEventListener('compositionstart',()=>{if(this._editing!==field)return;field.composing=true;this.api.composing?.(docId,true);});
    input.addEventListener('compositionend',()=>{if(this._editing!==field)return;field.composing=false;this.api.composing?.(docId,false);change();if(field.pendingFinish)this.finishEdit();});
    input.addEventListener('blur',()=>{if(this._editing===field)this.finishEdit();});
    input.addEventListener('keydown',event=>{
      if(event.isComposing||field.composing)return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.finishEdit({cancel:true});return;}
      if(event.key==='Tab'||event.key==='Enter'&&!event.shiftKey){
        event.preventDefault();event.stopPropagation();const direction=event.shiftKey?-1:1;
        let nextRow=rowIndex,nextColumn=columnIndex;
        if(event.key==='Tab'){nextColumn+=direction;if(nextColumn>=this.parsed.columnCount){nextColumn=0;nextRow++;}else if(nextColumn<0){nextColumn=this.parsed.columnCount-1;nextRow--;}}
        if(this.finishEdit()){if(event.key==='Enter')this.moveAfterEnter(rowIndex,columnIndex,true);else if(nextRow>=0&&nextRow<this.parsed.rowCount)this.startEdit(nextRow,nextColumn);else this.scroller?.querySelector(`[data-cell-row="${rowIndex}"][data-cell-column="${columnIndex}"]`)?.focus();}
      }
    });
    input.focus();input.setSelectionRange(input.value.length,input.value.length);return true;
  }
  emitCellToken(field,insert){
    const before=this.raw,oldTo=field.currentTo,oldToken=before.slice(field.from,oldTo);if(oldToken===insert)return true;
    const next=before.slice(0,field.from)+insert+before.slice(oldTo);
    this.raw=next;field.currentTo=field.from+insert.length;
    try{if(this.api.patch({docId:field.docId,from:field.from,to:oldTo,insert})===false)throw new Error('patch rejected');return true;}
    catch{this.raw=before;field.currentTo=oldTo;if(this.status)this.status.textContent='セルの入力を反映できませんでした。原文を確認してください。';return false;}
  }
  applyCellInput(field){
    const value=field.input.value;if(value===field.lastValue)return true;
    const content=value.replaceAll('\n',field.eol);
    if(!this.emitCellToken(field,field.prefix+encodeDelimitedCell(content,field.delimiter,field.quoted)))return false;
    field.lastValue=value;return true;
  }
  finishEdit({cancel=false,redraw=true,force=false}={}){
    const field=this._editing;if(!field)return true;
    if(field.composing&&!force){field.pendingFinish=true;return false;}
    this._editing=null;
    if(field.composing){field.composing=false;this.api.composing?.(field.docId,false);}
    const applied=cancel?this.emitCellToken(field,field.originalToken):this.applyCellInput(field);
    if(!applied&&!force){this._editing=field;return false;}
    this.api.editing?.(field.docId,false);
    if(redraw&&['csv','tsv'].includes(this.kind)&&this.scroller)this.renderTable();return true;
  }
}
