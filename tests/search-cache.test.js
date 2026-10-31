import {beforeEach,describe,expect,it,vi} from 'vitest';

const {host}=vi.hoisted(()=>({host:vi.fn()}));
vi.mock('../src/bridge.js',()=>({host,isDesktop:true}));
import {searchText} from '../src/search.js';

describe('desktop search text cache',()=>{
  beforeEach(()=>host.mockReset());
  it('sends the content once, then reuses its token while the text is unchanged',async()=>{
    const d={id:crypto.randomUUID(),revision:4},req={text:'a\r\nb',pattern:'a',regex:true};
    host.mockResolvedValue({count:1,from:0,to:1});
    await searchText(req,d);await searchText(req,d);
    expect(host).toHaveBeenCalledTimes(2);
    expect(host.mock.calls[0][1].text).toBe(req.text);
    expect(host.mock.calls[1][1]).not.toHaveProperty('text');
    expect(host.mock.calls[1][1].cacheToken).toBe(host.mock.calls[0][1].cacheToken);
    expect(host.mock.calls[1][1].regex).toBe(true);
  });
  it('resends after eviction and continues to use the native result',async()=>{
    const d={id:crypto.randomUUID(),revision:0},req={text:'old old',pattern:'old',action:'all'};
    host.mockResolvedValueOnce({count:2}).mockResolvedValueOnce({cacheMiss:true}).mockResolvedValueOnce({count:2,text:'new new'});
    await searchText(req,d);const result=await searchText(req,d);
    expect(result.text).toBe('new new');expect(host.mock.calls[1][1]).not.toHaveProperty('text');
    expect(host.mock.calls[2][1].text).toBe('old old');
    expect(host.mock.calls[2][1].cacheToken).toBe(host.mock.calls[1][1].cacheToken);
  });
  it('uses a new token for revisions and for external changes with a reused revision',async()=>{
    const d={id:crypto.randomUUID(),revision:0};host.mockResolvedValue({count:0});
    await searchText({text:'first'},d);d.revision=1;await searchText({text:'second'},d);
    await searchText({text:'external'},d);
    const calls=host.mock.calls.map(([,args])=>args);
    expect(new Set(calls.map(a=>a.cacheToken)).size).toBe(3);
    expect(calls.map(a=>a.text)).toEqual(['first','second','external']);
  });
  it('resends after a failed search and never treats an error as a cached result',async()=>{
    const d={id:crypto.randomUUID(),revision:0},req={text:'abc',pattern:'['};
    host.mockRejectedValueOnce(new Error('正規表現の書き方を確認してください。')).mockResolvedValueOnce({count:0});
    await expect(searchText(req,d)).rejects.toThrow('正規表現');await searchText(req,d);
    expect(host.mock.calls[1][1].text).toBe('abc');
  });
});
