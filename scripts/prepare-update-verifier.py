"""Fetch a pinned GitHub CLI and TUF-verified roots before publishing the app."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import tempfile
import urllib.request
import zipfile

root = Path(__file__).resolve().parents[1]
pin = json.loads((root / 'installer/update-verifier.json').read_text(encoding='utf-8'))
repository = 'Ptcr8-tool/md-csv_split_viewer'
workflow = repository + '/.github/workflows/windows-release.yml'
if os.name != 'nt':
    raise SystemExit('Preparing the Windows verifier requires a Windows build host.')
if not pin['url'].startswith('https://github.com/cli/cli/releases/download/'):
    raise SystemExit('Unexpected GitHub CLI distribution URL.')
target = root / 'native/obj/update-verifier'
target.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='md-split-build-') as temp:
    temp = Path(temp)
    archive = temp / 'gh.zip'
    digest = hashlib.sha256()
    total = 0
    with urllib.request.urlopen(pin['url'], timeout=120) as response, archive.open('wb') as output:
        while block := response.read(1024 * 1024):
            total += len(block)
            if total > pin['max_bytes']:
                raise SystemExit('GitHub CLI download is too large.')
            digest.update(block)
            output.write(block)
    if digest.hexdigest() != pin['sha256']:
        raise SystemExit('GitHub CLI archive checksum mismatch.')
    with zipfile.ZipFile(archive) as source:
        exe = [name for name in source.namelist() if name.endswith('/bin/gh.exe')]
        licenses = [name for name in source.namelist() if Path(name).name.lower() in ('license', 'license.txt')]
        if len(exe) != 1 or not licenses:
            raise SystemExit('Unexpected GitHub CLI archive layout.')
        shortest = min(len(Path(name).parts) for name in licenses)
        licenses = [name for name in licenses if len(Path(name).parts) == shortest]
        if len(licenses) != 1 or not 0 < source.getinfo(licenses[0]).file_size <= 128 * 1024 or not 0 < source.getinfo(exe[0]).file_size <= 100 * 1024 * 1024:
            raise SystemExit('Unexpected GitHub CLI archive contents.')
        (target / 'gh.exe').write_bytes(source.read(exe[0]))
        (target / 'LICENSE.txt').write_bytes(source.read(licenses[0]))
    env = {key: os.environ[key] for key in ('SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'LOCALAPPDATA') if key in os.environ}
    env.update(GH_CONFIG_DIR=str(temp / 'config'), GH_NO_UPDATE_NOTIFIER='1', GH_NO_EXTENSION_UPDATE_NOTIFIER='1', GH_PROMPT_DISABLED='1', GH_HOST='github.com')
    cli = str(target / 'gh.exe')
    version = subprocess.run([cli, '--version'], env=env, capture_output=True, text=True, check=True, timeout=30).stdout
    if not version.startswith('gh version ' + pin['version']):
        raise SystemExit('GitHub CLI version mismatch.')
    roots = subprocess.run([cli, 'attestation', 'trusted-root'], env=env, capture_output=True, check=True, timeout=120).stdout
    if not roots.strip() or len(roots) > 2_000_000:
        raise SystemExit('Could not obtain Sigstore trust roots.')
    for line in roots.splitlines():
        if line.strip():
            json.loads(line)
    (target / 'trusted_root.jsonl').write_bytes(roots)
    hash_file = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    data = {'repository': repository, 'repository_id': pin['repository_id'], 'workflow': workflow,
            'gh_sha256': hash_file(target / 'gh.exe'), 'trusted_root_sha256': hash_file(target / 'trusted_root.jsonl')}
    (target / 'pins.json').write_text(json.dumps(data, separators=(',', ':')) + '\n', encoding='utf-8')
    probe = temp / 'invalid.json'
    probe.write_text('{}', encoding='ascii')
    result = subprocess.run([cli, 'attestation', 'verify', cli, '--bundle', str(probe), '--custom-trusted-root', str(target / 'trusted_root.jsonl'), '--repo', repository], env=env, capture_output=True, timeout=30)
    output = (result.stdout + result.stderr).lower()
    if result.returncode == 0 or any(s in output for s in (b'gh auth login', b'set the gh_token', b'authentication required', b'not logged into')):
        raise SystemExit('Offline verifier requires authentication or accepted an invalid bundle.')
print('Prepared pinned update verifier and trust roots.')
