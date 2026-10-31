import {describe,it,expect} from 'vitest';
import {DEFAULT_WHITESPACE_STYLES,normalizeWhitespaceStyles,applyWhitespaceStyles} from '../src/whitespace.js';

describe('whitespace appearance settings',()=>{
  it('uses subtle independent defaults without sharing mutable values',()=>{
    const styles=normalizeWhitespaceStyles();expect(styles).toEqual(DEFAULT_WHITESPACE_STYLES);
    expect(Object.values(styles).every(style=>style.opacity<0.7&&style.opacity>=0.1)).toBe(true);
    styles.tab.color='#123456';expect(normalizeWhitespaceStyles().tab.color).toBe('#87909a');
  });
  it('rejects CSS injection and invalid values while retaining valid individual styles',()=>{
    expect(normalizeWhitespaceStyles({lineBreak:{color:'red;display:none',opacity:NaN},wideSpace:{color:'#ABCDEF',opacity:2},tab:{color:'#123456',opacity:-3},space:{color:'url(https://example.com)',opacity:'0.5'}})).toEqual({lineBreak:DEFAULT_WHITESPACE_STYLES.lineBreak,wideSpace:{color:'#abcdef',opacity:1},tab:{color:'#123456',opacity:0.1},space:DEFAULT_WHITESPACE_STYLES.space});
    expect(normalizeWhitespaceStyles(null)).toEqual(DEFAULT_WHITESPACE_STYLES);
    expect(normalizeWhitespaceStyles({tab:null})).toEqual(DEFAULT_WHITESPACE_STYLES);
  });
  it('applies only known color and opacity properties shared by both editor panes',()=>{
    const properties=new Map(),root={style:{setProperty:(name,value)=>properties.set(name,value)}};
    const result=applyWhitespaceStyles({whitespaceStyles:{tab:{color:'#AA2288',opacity:0.25}},unknown:'anything'},root);
    expect(result.tab).toEqual({color:'#aa2288',opacity:0.25});expect(properties.size).toBe(8);
    expect(properties.get('--ws-tab-color')).toBe('#aa2288');expect(properties.get('--ws-tab-opacity')).toBe('0.25');expect(properties.get('--ws-line-break-opacity')).toBe('0.45');
    expect([...properties.keys()].every(key=>/^--ws-(line-break|wide-space|tab|space)-(color|opacity)$/.test(key))).toBe(true);
  });
});
