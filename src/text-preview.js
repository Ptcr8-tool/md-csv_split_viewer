import {currentUiLanguage} from './i18n.js';
const tr=(ja,en)=>currentUiLanguage()==='en'?en:ja;
const localizeGridToolbar=toolbar=>{
  if(currentUiLanguage()!=='en')return;
  const labels={'表示設定':'View settings','選択を非表示':'Hide selection','行・列を削除':'Delete rows or columns','非表示をすべて解除':'Show all hidden rows and columns','並べ替え・列移動':'Sort or move columns','絞り込み':'Filter','絞り込み解除':'Clear filter','表示設定を保存':'Save view settings','表示設定を読込':'Load view settings'};
  for(const button of toolbar.querySelectorAll('button')){
    const old=button.getAttribute('aria-label')||button.textContent.trim(),text=labels[old];if(!text)continue;
    if(button.hasAttribute('aria-label'))button.setAttribute('aria-label',text);
    if(button.title)button.title=text;
    if(!button.querySelector('svg'))button.textContent=text;
  }
};
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
    container.addEventListener('pointerdown',event=>{if(!this.commitHeaderSelection(event)){this.beginResize(event);this.beginCellSelection(event);}});
    container.addEventListener('dblclick',event=>{const cell=event.target.closest?.('[data-cell-row][data-cell-column]');if(cell&&!event.target.closest('textarea')){event.preventDefault();this.startEdit(Number(cell.dataset.cellRow),Number(cell.dataset.cellColumn));}});
    container.addEventListener('keydown',event=>{
      if(event.target.closest?.('textarea,input,select,dialog,[contenteditable="true"]'))return;
      const key=event.key.toLowerCase(),inGrid=event.target.closest?.('.text-preview-scroll');
      if((event.ctrlKey||event.metaKey)&&!event.getModifierState?.('AltGraph')&&inGrid&&this.parsed){
        if(key==='a'){event.preventDefault();event.stopPropagation();this.selectAll();return;}
        if((key==='z'||key==='y')&&this.api.history){
          event.preventDefault();event.stopPropagation();this.api.history(key==='y'||event.shiftKey);
          const selected=this.selection;
          const entry=selected?.kind==='cell'&&selected.entries.size===1?[...selected.entries][0]:null;
          const [row,column]=entry?entry.split(':').map(Number):[];
          const target=entry?this.scroller?.querySelector(`[data-cell-row="${row}"][data-cell-column="${column}"]`):null;
          (target||this.scroller)?.focus({preventScroll:true});return;
        }
      }
      const cell=event.target.closest?.('[data-cell-row][data-cell-column]');
      if(!cell)return;
      const row=Number(cell.dataset.cellRow),column=Number(cell.dataset.cellColumn);
      const arrow={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1]}[event.key];
      if(arrow&&!event.isComposing&&!event.ctrlKey&&!event.altKey&&!event.metaKey){
        event.preventDefault();event.stopPropagation();
        this.moveByArrow(row,column,arrow[0],arrow[1],event.shiftKey);return;
      }
      if(event.key==='F2'){event.preventDefault();this.startEdit(row,column);return;}
      if(event.key==='Enter'&&!event.shiftKey&&!event.ctrlKey&&!event.altKey&&!event.metaKey){event.preventDefault();event.stopPropagation();this.moveAfterEnter(row,column,false);return;}
      const selection=this.selection;
      if(selection?.kind==='cell'&&selection.entries.size>1&&(event.key==='Delete'||event.key==='Backspace')&&!event.ctrlKey&&!event.altKey&&!event.metaKey){
        event.preventDefault();event.stopPropagation();this.clearSelectedCells(row,column);return;
      }
      if(selection?.kind!=='cell'||selection.entries.size!==1||!selection.entries.has(`${row}:${column}`))return;
      const altGraph=event.getModifierState?.('AltGraph');
      if(event.metaKey||((event.ctrlKey||event.altKey)&&!altGraph))return;
      if(event.key==='Delete'||event.key==='Backspace'){
        event.preventDefault();event.stopPropagation();
        if(!this.startEdit(row,column))return;
        const field=this._editing;field.input.value='';
        if(!this.applyCellInput(field))return;
        if(this.finishEdit())this.scroller?.querySelector(`[data-cell-row="${row}"][data-cell-column="${column}"]`)?.focus({preventScroll:true});
        return;
      }
      // Let the IME initiate composition in the newly focused editor. Selecting
      // the previous value makes the first committed input replace the cell.
      if(event.key==='Process'||event.key==='Dead'||event.keyCode===229||event.isComposing){
        if(this.startEdit(row,column))this._editing.input.select();
        return;
      }
      if(event.key.length===1){
        event.preventDefault();event.stopPropagation();
        if(!this.startEdit(row,column))return;
        const field=this._editing;field.input.value=event.key;
        field.input.setSelectionRange(field.input.value.length,field.input.value.length);
        this.applyCellInput(field);
      }
    });
  }
  get visible(){return this._visible;}
  get editing(){return this._editing||null;}
  get hasEditor(){return !!this._editing;}
  clear(){this._cellDragCleanup?.();this._cancelDialog?.();this._layoutShape=null;this.finishEdit({redraw:false,force:true});this.container.replaceChildren();this.container.hidden=true;this.container.classList.remove('text-preview');if(this.originalEditable===null)this.container.removeAttribute('contenteditable');else this.container.setAttribute('contenteditable',this.originalEditable);this._visible=false;this._activePosition=null;this._scrollLayout=null;this.raw=null;this.kind=null;this.cache=null;this.options=null;this.csvSettings=null;this.parsed=null;this._parsedRaw=null;this.scroller=null;this.status=null;this.pagination=null;this.view=normalizeCsvView();this.selection=null;this._resizeCleanup?.();this._resizeCleanup=null;}
  render(raw,kind,options={}){
    if(!['html','csv','tsv'].includes(kind)){this.clear();return false;}
    const cache={docId:options.docId??options.documentId??null,fontSize:options.fontSize??14,delimiter:options.delimiter??null,header:options.header??null,language:currentUiLanguage(),view:JSON.stringify(normalizeCsvView(options.csvView??(this.cache?.docId===(options.docId??options.documentId??null)?this.view:{})))};
    if(this._editing&&this.kind===kind&&this.cache?.docId===cache.docId){this.raw=raw;cache.language=this.cache.language;this.cache=cache;this.options=options;this.view=normalizeCsvView(options.csvView??this.view);return true;}
    if(this._editing)this.finishEdit({redraw:false,force:true});
    if(this.raw===raw&&this.kind===kind&&this.cache&&Object.keys(cache).every(key=>this.cache[key]===cache[key]))return true;
    const sameDocument=this.kind===kind&&this.cache?.docId===cache.docId;
    if(!sameDocument)this._cellDragCleanup?.();
    const previousHtmlFrame=sameDocument&&kind==='html'?this.container.querySelector('iframe.text-preview-html'):null;
    this.view=normalizeCsvView(options.csvView??(sameDocument?this.view:{}));if(!sameDocument){this.selection=null;this._layoutShape=null;this._pasteShapes=null;this._activePosition=null;this._scrollLayout=null;}this._cancelDialog?.();this.raw=raw;this.kind=kind;this.cache=cache;this.options=options;this._visible=true;this.container.hidden=false;this.container.classList.add('text-preview');this.container.contentEditable='false';
    // Keep the already approved large preview attached while the user edits;
    // replacing the iframe on every keystroke would reload the large document.
    if(previousHtmlFrame&&raw.length>HTML_PREVIEW_MANUAL_THRESHOLD){for(const child of [...this.container.children])if(child!==previousHtmlFrame)child.remove();}else this.container.replaceChildren();
    this.parsed=null;this.scroller=null;this.status=null;this.addressOutput=null;
    if(kind==='html'){
      const status=make('p','text-preview-status',tr('HTMLプレビュー（読み取り専用） · スクリプト・外部画像・リンク・外部通信は無効です。','HTML preview (read only) · Scripts, external images, links and network access are disabled.'));
      this.container.insertBefore(status,previousHtmlFrame?.isConnected?previousHtmlFrame:null);
      const makeFrame=()=>{const frame=make('iframe','text-preview-html');frame.title=tr('HTMLプレビュー（読み取り専用）','HTML preview (read only)');frame.setAttribute('sandbox','');frame.setAttribute('allow','');frame.referrerPolicy='no-referrer';return frame;};
      if(raw.length>HTML_PREVIEW_MANUAL_THRESHOLD){
        status.textContent=tr('大きなHTMLです。プレビューの作成には時間やメモリが必要になる場合があります。原文はそのまま編集できます。','This HTML file is large. Generating a preview may take time and memory. You can still edit the source.');
        const button=make('button','text-preview-large-button',previousHtmlFrame?tr('プレビューを更新','Update preview'):tr('プレビューを表示','Show preview'));button.type='button';this.container.insertBefore(button,previousHtmlFrame?.isConnected?previousHtmlFrame:null);
        button.addEventListener('click',()=>{button.disabled=true;status.textContent=tr('HTMLプレビューを作成しています。','Generating HTML preview…');this.container.querySelector('.text-preview-error')?.remove();
          setTimeout(()=>{if(!button.isConnected)return;try{const content=buildHtmlPreview(raw,options);if(!button.isConnected)return;const frame=this.container.querySelector('iframe.text-preview-html')||makeFrame();frame.srcdoc=content;if(!frame.isConnected)this.container.append(frame);status.textContent=tr('HTMLプレビュー（読み取り専用） · 編集後は「プレビューを更新」で反映します。スクリプト・外部通信は無効です。','HTML preview (read only) · Select Update preview to apply edits. Scripts and external communication are disabled.');button.textContent=tr('プレビューを更新','Update preview');button.disabled=false;}catch(error){if(button.isConnected){status.textContent=tr('HTMLプレビューを作成できませんでした。原文はそのまま編集できます。','Could not generate HTML preview. You can still edit the source.');this.showError(error);button.disabled=false;}}},0);
        });
      }else{
        try{const frame=makeFrame();frame.srcdoc=buildHtmlPreview(raw,options);this.container.append(frame);}catch(error){this.showError(error);}
      }
      return true;
    }
    this.csvSettings=sameDocument&&this.csvSettings?this.csvSettings:{delimiter:'auto',header:true,allowLarge:false,warningShown:false,rowPage:0,columnPage:0,filter:null};
    if(options.delimiter!==undefined)this.csvSettings.delimiter=Object.hasOwn(delimiters,options.delimiter)?options.delimiter:Object.entries(delimiters).find(([,value])=>value===options.delimiter)?.[0]||'auto';
    if(options.header!==undefined)this.csvSettings.header=options.header!==false;
    const toolbar=make('div','text-preview-toolbar'),label=make('label',null,tr('区切り文字 ','Delimiter ')),select=make('select');select.setAttribute('aria-label',tr('区切り文字','Delimiter'));
    for(const [value,text] of [['auto',tr('ファイルに合わせる','Match file')],['comma',tr('カンマ ,','Comma ,')],['tab','Tab'],['semicolon',tr('セミコロン ;','Semicolon ;')]]){const option=make('option',null,text);option.value=value;select.append(option);}select.value=this.csvSettings.delimiter;label.append(select);toolbar.append(label);
    const headerLabel=make('label','text-preview-header-choice'),header=make('input');header.type='checkbox';header.checked=this.csvSettings.header;headerLabel.append(header,document.createTextNode(tr('先頭行を見出しにする','Use first row as header')));toolbar.append(headerLabel);this.buildGridToolbar(toolbar);applyCsvToolbarIcons(toolbar);localizeGridToolbar(toolbar);this.container.append(toolbar);
    this.pagination=make('div','text-preview-pagination');this.container.append(this.pagination);
    this.status=make('p','text-preview-status');this.status.setAttribute('role','status');this.container.append(this.status);this.scroller=make('div','text-preview-scroll');this.scroller.tabIndex=0;this.container.append(this.scroller);const {footer,output}=createCsvSelectionFooter();this.addressOutput=output;this.container.append(footer);
    select.addEventListener('change',()=>{this.csvSettings.delimiter=select.value;this.renderTable();});header.addEventListener('change',()=>{this.csvSettings.header=header.checked;this.renderTable();});this.renderTable();return true;
  }
  showError(error,target=this.container){const message=make('p','text-preview-error',error instanceof Error?error.message:tr('プレビューを表示できませんでした。','Could not display the preview.'));message.setAttribute('role','status');target.append(message);}
  renderTable(){
    const wrapToggle=this.container.querySelector('input[data-csv-wrap]');if(wrapToggle)wrapToggle.checked=this.view.wrap;
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
      this.status.textContent=tr(`${result.rowCount.toLocaleString()}行 · 最大${result.columnCount.toLocaleString()}列${editable?' · セルを選んで入力・ダブルクリックで編集 · Ctrl+Cでコピー · Ctrl+Vで貼り付け':'（読み取り専用）'}`,`${result.rowCount.toLocaleString()} rows · up to ${result.columnCount.toLocaleString()} columns${editable?' · Select a cell and type or double-click to edit · Ctrl+C to copy · Ctrl+V to paste':' (read only)'}`);
      if(!result.rows.length){this.pagination.replaceChildren();this.pagination.hidden=true;this.scroller.append(make('p','text-preview-empty',tr('内容がありません。','No content.')));this.updateSelectionStatus();return;}
      const large=this.csvSettings.allowLarge&&(result.rowCount>1000||result.columnCount>100||result.rowCount*result.columnCount>20000);
      this._filterHiddenRows=filteredCsvRows(result,this.csvSettings.filter,this.csvSettings.header);
      if(this.csvSettings.filter)this.status.textContent+=tr(` · 絞り込み中（${result.rowCount-this._filterHiddenRows.size}行表示）`,` · filtered (${result.rowCount-this._filterHiddenRows.size} rows shown)`);
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
        add(tr('前の行','Previous rows'),this.csvSettings.rowPage===0,()=>{this.csvSettings.rowPage--;this.renderTable();},'row');this.pagination.append(make('span',null,tr(`行ページ ${this.csvSettings.rowPage+1} / ${rowPages}`,`Row page ${this.csvSettings.rowPage+1} / ${rowPages}`)));add(tr('次の行','Next rows'),this.csvSettings.rowPage>=rowPages-1,()=>{this.csvSettings.rowPage++;this.renderTable();},'row');
        add(tr('前の列','Previous columns'),this.csvSettings.columnPage===0,()=>{this.csvSettings.columnPage--;this.renderTable();},'column');this.pagination.append(make('span',null,tr(`列ページ ${this.csvSettings.columnPage+1} / ${colPages}`,`Column page ${this.csvSettings.columnPage+1} / ${colPages}`)));add(tr('次の列','Next columns'),this.csvSettings.columnPage>=colPages-1,()=>{this.csvSettings.columnPage++;this.renderTable();},'column');
      }
      const table=make('table','text-preview-table'),head=make('thead'),body=make('tbody'),group=make('colgroup');table.setAttribute('aria-label',this.kind==='tsv'?tr('TSVプレビュー','TSV preview'):tr('CSVプレビュー','CSV preview'));table.classList.toggle('csv-no-wrap',!this.view.wrap);table.classList.toggle('csv-striped',this.view.stripedRows);
      const numberCol=make('col');numberCol.style.width='44px';group.append(numberCol);let width=44;
      for(const column of columns){const col=make('col');col.dataset.columnSize=column;const w=this.view.columnWidths[column]??this.view.defaultColumnWidth;col.style.width=w+'px';width+=w;group.append(col);}table.style.width=width+'px';table.append(group);
      const numberedRow=(values,index,isHeader)=>{
        const row=make('tr');row.dataset.sourceFrom=String(result.rowRanges[index].from);row.dataset.sourceTo=String(result.rowRanges[index].to);row.dataset.gridRow=index;
        const number=make('th','text-preview-row-number'),choose=make('button','csv-row-select',String(index+1));number.scope='row';if(isHeader)number.append(this.selectAllButton());choose.type='button';choose.dataset.selectRow=index;choose.setAttribute('aria-label',tr(`${index+1}行を選択`,`Select row ${index+1}`));number.append(choose);const resize=make('span','csv-row-resize');resize.dataset.resizeRow=index;resize.title=tr('ドラッグして行の高さを変更','Drag to resize row height');number.append(resize);row.append(number);
        const height=this.view.rowHeights[index]??this.view.defaultRowHeight;if(height){row.style.height=height+'px';row.style.setProperty('--csv-row-height',height+'px');row.classList.add('csv-sized-row');}
        for(const column of columns){const cell=make(isHeader?'th':'td'),content=make('div','csv-cell-content',values[column]??'');cell.dataset.gridColumn=column;cell.dataset.gridRow=index;if(isHeader)cell.append(make('div','csv-column-label',csvColumnLabel(column,this.view.columnLabel)));cell.append(content);if(isHeader){cell.scope='col';cell.dataset.selectColumn=column;cell.title=tr('クリックで列選択 · Ctrlで追加 · Shiftで範囲','Click to select a column · Ctrl to add · Shift for range');const resize=make('span','csv-column-resize');resize.dataset.resizeColumn=column;resize.title=tr('ドラッグして列幅を変更','Drag to resize column width');cell.append(resize);}if(editable){cell.dataset.cellRow=String(index);cell.dataset.cellColumn=String(column);cell.classList.add('text-preview-editable-cell');cell.tabIndex=0;cell.setAttribute('aria-label',tr(`${index+1}行 ${column+1}列を編集`,`Edit row ${index+1} column ${column+1}`));}this.styleCell(cell,index,column);row.append(cell);}return row;
      };
      if(this.csvSettings.header&&!hiddenRows.has(0))head.append(numberedRow(result.rows[0],0,true));else{const row=make('tr'),corner=make('th','text-preview-row-number');corner.append(this.selectAllButton());row.append(corner);for(const column of columns){const cell=make('th','csv-column-label',csvColumnLabel(column,this.view.columnLabel));cell.dataset.selectColumn=column;cell.dataset.gridColumn=column;const resize=make('span','csv-column-resize');resize.dataset.resizeColumn=column;cell.append(resize);row.append(cell);}head.append(row);}
      for(const index of visibleRows)body.append(numberedRow(result.rows[index],index,false));table.append(head,body);this.scroller.append(table);this.updateSelectionStatus();this.setActivePosition(this._activePosition);this.applySticky();
      requestAnimationFrame(()=>{if(table.isConnected)this.applySticky();});
    }catch(error){this.parsed=null;this.pagination.replaceChildren();this.pagination.hidden=true;this.status.textContent=tr('表のプレビューを表示できません。原文の編集は続けられます。','Could not display the table preview. You can continue editing the source.');if(error instanceof DelimitedPreviewError&&error.code==='limit')this.offerLargePreview(error);else this.showError(error,this.scroller);}
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
  selectAllButton(){const button=make('button','csv-select-all','▦');button.type='button';button.dataset.selectAll='';button.setAttribute('aria-label',tr('表全体を選択','Select entire table'));button.title=tr('表全体を選択（Ctrl+A）','Select entire table (Ctrl+A)');return button;}
  getView(){return normalizeCsvView(this.view);}
  setView(view,docId=this.cache?.docId){if(docId!==this.cache?.docId||!this.finishEdit())return false;this.view=normalizeCsvView(view);this.selection=null;this.publishView();if(this.scroller&&['csv','tsv'].includes(this.kind))this.renderTable();return true;}
  publishView(){this.view=normalizeCsvView(this.view);if(this.cache)this.cache.view=JSON.stringify(this.view);this.api.viewChanged?.(this.cache?.docId,this.getView());}
  buildGridToolbar(toolbar){
    const wrapLabel=make('label'),wrap=make('input');wrap.type='checkbox';wrap.dataset.csvWrap='';wrap.checked=this.view.wrap;wrap.setAttribute('aria-label',tr('セル内で折り返す','Wrap text in cells'));wrapLabel.append(wrap,document.createTextNode(tr('折り返す','Wrap text')));wrap.addEventListener('change',()=>{this.view.wrap=wrap.checked;this.publishView();this.renderTable();});toolbar.append(wrapLabel);
    const button=(text,action)=>{const b=make('button',null,text);b.type='button';b.addEventListener('click',action);toolbar.append(b);return b;};
    button('表示設定',()=>this.openGridSettings());this.hideButton=button('選択を非表示',()=>this.hideSelection());this.deleteButton=button('行・列を削除',()=>this.deleteSelection());button('非表示をすべて解除',()=>{this.view.hiddenRows=[];this.view.hiddenColumns=[];this.publishView();this.renderTable();});
    button('並べ替え・列移動',()=>this.openSortDialog());button('絞り込み',()=>this.openFilterDialog());button('絞り込み解除',()=>{this.csvSettings.filter=null;this.csvSettings.rowPage=0;this.selection=null;this.renderTable();});
    if(this.api.saveView)button('表示設定を保存',async()=>{const id=this.cache?.docId;try{await this.api.saveView(id,this.getView());}catch(e){if(id===this.cache?.docId)this.status.textContent=e.message||tr('表示設定を保存できませんでした。','Could not save view settings.');}});
    if(this.api.loadView)button('表示設定を読込',async()=>{const id=this.cache?.docId;try{const v=await this.api.loadView(id);if(v&&id===this.cache?.docId)this.setView(v,id);}catch(e){if(id===this.cache?.docId)this.status.textContent=e.message||tr('表示設定を読み込めませんでした。','Could not load view settings.');}});
    this.selectionLabel=make('span','csv-selection-status',tr('セル・行・列をクリックして選択','Click a cell, row, or column to select'));toolbar.append(this.selectionLabel);
  }
  commitHeaderSelection(event){
    if(!this._editing||event.button!==0||event.target.closest('dialog,[data-resize-row],[data-resize-column]'))return false;
    const all=event.target.closest('[data-select-all]'),row=event.target.closest('[data-select-row]')||event.target.closest('.text-preview-row-number')?.querySelector('[data-select-row]'),column=event.target.closest('[data-select-column]');if(!all&&!row&&!column)return false;if(all){event.preventDefault();event.stopPropagation();if(this.finishEdit()){this.selectAll();this.scroller?.querySelector('[data-select-all]')?.focus({preventScroll:true});}return true;}
    const kind=row?'row':'column',index=Number(row?row.dataset.selectRow:column.dataset.selectColumn);event.preventDefault();event.stopPropagation();
    if(this.finishEdit()){this.selectRange(kind,index,null,event);const target=this.scroller?.querySelector(row?`[data-select-row="${index}"]`:`[data-select-column="${index}"]`);if(target?.tabIndex>=0)target.focus({preventScroll:true});else this.scroller?.focus({preventScroll:true});}return true;
  }
  selectFromEvent(event){
    if(this._suppressSelectionClick){this._suppressSelectionClick=false;return;}
    if(!this.parsed||event.target.closest('textarea,dialog,[data-resize-row],[data-resize-column]'))return;
    const all=event.target.closest('[data-select-all]'),row=event.target.closest('[data-select-row]')||event.target.closest('.text-preview-row-number')?.querySelector('[data-select-row]'),column=event.target.closest('[data-select-column]'),cell=event.target.closest('[data-cell-row][data-cell-column]');
    if(all){this.selectAll();all.focus({preventScroll:true});}else if(row){this.selectRange('row',Number(row.dataset.selectRow),null,event);row.focus({preventScroll:true});}else if(column){this.selectRange('column',Number(column.dataset.selectColumn),null,event);if(!column.hasAttribute('tabindex'))this.scroller?.focus({preventScroll:true});else column.focus({preventScroll:true});}else if(cell){this.selectRange('cell',Number(cell.dataset.cellRow),Number(cell.dataset.cellColumn),event);cell.focus({preventScroll:true});}
  }
  selectAll(){if(!this.parsed?.rowCount||!this.parsed?.columnCount)return;this.selection={kind:'all',entries:new Set(['all']),anchor:[0,0]};this.updateSelectionStatus();}
  beginCellSelection(event){
    if(event.button!==0||!this.parsed||!this.scroller||event.target.closest('textarea,input,select,dialog,[contenteditable="true"],[data-resize-row],[data-resize-column],[data-select-column],[data-select-row]'))return;
    let start=event.target.closest('[data-cell-row][data-cell-column]');
    if(!start||!this.scroller.contains(start))return;
    // The grid owns dragging; the editor textarea still uses normal text selection.
    event.preventDefault();
    const row=Number(start.dataset.cellRow),col=Number(start.dataset.cellColumn),docId=this.cache?.docId;
    // Committing an active editor rebuilds the grid, so the original target
    // is detached. Continue selection with the corresponding live cell.
    const committedEditor=!!this._editing;
    if(committedEditor){
      if(!this.finishEdit())return;
      start=this.scroller?.querySelector(`[data-cell-row="${row}"][data-cell-column="${col}"]`);
      if(!start)return;
    }
    const old=this.selection,add=event.ctrlKey||event.metaKey;
    const anchor=event.shiftKey&&old?.kind==='cell'?old.anchor:[row,col];
    const base={kind:'cell',anchor,entries:add&&old?.kind==='cell'?new Set(old.entries):new Set()};
    let dragged=false,frame=0,lastTime=0,point=null;
    const selectAt=(x,y)=>{
      const target=document.elementFromPoint(x,y)?.closest('[data-cell-row][data-cell-column]');
      if(!target||!this.scroller.contains(target))return;
      const r=Number(target.dataset.cellRow),c=Number(target.dataset.cellColumn);
      if(!dragged&&r===row&&c===col)return;
      dragged=true;
      this.selection=nextCsvSelection(base,'cell',r,c,{shiftKey:true,ctrlKey:add});
      this.updateSelectionStatus();
    };
    const edgeSpeed=(value,min,max)=>{
      const edge=32,maxSpeed=22;
      if(value<min+edge)return -maxSpeed*Math.min(1,(min+edge-value)/edge);
      if(value>max-edge)return maxSpeed*Math.min(1,(value-(max-edge))/edge);
      return 0;
    };
    const scrollFrame=time=>{
      frame=0;
      if(!point||this.cache?.docId!==docId||!this.scroller?.isConnected)return;
      const bounds=this.scroller.getBoundingClientRect(),leftEdge=bounds.left+this.scroller.clientLeft,topEdge=bounds.top+this.scroller.clientTop;
      const rect={left:leftEdge,top:topEdge,right:leftEdge+this.scroller.clientWidth,bottom:topEdge+this.scroller.clientHeight,width:this.scroller.clientWidth,height:this.scroller.clientHeight};
      if(rect.width<2||rect.height<2)return;
      const step=lastTime?Math.min(2,(time-lastTime)/(1000/60)):1;lastTime=time;
      const oldX=this.scroller.scrollLeft,oldY=this.scroller.scrollTop;
      this.scroller.scrollBy(edgeSpeed(point.x,rect.left,rect.right)*step,edgeSpeed(point.y,rect.top,rect.bottom)*step);
      if(oldX!==this.scroller.scrollLeft||oldY!==this.scroller.scrollTop){
        const head=this.scroller.querySelector('thead th')?.getBoundingClientRect();
        const rowHead=this.scroller.querySelector('.text-preview-row-number')?.getBoundingClientRect();
        const left=Math.min(rect.right-1,Math.max(rect.left+1,rowHead?.right??rect.left+1));
        const top=Math.min(rect.bottom-1,Math.max(rect.top+1,head?.bottom??rect.top+1));
        selectAt(Math.min(rect.right-1,Math.max(left,point.x)),Math.min(rect.bottom-1,Math.max(top,point.y)));
      }
      frame=requestAnimationFrame(scrollFrame);
    };
    const move=e=>{
      if(e.pointerId!==event.pointerId||this.cache?.docId!==docId||!this.scroller?.isConnected)return;
      selectAt(e.clientX,e.clientY);
      if(dragged||Math.hypot(e.clientX-event.clientX,e.clientY-event.clientY)>3){
        point={x:e.clientX,y:e.clientY};
        if(!frame){lastTime=0;frame=requestAnimationFrame(scrollFrame);}
      }
    };
    const cleanup=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',cancel);window.removeEventListener('blur',cancel);if(frame)cancelAnimationFrame(frame);frame=0;point=null;if(this._cellDragCleanup===cleanup)this._cellDragCleanup=null;};
    const cancel=e=>{if(e.type==='pointercancel'&&e.pointerId!==event.pointerId)return;cleanup();if(dragged&&this.cache?.docId===docId){this.selection=old;this.updateSelectionStatus();}};
    const finish=e=>{
      if(e.pointerId!==event.pointerId)return;
      cleanup();
      if(dragged||committedEditor){
        this._suppressSelectionClick=true;setTimeout(()=>{this._suppressSelectionClick=false;},0);
        if(!dragged)this.selectRange('cell',row,col,event);
        start.focus({preventScroll:true});
      }
    };
    this._cellDragCleanup?.();this._cellDragCleanup=cleanup;
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',cancel);window.addEventListener('blur',cancel);
  }
  csvContextMenu(event){
    if(!['csv','tsv'].includes(this.kind)||!this.parsed||!event.target.closest?.('.text-preview-scroll')||event.target.closest?.('textarea,input,select,dialog,[contenteditable="true"]'))return;
    const cell=event.target.closest('[data-cell-row][data-cell-column]'),row=event.target.closest('[data-select-row]')||event.target.closest('.text-preview-row-number')?.querySelector('[data-select-row]'),column=event.target.closest('[data-select-column]');
    if(!cell&&!row&&!column)return;
    const r=cell?Number(cell.dataset.cellRow):row?Number(row.dataset.selectRow):null,c=cell?Number(cell.dataset.cellColumn):column?Number(column.dataset.selectColumn):null,s=this.selection;
    const selected=s&&(s.kind==='all'||s.kind==='row'&&r!==null&&s.entries.has(r)||s.kind==='column'&&c!==null&&s.entries.has(c)||s.kind==='cell'&&r!==null&&c!==null&&s.entries.has(`${r}:${c}`));
    if(!selected){if(row)this.selectRange('row',r,null);else if(column)this.selectRange('column',c,null);else this.selectRange('cell',r,c);}
    event.preventDefault();event.stopPropagation();this._closeCsvMenu?.();
    const id=this.cache?.docId,selection=this.selection,raw=this.raw;
    const checked=action=>()=>{if(this.cache?.docId!==id||this.selection!==selection||this.raw!==raw){if(this.status)this.status.textContent=tr('文書または選択が変更されたため、操作を中止しました。','The document or selection changed; the operation was cancelled.');return;}action();};
    const item=(label,action)=>({label,action:checked(action)});const editable=typeof this.api.patch==='function'&&this.api.canEdit?.(id)!==false;
    const mutation=(label,action)=>({label,action:checked(action),disabled:!editable});
    this._closeCsvMenu=openCsvContextMenu(event.clientX,event.clientY,[
      item(tr('コピー','Copy'),()=>this.csvMenuCopy()),mutation(tr('貼り付け','Paste'),()=>this.csvMenuPaste('normal')),mutation(tr('改行を除いて貼り付け','Paste without line breaks'),()=>this.csvMenuPaste('single-line')),mutation(tr('縦横を入れ替えて貼り付け','Paste transposed'),()=>this.csvMenuPaste('transpose')),null,
      ...[[tr('全角を半角に','Convert full-width to half-width'),'half'],[tr('半角を全角に','Convert half-width to full-width'),'full'],[tr('半角カタカナをひらがなに','Convert half-width katakana to hiragana'),'kana-to-hiragana'],[tr('ひらがなを半角カタカナに','Convert hiragana to half-width katakana'),'hiragana-to-kana'],[tr('英字を大文字に','Uppercase Latin letters'),'upper'],[tr('英字を小文字に','Lowercase Latin letters'),'lower']].map(([label,op])=>mutation(label,()=>this.csvConvert(op)))
    ],()=>{this._closeCsvMenu=null;});
  }
  async csvMenuCopy(){
    try{const b=csvSelectionBounds(this.selection,this.parsed.rowCount,this.parsed.columnCount);if(!b)return;this.ensureVisibleClipboardRange(b.top,b.left,b.bottom,b.right);const text=csvCopyText(this.parsed,b);await host('clipboard.text',{text});if(this.status)this.status.textContent=tr('選択範囲をコピーしました。','Copied selection.');}catch(error){if(this.status)this.status.textContent=error.message||tr('コピーできませんでした。','Could not copy.');}
  }
  async csvMenuPaste(mode){
    const docId=this.cache?.docId,selection=this.selection,raw=this.raw,parsed=this.parsed;
    try{
      let text=await host('clipboard.readText');
      if(this.cache?.docId!==docId||this.selection!==selection||this.raw!==raw||this.parsed!==parsed)throw new Error(tr('文書または選択が変更されたため、貼り付けを中止しました。','The document or selection changed; paste was cancelled.'));
      if(typeof text!=='string')throw new Error(tr('クリップボードにテキストがありません。','The clipboard has no text.'));
      if(mode==='single-line')text=text.replace(/\r\n|\r|\n/g,'');
      if(mode==='transpose'){const matrix=transposeCsvClipboard(parseClipboardGrid(text));text=matrix.map(row=>row.map(value=>encodeDelimitedCell(value,'\t',row.length===1&&value==='')).join('\t')).join('\r\n');}
      const clipboardData={types:['text/plain'],getData:()=>text};this.pasteGrid({target:this.scroller,clipboardData,preventDefault(){},stopPropagation(){}});
    }catch(error){if(this.status)this.status.textContent=error.message||tr('貼り付けできませんでした。','Could not paste.');}
  }
  csvConvert(operation){
    const id=this.cache?.docId,before=this.raw;
    try{
      if(typeof this.api.patch!=='function'||this.api.canEdit?.(id)===false)throw new Error(tr('この表は現在編集できません。','This table cannot be edited right now.'));
      const bounds=csvSelectionBounds(this.selection,this.parsed.rowCount,this.parsed.columnCount);if(!bounds)return;this.ensureVisibleClipboardRange(bounds.top,bounds.left,bounds.bottom,bounds.right);
      const next=convertCsvRange(before,this.parsed,bounds,operation);if(next===before)return;const change=csvChangedRange(before,next);this.raw=next;
      try{if(this.api.patch({docId:id,...change,kind:'command'})===false)throw new Error();}catch{this.raw=before;throw new Error(tr('変換を反映できませんでした。原文は変更していません。','Could not apply conversion. The source is unchanged.'));}
      this.renderTable();this.scroller?.focus({preventScroll:true});
    }catch(error){if(this.status)this.status.textContent=error.message||tr('文字を変換できませんでした。','Could not convert text.');}
  }
  clipboardTarget(event){return ['csv','tsv'].includes(this.kind)&&this.parsed&&this.selection?.entries?.size&&event.target.closest?.('.text-preview-scroll')&&!event.target.closest?.('textarea,input,select,dialog,[contenteditable="true"]');}
  ensureVisibleClipboardRange(top,left,bottom,right){if(this.view.hiddenRows.some(index=>index>=top&&index<=bottom)||[...(this._filterHiddenRows||[])].some(index=>index>=top&&index<=bottom)||this.view.hiddenColumns.some(index=>index>=left&&index<=right))throw new Error(tr('選択範囲に非表示の行または列（絞り込みで非表示の行を含む）があります。表示してから操作してください。','The selection contains hidden rows or columns (including filtered rows). Show them before continuing.'));}
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
    if(typeof this.api.patch!=='function'||this.api.canEdit?.(id)===false){if(this.status)this.status.textContent=tr('この表は現在編集できません。','This table cannot be edited right now.');return;}
    let bounds,next,matrix,shape,oldShape;
    try{
      bounds=csvSelectionBounds(this.selection,this.parsed.rowCount,this.parsed.columnCount);if(!bounds)return;
      matrix=parseClipboardGrid(event.clipboardData.getData('text/plain'));
      const width=matrix.reduce((maximum,row)=>Math.max(maximum,row.length),0);
      const fill=matrix.length===1&&width===1;
      this.ensureVisibleClipboardRange(bounds.top,bounds.left,fill?bounds.bottom:bounds.top+matrix.length-1,fill?bounds.right:bounds.left+width-1);
      next=pasteCsvGrid(before,this.parsed,bounds,matrix);if(next===before)return;
      oldShape={rows:this.parsed.rowCount,columns:this.parsed.columnCount};shape={rows:Math.max(this.parsed.rowCount,bounds.top+matrix.length),columns:Math.max(this.parsed.columnCount,bounds.left+width)};
    }catch(error){if(this.status)this.status.textContent=error.message||tr('貼り付けを反映できませんでした。','Could not apply paste.');return;}
    const change=csvChangedRange(before,next);this.raw=next;
    try{if(this.api.patch({docId:id,...change,kind:'command'})===false)throw new Error();}
    catch{this.raw=before;if(this.status)this.status.textContent=tr('貼り付けを反映できませんでした。原文は変更していません。','Could not apply paste. The source is unchanged.');return;}
    // Paste only expands a grid; existing row/column indices and their view
    // settings remain valid and must not be cleared by shape reconciliation.
    if(!Array.isArray(this._pasteShapes))this._pasteShapes=[];
    this._pasteShapes.push({before:oldShape,after:shape});if(this._pasteShapes.length>200)this._pasteShapes.shift();
    this._layoutShape=shape;this.renderTable();
    if(this.parsed){this.selectRange('cell',bounds.top,bounds.left);this.scroller?.querySelector(`[data-cell-row="${bounds.top}"][data-cell-column="${bounds.left}"]`)?.focus({preventScroll:true});}
  }
  clearSelectedCells(activeRow,activeColumn){
    const selection=this.selection,parsed=this.parsed,id=this.cache?.docId,before=this.raw;
    if(selection?.kind!=='cell'||!selection.entries.size||!parsed)return;
    if(typeof this.api.patch!=='function'||this.api.canEdit?.(id)===false){
      if(this.status)this.status.textContent=tr('この表は現在編集できません。','This table cannot be edited right now.');
      return;
    }
    const hiddenRows=new Set([...this.view.hiddenRows,...(this._filterHiddenRows||[])]),hiddenColumns=new Set(this.view.hiddenColumns),edits=[];
    for(const entry of selection.entries){
      const [row,column]=String(entry).split(':').map(Number);
      if(!Number.isInteger(row)||!Number.isInteger(column)||row<0||column<0||hiddenRows.has(row)||hiddenColumns.has(column))continue;
      const range=parsed.cellRanges[row]?.[column],value=parsed.rows[row]?.[column];
      // Missing ragged cells and already empty values need no source edit.
      if(!range||value===undefined||value==='')continue;
      const lastSingleCell=row===parsed.rowCount-1&&parsed.rows[row].length===1&&parsed.rowRanges[row].to===before.length;
      edits.push({from:range.from,to:range.to,insert:encodeDelimitedCell('',parsed.delimiter,range.quoted||lastSingleCell)});
    }
    if(!edits.length)return;
    edits.sort((a,b)=>a.from-b.from);
    const pieces=[];let position=0;
    for(const edit of edits){pieces.push(before.slice(position,edit.from),edit.insert);position=edit.to;}
    pieces.push(before.slice(position));const next=pieces.join('');
    const scrollTop=this.scroller?.scrollTop||0,scrollLeft=this.scroller?.scrollLeft||0;
    this.raw=next;
    try{if(this.api.patch({docId:id,...csvChangedRange(before,next),kind:'command'})===false)throw new Error();}
    catch{this.raw=before;if(this.status)this.status.textContent=tr('セルの消去を反映できませんでした。原文は変更していません。','Could not clear the cells. The source is unchanged.');return;}
    this.renderTable();
    if(this.scroller){
      this.scroller.scrollTop=scrollTop;this.scroller.scrollLeft=scrollLeft;
      (this.scroller.querySelector(`[data-cell-row="${activeRow}"][data-cell-column="${activeColumn}"]`)||this.scroller).focus({preventScroll:true});
    }
  }
  selectRange(kind,a,b,event={}){
    this.selection=nextCsvSelection(this.selection,kind,a,b,event);const {entries}=this.selection;this.updateSelectionStatus();
    if(entries.size){const row=kind==='column'?Math.max(0,csvRowAtPosition(this.parsed.rowRanges,this._activePosition)):a,col=kind==='cell'?b:kind==='column'?a:0;const at=this.parsed.cellRanges[row]?.[col]?.from??this.parsed.rowRanges[row]?.from;if(at!==undefined){this.setActivePosition(at);this.api.position?.(this.cache?.docId,at);}}
  }
  updateSelectionStatus(){
    if(this.addressOutput)this.addressOutput.textContent=csvSelectionAddress(this.selection,this.parsed?.rowCount||0,this.parsed?.columnCount||0,this.view.columnLabel);
    const s=this.selection;this.selectionLabel&&(this.selectionLabel.textContent=s?.kind==='all'?tr('すべてのセルを選択','All cells selected'):s?.entries.size?tr(`${s.entries.size} ${s.kind==='row'?'行':s.kind==='column'?'列':'セル'}を選択`,`${s.entries.size} ${s.kind==='row'?'rows':s.kind==='column'?'columns':'cells'} selected`):tr('セル・行・列をクリックして選択','Click a cell, row, or column to select'));const axis=!!s?.entries.size&&(s.kind==='row'||s.kind==='column');if(this.hideButton)this.hideButton.disabled=!axis;if(this.deleteButton)this.deleteButton.disabled=!axis||!this.api.patch;
    for(const cell of this.scroller?.querySelectorAll('[data-grid-row][data-grid-column]')||[]){const row=Number(cell.dataset.gridRow),col=Number(cell.dataset.gridColumn);cell.classList.toggle('csv-selected',!!s&&(s.kind==='all'?true:s.kind==='row'?s.entries.has(row):s.kind==='column'?s.entries.has(col):s.entries.has(`${row}:${col}`)));}
    for(const number of this.scroller?.querySelectorAll('[data-select-row]')||[])number.classList.toggle('csv-selected',s?.kind==='all'||s?.kind==='row'&&s.entries.has(Number(number.dataset.selectRow)));
  }
  styleCell(cell,row,col){const a=csvCellAlignment(this.view,row,col);cell.style.textAlign=a.horizontal;cell.style.verticalAlign=a.vertical==='viewport'?'top':a.vertical;cell.classList.toggle('csv-viewport-align',a.vertical==='viewport');cell.classList.toggle('csv-middle-align',a.vertical==='middle');cell.classList.toggle('csv-bottom-align',a.vertical==='bottom');}
  selectedCsvColumns(){const s=this.selection;if(!s?.entries?.size)return [];if(s.kind==='column')return [...s.entries].sort((a,b)=>a-b);if(s.kind==='cell')return [...new Set([...s.entries].map(k=>Number(k.split(':')[1])))].sort((a,b)=>a-b);return [];}
  csvColumnOptions(select,chosen){for(let column=0;column<this.parsed.columnCount;column++){const heading=this.csvSettings.header?(this.parsed.rows[0]?.[column]||'').replace(/\s+/g,' ').slice(0,50):'';const option=make('option',null,`${csvColumnLabel(column,this.view.columnLabel)}${heading?' · '+heading:''}`);option.value=String(column);select.append(option);}select.value=String(chosen);}
  async openFilterDialog(){
    if(!this.parsed)return;const id=this.cache?.docId,raw=this.raw,old=this.csvSettings.filter,fields={};
    const accepted=await this.gridDialog(tr('列で絞り込み','Filter by column'),tr('選んだ列に文字を含む行だけ表示します。絞り込みは保存されず、CSV原文を変更しません。','Show rows containing text in the selected column. Filters are not saved and do not change the CSV source.'),dialog=>{
      const label=make('label',null,tr('列','Column')),select=make('select');select.setAttribute('aria-label',tr('絞り込む列','Column to filter'));this.csvColumnOptions(select,old?.column??this.selectedCsvColumns()[0]??0);label.append(select);dialog.append(label);fields.column=select;
      const textLabel=make('label',null,tr('含む文字','Contains text')),input=make('input');input.type='text';input.setAttribute('aria-label',tr('絞り込む文字','Text to filter'));input.value=old?.text||'';textLabel.append(input);dialog.append(textLabel);fields.text=input;
    });
    if(!accepted||id!==this.cache?.docId||raw!==this.raw)return;
    this.csvSettings.filter=fields.text.value?{column:Number(fields.column.value),text:fields.text.value}:null;this.csvSettings.rowPage=0;this.selection=null;this.renderTable();
  }
  async openSortDialog(){
    if(!this.parsed||!this.api.patch||this.api.canEdit?.(this.cache?.docId)===false)return;
    if(this.csvSettings.filter||this.view.hiddenRows.length||this.view.hiddenColumns.length){this.status.textContent=tr('並べ替え・列移動の前に、絞り込みと非表示を解除してください。','Clear filters and show hidden rows and columns before sorting or moving columns.');return;}
    const id=this.cache?.docId,raw=this.raw,selection=this.selectedCsvColumns(),fields={};
    const accepted=await this.gridDialog(tr('並べ替え・列移動','Sort or move columns'),tr('行全体を列の値で並べ替えるか、選択した連続列を左右に移動します。原文も変更されます（Ctrl+Zで戻せます）。','Sort entire rows by column value or move selected adjacent columns. This also changes the source (Ctrl+Z to undo).'),dialog=>{
      const colLabel=make('label',null,tr('基準の列','Reference column')),col=make('select');col.setAttribute('aria-label',tr('並べ替える列','Column to sort'));this.csvColumnOptions(col,selection[0]??0);colLabel.append(col);dialog.append(colLabel);fields.column=col;
      const actionLabel=make('label',null,tr('操作','Action')),action=make('select');action.setAttribute('aria-label',tr('並べ替えの操作','Sort action'));for(const [value,label] of [['asc',tr('列の値で昇順','Ascending by column')],['desc',tr('列の値で降順','Descending by column')],['left',tr('選択した列を左へ移動','Move selected columns left')],['right',tr('選択した列を右へ移動','Move selected columns right')]]){const option=make('option',null,label);option.value=value;action.append(option);}actionLabel.append(action);dialog.append(actionLabel);fields.action=action;
      dialog.append(make('p','muted',tr('列移動は表で選択した連続列に適用します。未選択の場合は基準の列を移動します。移動する範囲が短い行には空欄が追加されます。行・セル単位の表示設定は解除されます。','Column moves affect adjacent selected columns, or the reference column if none are selected. Short rows are padded with empty cells. Row and cell view settings are cleared.')));
    },tr('実行','Run'));
    if(!accepted||id!==this.cache?.docId||raw!==this.raw)return;
    try{
      const action=fields.action.value,col=Number(fields.column.value),move=action==='left'||action==='right';
      const next=move?moveDelimitedColumns(raw,this.parsed,selection.length?selection:[col],action):sortDelimitedRows(raw,this.parsed,col,{header:this.csvSettings.header,descending:action==='desc'});
      if(next===raw){this.status.textContent=tr('変更はありません。','No changes.');return;}
      this.raw=next;
      try{if(this.api.patch({docId:id,from:0,to:raw.length,insert:next,kind:'command'})===false)throw Error();}catch(error){this.raw=raw;throw error;}
      this.selection=null;this.view.rowHeights={};this.view.rowAlignment={};this.view.cellAlignment={};if(move){this.view.columnWidths={};this.view.columnAlignment={};}this.publishView();this.renderTable();this.status.textContent+=tr(' · 並べ替えを反映しました（Ctrl+Zで元に戻せます）',' · Sort applied (Ctrl+Z to undo)');
    }catch(error){this.status.textContent=error.message||tr('並べ替えを反映できませんでした。','Could not apply sorting.');}
  }
  hideSelection(){const s=this.selection;if(!s||!['row','column'].includes(s.kind)||!s.entries.size)return;if(this.csvSettings.filter){this.status.textContent=tr('行・列の非表示は、絞り込みを解除してから行ってください。','Clear the filter before hiding rows or columns.');return;}const key=s.kind==='row'?'hiddenRows':'hiddenColumns';this.view[key]=[...new Set([...this.view[key],...s.entries])];this.selection=null;this.publishView();this.renderTable();}
  async deleteSelection(){
    const s=this.selection;if(!s||!['row','column'].includes(s.kind)||!s.entries.size||!this.parsed||this.api.canEdit?.(this.cache?.docId)===false)return;
    if(this.csvSettings.filter){this.status.textContent=tr('行・列の削除は、絞り込みを解除してから行ってください。','Clear the filter before deleting rows or columns.');return;}
    const id=this.cache?.docId,raw=this.raw;const ok=await this.gridDialog(tr('選択した行・列を削除','Delete selected rows or columns'),tr(`${s.entries.size} ${s.kind==='row'?'行':'列'}を削除します。CSVの原文も変更します。`,`Delete ${s.entries.size} ${s.kind==='row'?'rows':'columns'}. The CSV source will also change.`),null,tr('削除','Delete'));if(!ok||id!==this.cache?.docId||raw!==this.raw)return;
    const next=deleteDelimitedSelection(raw,this.parsed,s.kind,[...s.entries]);if(next===raw)return;this.raw=next;
    try{if(this.api.patch({docId:id,from:0,to:raw.length,insert:next,kind:'command'})===false)throw Error();this.selection=null;this.view=normalizeCsvView();this.publishView();this.renderTable();}catch{this.raw=raw;this.status.textContent=tr('削除を反映できませんでした。','Could not apply deletion.');}
  }
  gridDialog(title,message,build,acceptText=tr('適用','Apply')){
    if(!this.finishEdit())return Promise.resolve(false);const dialog=make('dialog','csv-settings-dialog');dialog.setAttribute('aria-label',title);dialog.append(make('h2',null,title));if(message)dialog.append(make('p',null,message));if(build)build(dialog);const actions=make('div','text-preview-dialog-actions'),cancel=make('button',null,tr('キャンセル','Cancel')),accept=make('button',null,acceptText);cancel.type=accept.type='button';actions.append(cancel,accept);dialog.append(actions);this.container.append(dialog);this.api.dialogOpen?.(true);
    return new Promise(resolve=>{let done=false;const finish=ok=>{if(done)return;done=true;this._cancelDialog=null;this.api.dialogOpen?.(false);resolve(ok);queueMicrotask(()=>dialog.remove());};this._cancelDialog=()=>{if(dialog.open)dialog.close('cancel');finish(false);};cancel.onclick=()=>dialog.close('cancel');accept.onclick=()=>dialog.close('ok');dialog.addEventListener('close',()=>finish(dialog.returnValue==='ok'),{once:true});dialog.showModal();});
  }
  async openGridSettings(){
    const id=this.cache?.docId,s=this.selection,fields={};const chosenRows=s?.kind==='row'?[...s.entries]:s?.kind==='cell'?[...new Set([...s.entries].map(x=>Number(x.split(':')[0])))]:[],chosenCols=s?.kind==='column'?[...s.entries]:s?.kind==='cell'?[...new Set([...s.entries].map(x=>Number(x.split(':')[1])))]:[];
    const selected=s?.kind!=='all'&&s?.entries.size;const a=s?.kind==='cell'?csvCellAlignment(this.view,...[...s.entries][0].split(':').map(Number)):s?.kind==='row'?this.view.rowAlignment[[...s.entries][0]]||this.view.alignment:s?.kind==='column'?this.view.columnAlignment[[...s.entries][0]]||this.view.alignment:this.view.alignment;
    const ok=await this.gridDialog(tr('CSVの表示設定','CSV view settings'),selected?tr('選択した範囲のサイズ・配置に適用します。固定範囲は表全体に適用します。','Apply size and alignment to the selection. Frozen ranges apply to the entire table.'):tr('サイズ・配置の初期値を表全体に適用します。','Apply default size and alignment to the entire table.'),dialog=>{
      const input=(label,id,value)=>{const l=make('label',null,label),n=make('input');n.type='number';n.id=id;n.value=value;n.min='0';l.append(n);dialog.append(l);fields[id]=n;};
      input(tr('列幅（px）','Column width (px)'),'csv-column-width',chosenCols.length?(this.view.columnWidths[chosenCols[0]]??this.view.defaultColumnWidth):this.view.defaultColumnWidth);input(tr('行の高さ（px、0は自動）','Row height (px; 0 for auto)'),'csv-row-height',chosenRows.length?(this.view.rowHeights[chosenRows[0]]??this.view.defaultRowHeight):this.view.defaultRowHeight);input(tr('固定する行数（最大100）','Frozen rows (max 100)'),'csv-freeze-rows',this.view.freezeRows);input(tr('固定する列数（最大50）','Frozen columns (max 50)'),'csv-freeze-columns',this.view.freezeColumns);
      const select=(label,id,options,value)=>{const l=make('label',null,label),n=make('select');n.id=id;for(const [v,t] of options){const o=make('option',null,t);o.value=v;n.append(o);}n.value=value;l.append(n);dialog.append(l);fields[id]=n;};select(tr('列番号','Column labels'),'csv-column-label',[['letters',tr('アルファベット（A、B、C…）','Letters (A, B, C…)')],['numbers',tr('数字（1、2、3…）','Numbers (1, 2, 3…)')]],this.view.columnLabel);select(tr('横位置','Horizontal alignment'),'csv-horizontal',[['left',tr('左揃え','Left')],['center',tr('中央揃え','Center')],['right',tr('右揃え','Right')]],a.horizontal);select(tr('縦位置','Vertical alignment'),'csv-vertical',[['top',tr('上揃え','Top')],['middle',tr('中央揃え','Center')],['bottom',tr('下揃え','Bottom')],['viewport',tr('画面表示に合わせる','Fit visible area')]],a.vertical);
      select(tr('Enterキーの移動方向','Enter key direction'),'csv-enter-direction',[['down',tr('下','Down')],['up',tr('上','Up')],['right',tr('右','Right')],['left',tr('左','Left')],['none',tr('移動しない','Do not move')]],this.view.enterDirection);
      select(tr('行の背景','Row background'),'csv-striped-rows',[['off',tr('通常','Normal')],['on',tr('交互に色を付ける','Alternate colors')]],this.view.stripedRows?'on':'off');
      const reset=make('button','csv-reset-view',tr('表示設定を初期化','Reset view settings'));reset.type='button';reset.onclick=()=>{this.setView({});dialog.close('cancel');};dialog.append(reset);
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
    const button=make('button','text-preview-large-button',tr('大きな表の表示を選択','Choose how to display the large table'));button.type='button';this.scroller.append(button);
    const show=()=>{
      if(this.container.querySelector('.text-preview-large-dialog'))return;
      const dialog=make('dialog','text-preview-large-dialog');dialog.setAttribute('aria-label',tr('大きな表のプレビュー','Large table preview'));
      dialog.append(make('h2',null,tr('大きな表を表示しますか？','Display the large table?')),make('p',null,tr('このCSVは大きいため、解析に時間がかかったり、メモリを多く使う場合があります。表はページに分けて表示します。原文はそのまま編集できます。','This CSV is large; parsing it may take time and memory. The table will be paginated. You can still edit the source.')));
      const actions=make('div','text-preview-dialog-actions'),cancel=make('button',null,tr('表示しない','Do not show')),accept=make('button',null,tr('表示する','Show'));cancel.type=accept.type='button';actions.append(cancel,accept);dialog.append(actions);this.container.append(dialog);
      cancel.addEventListener('click',()=>dialog.close());accept.addEventListener('click',()=>{this.csvSettings.allowLarge=true;dialog.close();this.renderTable();});dialog.addEventListener('close',()=>dialog.remove());
      try{dialog.showModal();}catch{dialog.setAttribute('open','');}
    };
    button.addEventListener('click',show);
    if(!this.csvSettings.warningShown){this.csvSettings.warningShown=true;show();}
  }
  moveByArrow(row,column,deltaRow,deltaColumn,extend=false){
    if(!this.parsed||!this.scroller)return;
    const selection=this.selection;
    // A pointer-selected range keeps focus on its anchor. Shift+arrow continues
    // from the opposite edge; after a keyboard extension focus is already at
    // that edge. Sparse Ctrl selections fall back to the focused cell.
    if(extend&&selection?.kind==='cell'&&selection.entries.size>1&&selection.anchor?.[0]===row&&selection.anchor?.[1]===column){
      try{
        const bounds=csvSelectionBounds(selection,this.parsed.rowCount,this.parsed.columnCount);
        if(bounds){row=row===bounds.top?bounds.bottom:bounds.top;column=column===bounds.left?bounds.right:bounds.left;}
      }catch{}
    }
    let nextRow=row+deltaRow,nextColumn=column+deltaColumn;
    while(nextRow>=0&&nextRow<this.parsed.rowCount&&nextColumn>=0&&nextColumn<this.parsed.columnCount&&
      (this.view.hiddenRows.includes(nextRow)||this._filterHiddenRows?.has(nextRow)||this.view.hiddenColumns.includes(nextColumn))){
      nextRow+=deltaRow;nextColumn+=deltaColumn;
    }
    if(nextRow<0||nextRow>=this.parsed.rowCount||nextColumn<0||nextColumn>=this.parsed.columnCount)return;
    let target=this.scroller.querySelector(`[data-cell-row="${nextRow}"][data-cell-column="${nextColumn}"]`);
    if(!target&&this._scrollLayout?.large){
      const rows=this._scrollLayout.scrollingRows||[],columns=Array.from({length:this.parsed.columnCount},(_,i)=>i).filter(i=>!this.view.hiddenColumns.includes(i)&&i>=this.view.freezeColumns);
      const rowAt=rows.indexOf(nextRow),columnAt=columns.indexOf(nextColumn);
      if(rowAt>=0)this.csvSettings.rowPage=Math.floor(rowAt/CSV_PAGE_ROWS);
      if(columnAt>=0)this.csvSettings.columnPage=Math.floor(columnAt/CSV_PAGE_COLUMNS);
      this.renderTable();target=this.scroller?.querySelector(`[data-cell-row="${nextRow}"][data-cell-column="${nextColumn}"]`);
    }
    if(!target)return;
    this.selectRange('cell',nextRow,nextColumn,{shiftKey:extend});
    target.focus({preventScroll:true});target.scrollIntoView({block:'nearest',inline:'nearest'});
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
    const docId=this.cache?.docId;if(this.api.canEdit?.(docId)===false){if(this.status)this.status.textContent=tr('別のウィンドウでの編集を終えてから、このセルを編集してください。','Finish editing in the other window before editing this cell.');return false;}
    if(this._editing&&!this.finishEdit())return false;
    let cell=this.scroller?.querySelector(`[data-cell-row="${rowIndex}"][data-cell-column="${columnIndex}"]`);const values=this.parsed.rows[rowIndex];
    if(!cell&&values&&this.csvSettings.allowLarge){const headerRows=this.csvSettings.header?1:0;this.csvSettings.rowPage=Math.floor(Math.max(0,rowIndex-headerRows)/CSV_PAGE_ROWS);this.csvSettings.columnPage=Math.floor(columnIndex/CSV_PAGE_COLUMNS);this.renderTable();cell=this.scroller?.querySelector(`[data-cell-row="${rowIndex}"][data-cell-column="${columnIndex}"]`);}
    if(!cell||!values)return false;
    const range=this.parsed.cellRanges[rowIndex][columnIndex],from=range?.from??this.parsed.rowRanges[rowIndex].to,to=range?.to??from;
    const prefix=range?'':this.parsed.delimiter.repeat(columnIndex-values.length+1),originalValue=values[columnIndex]??'',input=make('textarea','text-preview-cell-input');
    input.value=originalValue;input.spellcheck=false;input.setAttribute('aria-label',tr(`${rowIndex+1}行 ${columnIndex+1}列の値`,`Value at row ${rowIndex+1} column ${columnIndex+1}`));
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
    catch{this.raw=before;field.currentTo=oldTo;if(this.status)this.status.textContent=tr('セルの入力を反映できませんでした。原文を確認してください。','Could not apply the cell edit. Check the source.');return false;}
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
    if(redraw&&['csv','tsv'].includes(this.kind)&&this.scroller){
      if(this.cache?.language!==currentUiLanguage())this.render(this.raw,this.kind,this.options);
      else this.renderTable();
    }return true;
  }
}

