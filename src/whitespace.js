import {ViewPlugin,Decoration,WidgetType} from '@codemirror/view';
import {StateEffect} from '@codemirror/state';
import {lfToRaw} from './document.js';

export const DEFAULT_WHITESPACE_STYLES=Object.freeze({
  lineBreak:Object.freeze({color:'#87909a',opacity:0.45}),
  wideSpace:Object.freeze({color:'#87909a',opacity:0.4}),
  tab:Object.freeze({color:'#87909a',opacity:0.4}),
  space:Object.freeze({color:'#87909a',opacity:0.3})
});
const whitespaceVariables={lineBreak:'line-break',wideSpace:'wide-space',tab:'tab',space:'space'};
export function normalizeWhitespaceStyles(value){
  const input=value&&typeof value==='object'?value:{};
  return Object.fromEntries(Object.entries(DEFAULT_WHITESPACE_STYLES).map(([key,fallback])=>{
    const item=input[key]&&typeof input[key]==='object'?input[key]:{};
    const color=typeof item.color==='string'&&/^#[0-9a-f]{6}$/i.test(item.color)?item.color.toLowerCase():fallback.color;
    const amount=typeof item.opacity==='number'?item.opacity:NaN;
    const opacity=Number.isFinite(amount)?Math.max(0.1,Math.min(1,amount)):fallback.opacity;
    return [key,{color,opacity}];
  }));
}
export function applyWhitespaceStyles(value,root=document.documentElement){
  const styles=normalizeWhitespaceStyles(value?.whitespaceStyles??value);
  for(const [key,suffix] of Object.entries(whitespaceVariables)){
    root.style.setProperty('--ws-'+suffix+'-color',styles[key].color);
    root.style.setProperty('--ws-'+suffix+'-opacity',String(styles[key].opacity));
  }
  return styles;
}

export const whitespaceMark=(character,options)=>character==='\t'&&options.showTabs?['tab','→']:character==='\u3000'&&options.showFullWidthSpaces?['wide-space','□']:character===' '&&options.showSpaces?['space','·']:character==='\n'&&options.showLineBreaks?['line-break','↵']:null;
export const refreshWhitespaceMarkers=StateEffect.define();
export function lineBreakAppearance(raw,distinguish=true){
  if(!distinguish)return {glyph:'↵',label:'改行'};
  if(raw.startsWith('\r\n'))return {glyph:'↵',label:'CRLF（改行）'};
  if(raw.startsWith('\r'))return {glyph:'←',label:'CR（改行）'};
  return {glyph:'↓',label:'LF（改行）'};
}
class LineBreakWidget extends WidgetType{
  constructor(raw,distinguish){super();this.appearance=lineBreakAppearance(raw,distinguish);}
  eq(other){return this.appearance.label===other.appearance.label;}
  toDOM(){const n=document.createElement('span');n.className='cm-eol-marker';n.textContent=this.appearance.glyph;n.setAttribute('aria-hidden','true');n.title=this.appearance.label;return n;}
  ignoreEvent(){return true;}
}
export function visibleWhitespace(options,rawText=()=>null){
  return ViewPlugin.fromClass(class{
    constructor(view){this.decorations=this.build(view);}
    update(update){if(update.docChanged||update.viewportChanged||update.transactions.some(t=>t.effects.some(e=>e.is(refreshWhitespaceMarkers))))this.decorations=this.build(update.view);}
    build(view){
      const marks=[];const seen=new Set();const raw=rawText();
      for(const {from,to} of view.visibleRanges){
        let line=view.state.doc.lineAt(from);
        while(line.from<=to){
          if(!seen.has(line.number)){
            seen.add(line.number);
            for(const m of line.text.matchAll(/[ \t\u3000]/g)){
              const mark=whitespaceMark(m[0],options);if(mark)marks.push(Decoration.mark({class:'visible-whitespace ws-'+mark[0],attributes:{'data-mark':mark[1]}}).range(line.from+m.index,line.from+m.index+1));
            }
            if(options.showLineBreaks&&line.number<view.state.doc.lines){const offset=typeof raw==='string'?lfToRaw(raw,line.to):-1;const code=offset<0?'\n':raw.slice(offset,offset+2);marks.push(Decoration.widget({widget:new LineBreakWidget(code,options.distinguishLineBreaks!==false),side:1}).range(line.to));}
          }
          if(line.number===view.state.doc.lines)break;line=view.state.doc.line(line.number+1);
        }
      }
      return Decoration.set(marks,true);
    }
  },{decorations:v=>v.decorations});
}
