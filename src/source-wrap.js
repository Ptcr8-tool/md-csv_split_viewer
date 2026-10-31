import {EditorView} from '@codemirror/view';

export function sourceWrapMode(settings={}) {
  return ['none','column','window'].includes(settings.wrapMode) ? settings.wrapMode : settings.wrap === false ? 'none' : 'window';
}
export function sourceWrapColumn(settings={}) {
  const value=settings.wrapColumn == null || settings.wrapColumn === '' ? NaN : Number(settings.wrapColumn);
  return Number.isFinite(value) ? Math.max(10,Math.min(500,Math.round(value))) : 80;
}
export function sourceWrapExtension(settings={}) {
  const mode=sourceWrapMode(settings);
  if(mode==='none')return [];
  if(mode==='window')return EditorView.lineWrapping;
  const column=sourceWrapColumn(settings);
  return [EditorView.lineWrapping,EditorView.theme({'.cm-content':{width:`${column}ch`,minWidth:`${column}ch`,boxSizing:'content-box'}})];
}
