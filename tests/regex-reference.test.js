import {describe,it,expect} from 'vitest';
import {regexSamples,runSearch} from '../src/search-core.js';

describe('連続改行をまとめる使用例',()=>{
  it('retains the first complete line ending for every short CR/LF combination',()=>{
    const sample=regexSamples.find(item=>item.label==='連続する改行を1つに');
    expect(sample).toBeDefined();
    for(let length=1;length<=6;length++)for(let bits=0;bits<2**length;bits++){
      let raw='';for(let i=0;i<length;i++)raw+=(bits>>i)&1?'\r':'\n';
      const breaks=[];
      for(let i=0;i<raw.length;i++){
        if(raw[i]==='\r'&&raw[i+1]==='\n'){breaks.push('\r\n');i++;}
        else breaks.push(raw[i]);
      }
      const result=runSearch({text:'a'+raw+'b',pattern:sample.pattern,replacement:sample.replacement,regex:true,action:'all'});
      if(breaks.length===1)expect(result,{raw:JSON.stringify(raw)}).toEqual({count:0});
      else{
        expect(result.count,{raw:JSON.stringify(raw)}).toBe(1);
        expect(result.text,{raw:JSON.stringify(raw)}).toBe('a'+breaks[0]+'b');
      }
    }
  });
});
