import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const run=(command,args,options={})=>{const r=spawnSync(command,args,{cwd:root,stdio:'inherit',...options});if(r.status!==0)process.exit(r.status||1);};
// npm supplies the actual JavaScript CLI path when this is run as an npm script.
// Running it with Node avoids shell-quoting arguments and lets dotnet run directly.
const npmCli=process.env.npm_execpath;
if(npmCli&&/\.[cm]?js$/i.test(npmCli))run(process.execPath,[npmCli,'run','build']);
else if(process.platform==='win32')run(process.env.ComSpec||'cmd.exe',['/d','/s','/c','npm.cmd run build']);
else run('npm',['run','build']);
rmSync(path.join(root,'release','MD-Split'),{recursive:true,force:true});
run(process.env.MDSPLIT_DOTNET||'dotnet',['publish','native/MdSplit.csproj','-c','Release','-r','win-x64','--self-contained','true','-o','release/MD-Split']);
console.log('Windows application:',path.join(root,'release','MD-Split','MD-Split.exe'));
