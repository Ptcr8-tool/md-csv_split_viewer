// Recovery writes are serialized so an older, slower snapshot cannot overwrite
// a newer one. Only acknowledged document states are eligible for reuse.
export class RecoveryWriter {
  constructor({host, documents, ensureRegistered, mode, activeId, isDesktop}) {
    Object.assign(this,{host,documents,ensureRegistered,mode,activeId,isDesktop});
    this.acknowledged=new Map();
    this.queue=Promise.resolve();
  }
  exclusive(action) {
    const job=this.queue.then(action);
    this.queue=job.catch(()=>{});
    return job;
  }
  write(reason) {
    return this.exclusive(async()=>{
      const snapshot=[...this.documents()];
      await Promise.all(snapshot.map(this.ensureRegistered));
      const current=this.documents();
      const values=snapshot.filter(d=>current.includes(d)).map(d=>d.serialize());
      const metadata={mode:this.mode(),activeId:this.activeId()};
      if(reason)metadata.reason=reason;
      if(!this.isDesktop) {
        await this.host('recovery.write',{documents:values,...metadata});
        return;
      }
      const unchanged=(a,b)=>a && Object.keys(b).every(key=>Object.is(a[key],b[key])) && Object.keys(a).length===Object.keys(b).length;
      const changed=values.filter(value=>!unchanged(this.acknowledged.get(value.id),value));
      await this.host('recovery.write',{documents:changed,documentIds:values.map(value=>value.id),...metadata});
      this.acknowledged=new Map(values.map(value=>[value.id,value]));
    });
  }
}
