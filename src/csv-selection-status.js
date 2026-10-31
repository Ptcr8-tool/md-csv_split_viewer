import {csvColumnLabel} from './csv-view.js';
import './csv-selection-status.css';

// A sparse Ctrl-selection is shown as its bounding range, explicitly marked as
// noncontiguous; it must not be mistaken for a full rectangular selection.
export function csvSelectionAddress(selection, rowCount, columnCount, style='letters') {
  if (!selection?.entries?.size || rowCount < 1 || columnCount < 1) return '';
  let minRow = Infinity, maxRow = -1, minColumn = Infinity, maxColumn = -1, count = 0;
  const addRow = n => { if(Number.isInteger(n) && n >= 0 && n < rowCount) { minRow=Math.min(minRow,n); maxRow=Math.max(maxRow,n); count++; } };
  const addColumn = n => { if(Number.isInteger(n) && n >= 0 && n < columnCount) { minColumn=Math.min(minColumn,n); maxColumn=Math.max(maxColumn,n); count++; } };
  if (selection.kind === 'all') { minRow=0; maxRow=rowCount-1; minColumn=0; maxColumn=columnCount-1; }
  else if (selection.kind === 'row') { for(const n of selection.entries) addRow(n); minColumn=0; maxColumn=columnCount-1; }
  else if (selection.kind === 'column') { for(const n of selection.entries) addColumn(n); minRow=0; maxRow=rowCount-1; }
  else if (selection.kind === 'cell') {
    for (const item of selection.entries) {
      const parts=String(item).split(':');
      const row=Number(parts[0]), column=Number(parts[1]);
      if(parts.length!==2 || !Number.isInteger(row) || !Number.isInteger(column) || row<0 || row>=rowCount || column<0 || column>=columnCount)continue;
      minRow=Math.min(minRow,row); maxRow=Math.max(maxRow,row); minColumn=Math.min(minColumn,column); maxColumn=Math.max(maxColumn,column); count++;
    }
  } else return '';
  if(maxRow < 0 || maxColumn < 0 || !Number.isFinite(minRow) || !Number.isFinite(minColumn))return '';
  const address=(row,column)=>`${row+1}${style==='numbers'?'-':''}${csvColumnLabel(column,style)}`;
  const first=address(minRow,minColumn),last=address(maxRow,maxColumn);
  const total=selection.kind==='row'?maxRow-minRow+1:selection.kind==='column'?maxColumn-minColumn+1:(maxRow-minRow+1)*(maxColumn-minColumn+1);
  const sparse=selection.kind!=='all' && count!==total;
  return first+(first===last?'':`:${last}`)+(sparse?'（複数範囲）':'');
}

export function createCsvSelectionFooter() {
  const footer=document.createElement('div'); footer.className='csv-address-footer';
  const output=document.createElement('output'); output.className='csv-address'; output.setAttribute('aria-label','選択セルの位置'); output.setAttribute('aria-live','polite');
  footer.append(output); return {footer,output};
}
