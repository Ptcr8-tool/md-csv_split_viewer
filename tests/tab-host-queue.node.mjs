import test from 'node:test';
import assert from 'node:assert/strict';
import {createTabHostQueue} from '../src/tab-host-queue.js';

test('native opens wait for handoff, retain order, and keep the source window open',async()=>{
  let lock={id:'moving'};const seen=[];
  const queue=createTabHostQueue({locked:()=>lock,receiving:()=>null,dispatch:async e=>seen.push(e.type)});
  await queue.handle({type:'files-opened',documents:[{id:'other'}]});
  await queue.handle({type:'new-document',document:{id:'new'}});
  await queue.handle({type:'activate-document',id:'other'});
  await queue.handle({type:'file-changed',document:{id:'moving'}});
  assert.deepEqual(seen,[]);assert.equal(queue.hasPendingOpen(),true);
  await queue.flush();assert.deepEqual(seen,[]);
  lock=null;await queue.flush();assert.deepEqual(seen,['files-opened','new-document','activate-document']);
  assert.equal(queue.hasPendingOpen(),false);
});

test('the target may receive the transferred document while other opens remain queued',async()=>{
  let target={id:'moving'};const seen=[];
  const queue=createTabHostQueue({locked:()=>target,receiving:()=>target,dispatch:async e=>seen.push(e.documents?.map(d=>d.id)||e.type)});
  await queue.handle({type:'files-opened',documents:[{id:'moving'},{id:'unrelated'}]});
  await queue.handle({type:'new-document',document:{id:'another'}});
  assert.deepEqual(seen,[['moving']]);assert.equal(queue.hasPendingOpen(),true);
  target=null;await queue.flush();assert.deepEqual(seen,[['moving'],['unrelated'],'new-document']);
});

test('events arriving during an asynchronous flush retain arrival order',async()=>{
  let lock={id:'x'},release;const seen=[];const wait=new Promise(resolve=>release=resolve);
  const queue=createTabHostQueue({locked:()=>lock,receiving:()=>null,dispatch:async e=>{seen.push(e.id);if(e.id===1)await wait;}});
  await queue.handle({type:'activate-document',id:1});await queue.handle({type:'activate-document',id:2});
  lock=null;const flushing=queue.flush();await queue.handle({type:'activate-document',id:3});release();await flushing;
  assert.deepEqual(seen,[1,2,3]);
});
