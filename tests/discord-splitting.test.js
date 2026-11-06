import {describe,it,expect} from 'vitest';
import {splitDiscord,splitDiscordAt,normalizeDiscordBreaks,clipboardLength} from '../src/discord.js';

describe('Discord split boundaries',()=>{
  it('does not split a message that fits, even when it contains several paragraphs',()=>{
    const text='見出し\n\n'+ '本文'.repeat(980)+'\n\n結び';
    expect(text.length).toBeLessThan(4000);
    const parts=splitDiscord(text,4000);
    expect(parts).toHaveLength(1);expect(parts[0].text).toBe(text);
  });
  it('avoids tiny fragments after an early paragraph when the rest fits',()=>{
    const text='冒頭\n\n'+'あ'.repeat(1940)+'\n\n'+'末'.repeat(80);
    const parts=splitDiscord(text,2000);
    expect(parts).toHaveLength(2);expect(parts[0].count).toBeGreaterThan(1300);
    expect(parts.map(p=>text.slice(p.from,p.to)).join('')).toBe(text);
  });
  it('does not add an extra message merely to use an earlier paragraph break',()=>{
    const text='あ'.repeat(1400)+'\n\n'+'い'.repeat(2398);
    const parts=splitDiscord(text,2000);
    expect(parts).toHaveLength(2);expect(parts.map(p=>text.slice(p.from,p.to)).join('')).toBe(text);
  });
  it('permits an intentionally oversized manual chunk and counts clipboard line endings',()=>{
    const text=('abc\n').repeat(20);const parts=splitDiscordAt(text,[],64);
    expect(parts).toHaveLength(1);expect(parts[0].over).toBe(true);
    expect(parts[0].count).toBe(clipboardLength(text));expect(parts[0].text).toBe(text);
  });
  it('reopens fenced code for custom breaks and preserves all original content',()=>{
    const text='始め\n```js\n'+('const value = 1;\n'.repeat(12))+'```\n終わり';
    const breaks=[text.indexOf('const value',20)+6,text.lastIndexOf('const value')];
    const parts=splitDiscordAt(text,breaks,2000);
    expect(parts).toHaveLength(3);
    expect(parts.map(p=>text.slice(p.from,p.to)).join('')).toBe(text);
    for(const part of parts)expect((part.text.match(/```/g)||[]).length%2).toBe(0);
  });
  it('snaps requested breaks away from emoji, CRLF, markup runs and fence headers',()=>{
    const text='a👩‍👩‍👧‍👦b\r\n```javascript\r\n**strong**\n```\nend';
    const emojiStart=text.indexOf('👩'),fence=text.indexOf('```'),bold=text.indexOf('**');
    const breaks=normalizeDiscordBreaks(text,[emojiStart+2,text.indexOf('\r')+1,fence+5,bold+1]);
    expect(breaks).not.toContain(emojiStart+2);expect(breaks).not.toContain(text.indexOf('\r')+1);
    expect(breaks).not.toContain(fence+5);expect(breaks).not.toContain(bold+1);
    expect(breaks.every(x=>x>0&&x<text.length)).toBe(true);
  });
});
