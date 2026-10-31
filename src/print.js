import {buildHtmlPreview} from './html-preview.js';
import {parseDelimited} from './csv-parser.js';
import {csvCellAlignment} from './csv-view.js';
import './print.css';
export const safePrintImage=src=>/^(?:data:image\/(?:png|jpeg|gif|webp|bmp);base64,|blob:|https:\/\/assets\.mdsplit\.local\/)/i.test(src||'');

// The print-only tree is separate from CodeMirror's virtualized viewport and
// the CSV grid's page, so printing never silently truncates the document.
export function buildPrintContent({side,raw,kind,preview,textPreview,fontSize=15,scope='visible'}){
  const root=document.createElement('article');root.className='print-content';
  if(side==='source'){
    const pre=document.createElement('pre');pre.className='print-source';pre.textContent=raw;root.append(pre);return root;
  }
  if(kind==='markdown'){
    const clone=preview.cloneNode(true);clone.removeAttribute('id');clone.removeAttribute('contenteditable');
    clone.querySelectorAll('.component-tools,.code-tools,.heading-fold,textarea,.diagram-error').forEach(node=>node.remove());
    clone.querySelectorAll('[data-block][hidden]').forEach(node=>node.removeAttribute('hidden'));
    clone.querySelectorAll('.section-collapsed').forEach(node=>node.classList.remove('section-collapsed'));
    clone.querySelectorAll('details').forEach(node=>node.open=true);
    // Avoid triggering new external requests during print. Local app images and
    // embedded images are retained; unsafe URL schemes never reach the tree.
    clone.querySelectorAll('img').forEach(node=>{if(!safePrintImage(node.getAttribute('src')))node.removeAttribute('src');});
    root.append(clone);return root;
  }
  if(kind==='html'){
    // Reuse the HTML preview sanitizer and never insert user style sheets into
    // the app document. Inline styles have already been screened for URLs.
    const safe=new DOMParser().parseFromString(buildHtmlPreview(raw,{fontSize}),'text/html');
    safe.body.querySelectorAll('style').forEach(node=>node.remove());
    root.classList.add('print-html');for(const node of [...safe.body.childNodes])root.append(document.importNode(node,true));return root;
  }
  if(kind==='csv'||kind==='tsv'){
    const setting=textPreview.csvSettings||{};const delimiter={comma:',',tab:'\t',semicolon:';'}[setting.delimiter]||(kind==='tsv'?'\t':',');
    const parsed=parseDelimited(raw,{delimiter,unlimited:true});
    const rows=scope==='visible'?new Set([...(textPreview.view?.hiddenRows||[]),...(textPreview._filterHiddenRows||[])]):new Set();
    const cols=scope==='visible'?new Set(textPreview.view?.hiddenColumns||[]):new Set();
    const table=document.createElement('table');table.className='print-csv';const columns=[];let totalWidth=0;
    for(let c=0;c<parsed.columnCount;c++)if(!cols.has(c)){const width=textPreview.view?.columnWidths?.[c]??textPreview.view?.defaultColumnWidth??180;columns.push([c,width]);totalWidth+=width;}
    const group=document.createElement('colgroup');for(const [,width] of columns){const col=document.createElement('col');col.style.width=(width/totalWidth*100)+'%';group.append(col);}table.append(group);
    for(let r=0;r<parsed.rowCount;r++){
      if(rows.has(r))continue;
      const tr=document.createElement('tr');
      for(const [c] of columns){
        const cell=document.createElement(setting.header&&r===0?'th':'td');cell.textContent=parsed.rows[r][c]??'';
        const alignment=textPreview.view?csvCellAlignment(textPreview.view,r,c):null;if(alignment){cell.style.textAlign=alignment.horizontal;cell.style.verticalAlign=alignment.vertical==='viewport'?'top':alignment.vertical;}
        tr.append(cell);
      }
      table.append(tr);
    }
    root.append(table);return root;
  }
  throw new Error('このファイルには展開表示がありません。');
}

export function setPrintContent(content){
  let root=document.querySelector('#print-root');if(!root){root=document.createElement('div');root.id='print-root';document.body.append(root);window.addEventListener('afterprint',()=>root.replaceChildren());}root.replaceChildren(content);return root;
}
