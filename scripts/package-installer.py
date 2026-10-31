"""Build one complete offline setup executable. No credentials are embedded."""
from pathlib import Path
import hashlib,json,os,shutil,subprocess,urllib.request

root=Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
runtime=json.loads((root/'installer/runtime.json').read_text(encoding='utf-8'))
build=root/'release';build.mkdir(exist_ok=True)
def run(args,**kwargs):subprocess.run([str(x) for x in args],check=True,cwd=root,**kwargs)
def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for part in iter(lambda:f.read(1024*1024),b''):h.update(part)
    return h.hexdigest()
runtime_dir=os.environ.get('MDSPLIT_RUNTIME')
if not runtime_dir:
    cache=build/'runtime-cache';cache.mkdir(exist_ok=True);cab=cache/'runtime.cab'
    if not cab.exists() or sha(cab)!=runtime['sha256']:
        if not runtime['url'].startswith('https://msedge.sf.dl.delivery.mp.microsoft.com/'):raise SystemExit('Unexpected Microsoft distribution host')
        with urllib.request.urlopen(runtime['url'],timeout=120) as response,cab.open('wb') as output:shutil.copyfileobj(response,output)
    if cab.stat().st_size!=runtime['bytes'] or sha(cab)!=runtime['sha256']:raise SystemExit('WebView2 checksum mismatch')
    extracted=cache/'extracted';extracted.mkdir(exist_ok=True)
    if os.name=='nt':run([str(Path(os.environ['SystemRoot'])/'System32/expand.exe'),'-F:*',cab,extracted])
    else:run([os.environ.get('CABEXTRACT','cabextract'),'-q','-d',extracted,cab])
    matches=list(extracted.rglob('msedgewebview2.exe'))
    if len(matches)!=1:raise SystemExit('Unexpected runtime layout')
    runtime_dir=matches[0].parent
runtime_dir=Path(runtime_dir).resolve()
if not (runtime_dir/'msedgewebview2.exe').is_file():raise SystemExit('Fixed runtime folder is required')
payload=Path(os.environ.get('MDSPLIT_PAYLOAD',str(build/'MD-Split'))).resolve()
if not (payload/'MD-Split.exe').exists():raise SystemExit('Run npm run publish:win before packaging')
payload_runtime=payload/'WebView2Runtime'
# An isolated staging directory can reference an existing runtime to avoid a
# second 930 MB copy. Ordinary independent staging directories still copy it.
if not (payload_runtime.exists() and os.path.samefile(runtime_dir,payload_runtime)):
    shutil.copytree(runtime_dir,payload_runtime,dirs_exist_ok=True)
for filename in ['THIRD_PARTY_NOTICES.txt','README.md','SECURITY.md','VALIDATION.md','CHANGELOG.md']:
    shutil.copy2(root/filename,payload/filename)
shutil.copytree(root/'examples',payload/'Examples',dirs_exist_ok=True)
shutil.copytree(root/'licenses',payload/'Licenses',dirs_exist_ok=True)
if (root/'docs/screenshots').is_dir():shutil.copytree(root/'docs/screenshots',payload/'docs/screenshots',dirs_exist_ok=True)
# Keep the release guide linked from the bundled README available offline.
docs=payload/'docs';docs.mkdir(exist_ok=True)
shutil.copy2(root/'docs/Releasing.md',docs/'Releasing.md')
output_dir=Path(os.environ.get('MDSPLIT_SETUP_DIR',str(build))).resolve();output_dir.mkdir(parents=True,exist_ok=True)
setup=output_dir/f'MD-Split-{version}-Setup.exe'
option='/' if os.name=='nt' else '-'
run([os.environ.get('MAKENSIS','makensis'),option+'V2',f'{option}DVERSION={version}',f'{option}DPAYLOAD={payload}',f'{option}DOUTPUT={setup}',root/'installer/MD-Split.nsi'])
manifest={'repository':'Ptcr8-tool/md-csv_split_viewer','version':version,'assetName':setup.name,'sha256':sha(setup),'size':setup.stat().st_size}
manifest_file=output_dir/'update-manifest.json';manifest_file.write_text(json.dumps(manifest,separators=(',',':'))+'\n',encoding='utf-8')
key=os.environ.get('MDSPLIT_SIGNING_KEY_PATH')
if key:
    # Verify the key corresponds to the pinned public key before signing.
    result=subprocess.run(['openssl','pkey','-in',key,'-pubout'],check=True,capture_output=True)
    if b''.join(result.stdout.splitlines())!=b''.join((root/'native/update-public.pem').read_bytes().splitlines()):raise SystemExit('Signing key does not match the application public key')
    run(['openssl','dgst','-sha256','-sign',key,'-sigopt','rsa_padding_mode:pss','-sigopt','rsa_pss_saltlen:digest','-out',output_dir/'update-manifest.sig',manifest_file])
    run(['openssl','dgst','-sha256','-verify',root/'native/update-public.pem','-signature',output_dir/'update-manifest.sig','-sigopt','rsa_padding_mode:pss','-sigopt','rsa_pss_saltlen:digest',manifest_file])
else:print('Setup built. A matching private key is required before publishing an automatic update.')
(output_dir/'SHA256SUMS.txt').write_text(manifest['sha256']+'  '+setup.name+'\n',encoding='utf-8')
print(setup)
