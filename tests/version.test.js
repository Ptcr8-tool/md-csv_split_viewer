import {describe,it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateVersions} from '../scripts/check-version.mjs';

describe('release version consistency',()=>{
  it('accepts matching versions and rejects a stale installer version',()=>{
    const dir=mkdtempSync(path.join(os.tmpdir(),'md-version-'));
    try{
      for(const folder of ['native','installer'])mkdirSync(path.join(dir,folder));
      for(const file of ['package.json','package-lock.json','native/MdSplit.csproj','native/UpdateSecurity.cs','installer/MD-Split.nsi'])writeFileSync(path.join(dir,file),readFileSync(new URL('../'+file,import.meta.url)));
      expect(validateVersions(dir)).toBe(JSON.parse(readFileSync(path.join(dir,'package.json'),'utf8')).version);
      const installer=path.join(dir,'installer/MD-Split.nsi');
      writeFileSync(installer,readFileSync(installer,'utf8').replace(/!define VERSION "[^"]+"/,'!define VERSION "0.0.0"'));
      expect(()=>validateVersions(dir)).toThrow(/Version mismatch/);
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
});
