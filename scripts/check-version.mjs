import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=(dir,file)=>readFileSync(path.join(dir,file),'utf8');
const capture=(text,pattern,label)=>{
  const matches=[...text.matchAll(pattern)];
  if(matches.length!==1)throw new Error(`${label}: expected exactly one version declaration`);
  return matches[0][1];
};

export function validateVersions(dir=root){
  const pkg=JSON.parse(read(dir,'package.json'));
  const lock=JSON.parse(read(dir,'package-lock.json'));
  const versions={
    'package.json':pkg.version,
    'package-lock.json':lock.version,
    'package-lock.json packages[""]':lock.packages?.['']?.version,
    'native/MdSplit.csproj':capture(read(dir,'native/MdSplit.csproj'),/<Version>\s*([^<\s]+)\s*<\/Version>/g,'native/MdSplit.csproj'),
    'native/UpdateSecurity.cs':capture(read(dir,'native/UpdateSecurity.cs'),/\bconst\s+string\s+Version\s*=\s*"([^"]+)"/g,'native/UpdateSecurity.cs'),
    'installer/MD-Split.nsi':capture(read(dir,'installer/MD-Split.nsi'),/^\s*!define\s+VERSION\s+"([^"]+)"\s*$/gm,'installer/MD-Split.nsi')
  };
  if(typeof pkg.version!=='string'||!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(pkg.version))throw new Error('package.json: expected a numeric major.minor.patch version');
  const mismatches=Object.entries(versions).filter(([,value])=>value!==pkg.version);
  if(mismatches.length)throw new Error('Version mismatch: '+mismatches.map(([name,value])=>`${name}=${String(value)}`).join(', '));
  return pkg.version;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(`Versions match: ${validateVersions()}`);}catch(error){console.error(error.message);process.exitCode=1;}
}
