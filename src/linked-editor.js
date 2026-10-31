import {StateEffect,StateField} from '@codemirror/state';
import {EditorView,Decoration,GutterMarker,gutter} from '@codemirror/view';
import {codeFolding} from '@codemirror/language';
export const activeSourceLine=StateEffect.define();
const activeLineField=StateField.define({create:()=>Decoration.none,update(value,tr){value=value.map(tr.changes);for(const e of tr.effects)if(e.is(activeSourceLine)){const at=Math.min(tr.state.doc.length,Math.max(0,e.value));value=Decoration.set([Decoration.line({class:'cm-linked-activeLine'}).range(tr.state.doc.lineAt(at).from)]);}return value;},provide:f=>EditorView.decorations.from(f)});
class HeadingMarker extends GutterMarker{constructor(closed){super();this.closed=closed;}eq(other){return other.closed===this.closed;}toDOM(){const n=document.createElement('span');n.textContent=this.closed?'▸':'▾';n.title='見出しを折りたたむ／開く';return n;}}
export function linkedEditor(getHeadings,toggle){return [activeLineField,codeFolding(),gutter({class:'cm-heading-gutter',lineMarker(view,line){const h=getHeadings().find(h=>h.lfFrom===line.from);return h&&h.foldTo>h.to?new HeadingMarker(h.closed):null;},domEventHandlers:{mousedown(view,line,event){const h=getHeadings().find(h=>h.lfFrom===line.from);if(!h)return false;event.preventDefault();toggle(h.from);return true;}}})];}
