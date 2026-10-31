import { HighlightStyle } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

// Markdown delimiters are editable content. Keep them readable in both themes
// rather than using CodeMirror's light-only default syntax palette.
export const sourceHighlightStyle=HighlightStyle.define([
  {tag:tags.heading,fontWeight:'bold'},
  {tag:tags.emphasis,fontStyle:'italic'},
  {tag:tags.strong,fontWeight:'bold'},
  {tag:tags.strikethrough,textDecoration:'line-through'},
  {tag:[tags.link,tags.url],color:'var(--syntax-link)',textDecoration:'underline'},
  {tag:[tags.monospace,tags.labelName,tags.string,tags.character,tags.escape,tags.number,tags.literal],color:'var(--syntax-code)'},
  {tag:[tags.comment,tags.meta],color:'var(--muted)'},
  {tag:[tags.keyword,tags.bool,tags.atom,tags.modifier],color:'var(--syntax-keyword)'},
  {tag:[tags.tagName,tags.attributeName,tags.typeName,tags.className,tags.namespace],color:'var(--syntax-link)'},
  {tag:[tags.operator,tags.punctuation],color:'var(--syntax-markup)'},
  {tag:[tags.processingInstruction,tags.contentSeparator],class:'md-markup'}
]);

export const sourceEditorTheme=dark=>EditorView.theme({}, {dark});
