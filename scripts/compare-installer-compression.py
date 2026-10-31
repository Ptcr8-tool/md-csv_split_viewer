"""Compare NSIS solid compressors against an already prepared installer payload.

This deliberately performs no packaging, signing, downloading, or installation.
Both temporary installers are deleted when the comparison ends.
"""
import argparse
import json
import os
from pathlib import Path
import statistics
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--payload', type=Path, default=ROOT / 'release' / 'MD-Split')
    parser.add_argument('--makensis', default=os.environ.get('MAKENSIS', 'makensis'))
    parser.add_argument('--runs', type=int, default=1, choices=range(1, 6))
    args = parser.parse_args()
    payload = args.payload.resolve()
    if not (payload / 'MD-Split.exe').is_file() or not (payload / 'WebView2Runtime' / 'msedgewebview2.exe').is_file():
        parser.error('A complete prepared payload containing MD-Split.exe and WebView2Runtime/msedgewebview2.exe is required.')
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    prefix = '/' if os.name == 'nt' else '-'
    results = {}
    with tempfile.TemporaryDirectory(prefix='mdsplit-compression-') as temp:
        for compressor in ('zlib', 'lzma'):
            sizes, times = [], []
            for run in range(args.runs):
                output = Path(temp) / f'{compressor}-{run}.exe'
                command = [args.makensis, prefix + 'V2', f'{prefix}DVERSION={version}',
                           f'{prefix}DPAYLOAD={payload}', f'{prefix}DOUTPUT={output}',
                           f'{prefix}DCOMPRESSOR={compressor}', str(ROOT / 'installer' / 'MD-Split.nsi')]
                started = time.perf_counter()
                subprocess.run(command, cwd=ROOT, check=True)
                times.append(time.perf_counter() - started)
                sizes.append(output.stat().st_size)
                output.unlink()
            results[compressor] = {'bytes': sizes, 'seconds': [round(t, 3) for t in times],
                                   'median_seconds': round(statistics.median(times), 3)}
    print(json.dumps({'version': version, 'runs': args.runs, 'results': results}, indent=2))


if __name__ == '__main__':
    main()
