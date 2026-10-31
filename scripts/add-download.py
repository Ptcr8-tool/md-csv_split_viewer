"""Add a download row only after the release and assets have been verified."""
from pathlib import Path
import argparse,re

parser=argparse.ArgumentParser()
parser.add_argument('--published',action='store_true',help='Confirm the public release and its assets have been verified')
parser.add_argument('version')
parser.add_argument('summary',nargs='*')
args=parser.parse_args()
if not args.published:raise SystemExit('Verify the public release and its assets first, then use --published')
version=args.version
if not re.fullmatch(r'(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})',version):raise SystemExit('Use a three-part stable version')
summary=' '.join(args.summary).replace('|','／').replace('\n',' ').replace('\r',' ') or '公開版'
readme=Path(__file__).resolve().parents[1]/'README.md'
content=readme.read_text(encoding='utf-8');start=content.index('<!-- downloads:start -->');end=content.index('<!-- downloads:end -->')
row=f'| {version} | Windows 10／11・x64 | [⬇ Setup.exe](https://github.com/Ptcr8-tool/md-csv_split_viewer/releases/download/v{version}/MD-Split-{version}-Setup.exe) | {summary} |'
table=content[start:end];pattern=r'^\| '+re.escape(version)+r' \|.*$'
if re.search(pattern,table,re.M):table=re.sub(pattern,lambda _:row,table,flags=re.M)
else:
    marker='|---|---|---|---|\n'
    if marker not in table:raise SystemExit('Expected the four-column download table')
    table=table.replace(marker,marker+row+'\n',1)
content=content[:start]+table+content[end:]
content=content.replace('**公開配布の準備中です。現在、この公開用ページからダウンロードできるセットアップはありません。**','**下のバージョン一覧から、確認済みの公開セットアップをダウンロードできます。**')
content=content.replace('公開後は、バージョンごとの','バージョンごとの')
readme.write_text(content,encoding='utf-8')
