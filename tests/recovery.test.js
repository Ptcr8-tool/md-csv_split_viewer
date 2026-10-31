import {describe,it,expect} from 'vitest';
import {RecoveryWriter} from '../src/recovery.js';

const doc=(id,text)=>({id,text,savedText:text,encoding:'utf8',previewViewMode:'split',serialize(){return {id:this.id,text:this.text,savedText:this.savedText,encoding:this.encoding,previewViewMode:this.previewViewMode}}});
function setup(){
  const docs=[doc('a','first'),doc('b','second')],calls=[];
  let active='a',mode='normal';
  const writer=new RecoveryWriter({host:async(method,args)=>{calls.push({method,args});return true;},documents:()=>docs,ensureRegistered:async()=>{},mode:()=>mode,activeId:()=>active,isDesktop:true});
  return {docs,calls,writer,setActive:value=>active=value,setMode:value=>mode=value};
}
describe('incremental recovery snapshots',()=>{
  it('sends only changed documents and always keeps order and presentation',async()=>{
    const {docs,calls,writer,setActive,setMode}=setup();
    await writer.write();
    expect(calls[0].args.documents.map(d=>d.id)).toEqual(['a','b']);
    docs[0].text='edited';setActive('b');setMode('discord');
    await writer.write();
    expect(calls[1].args.documents).toEqual([expect.objectContaining({id:'a',text:'edited'})]);
    expect(calls[1].args).toMatchObject({documentIds:['a','b'],activeId:'b',mode:'discord'});
    docs[1].encoding='utf16le';await writer.write('update');
    expect(calls[2].args.documents.map(d=>d.id)).toEqual(['b']);
    expect(calls[2].args.reason).toBe('update');
  });
  it('does not acknowledge a failed write and retries its whole missing delta',async()=>{
    const {docs,calls,writer}=setup();await writer.write();
    const host=writer.host;let fail=true;
    writer.host=async(...args)=>{if(fail){fail=false;throw Error('disk full');}return host(...args);};
    docs[0].text='preserve me';await expect(writer.write()).rejects.toThrow('disk full');
    await writer.write();expect(calls.at(-1).args.documents[0].text).toBe('preserve me');
  });
  it('serializes pending writes and closes before a later snapshot is taken',async()=>{
    const {docs,calls,writer}=setup();let releaseFirst,signalFirst;
    const enteredFirst=new Promise(resolve=>signalFirst=resolve);
    const original=writer.host;
    let count=0;
    writer.host=async(...args)=>{if(count++===0){signalFirst();await new Promise(resolve=>releaseFirst=resolve);}return original(...args);};
    const first=writer.write();await enteredFirst;
    const close=writer.exclusive(async()=>{docs.splice(0,1);});
    const next=writer.write();releaseFirst();await Promise.all([first,close,next]);
    expect(calls.at(-1).args.documentIds).toEqual(['b']);
  });
  it('keeps full snapshots for the browser fallback',async()=>{
    const {calls,writer}=setup();writer.isDesktop=false;await writer.write();await writer.write();
    expect(calls[1].args.documents.map(d=>d.id)).toEqual(['a','b']);expect(calls[1].args).not.toHaveProperty('documentIds');
  });
});
