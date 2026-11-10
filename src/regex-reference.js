import {currentUiLanguage} from './i18n.js';
// The search pattern uses .NET on Windows and JavaScript in the browser.
// Replacement templates are expanded by this application in both versions.
export const regexReference = [
  {title:'検索：文字と文字クラス',rows:[
    ['文字','入力した文字そのものに一致します。'],
    ['.', '任意の1文字。通常、Windows版はLFを、ブラウザー版は改行文字を除きます。'],
    ['[abc]', 'a・b・cのいずれか1文字。'],
    ['[^abc]', 'a・b・c以外の1文字。'],
    ['[a-z]', '指定した範囲の1文字。'],
    [String.raw`\d / \D`, '数字 / 数字以外。Windows版はUnicodeの数字も対象、ブラウザー版は半角数字です。'],
    [String.raw`\w / \W`, '単語を構成する文字 / それ以外。対象となる文字はWindows版とブラウザー版で異なります。'],
    [String.raw`\s / \S`, '空白文字（改行やTabを含む）/ 空白文字以外。'],
    [String.raw`[\s\S]`, '改行を含む任意の1文字。'],
    [String.raw`\r / \n / \r\n`, 'CR / LF / CRLFの改行文字。'],
    [String.raw`\t / \v / \f`, 'Tab / 垂直Tab / 改ページ。'],
    [String.raw`\xNN / \uNNNN / \cX`, '16進2桁 / 16進4桁 / 制御文字を指定。'],
    [String.raw`\0`, 'NULL文字。'],
    [String.raw`[\b]`, '文字クラス内ではバックスペース文字。'],
    [String.raw`\.` + ' など', '記号の前にバックスラッシュを付けると、特別な意味を持つ記号そのものを探せます。'],
    [String.raw`\\`, 'バックスラッシュそのもの。']
  ]},
  {title:'検索：繰り返し',rows:[
    ['* / + / ?', '直前の表記を0回以上 / 1回以上 / 0回または1回繰り返します。'],
    ['{n} / {n,} / {n,m}', '直前の表記をn回 / n回以上 / n〜m回繰り返します。'],
    ['*? / +? / ??', '繰り返しを可能な限り短くします。'],
    ['{n}? / {n,}? / {n,m}?', '回数指定の繰り返しを可能な限り短くします。']
  ]},
  {title:'検索：位置と前後の条件',rows:[
    ['^ / $', '行の先頭 / 行の末尾。検索は複数行モードです。CRLFの行末ではCRが残る場合があります。'],
    [String.raw`\b / \B`, '単語の境界 / 単語の境界以外。'],
    ['(?=式) / (?!式)', '直後が式に一致する / 一致しない位置。'],
    ['(?<=式) / (?<!式)', '直前が式に一致する / 一致しない位置。']
  ]},
  {title:'検索：グループ・選択',rows:[
    ['式1|式2', 'いずれかの式に一致します。'],
    ['(式)', '一致部分を番号付きグループとして記憶します。'],
    ['(?:式)', 'グループ化しますが、一致部分を記憶しません。'],
    ['(?<name>式)', '一致部分を名前付きグループとして記憶します。'],
    [String.raw`\1 ～ \99`, '検索式の中で、番号付きグループと同じ文字を探します。'],
    [String.raw`\k<name>`, '検索式の中で、名前付きグループと同じ文字を探します。']
  ]},
  {title:'検索：Windows版で使える表記',windowsOnly:true,rows:[
    [String.raw`\p{分類} / \P{分類}`, 'Unicodeの分類・ブロックに含まれる / 含まれない文字。'],
    ['[文字集合-[除く文字]]', '文字集合から別の文字集合を除きます。'],
    [String.raw`\A / \z / \Z / \G`, '文書の先頭 / 厳密な末尾 / 末尾または最後のLFの直前 / 前回の一致の終了位置。'],
    [String.raw`\a / \e`, 'ベル文字 / エスケープ文字。'],
    [String.raw`\nnn`, '8進数の文字コード。数字は後方参照として解釈される場合があります。'],
    ["(?'name'式) / \\k'name'", '別の書き方の名前付きグループ / その後方参照。'],
    ['(?<name1-name2>式)', 'バランスグループ。'],
    ['(?>式)', 'アトミックグループ。一度一致した部分を再評価しません。'],
    ['(?(名前)式1|式2)', '指定グループが一致したかに応じて式を切り替えます。'],
    ['(?(条件式)式1|式2)', '条件式に応じて式を切り替えます。'],
    ['(?imnsx-imnsx) / (?imnsx-imnsx:式)', '大文字小文字・複数行・キャプチャ・単一行・空白無視を設定 / グループ内だけで設定。'],
    ['(?#コメント)', '検索式中のコメント。']
  ]},
  {title:'置換欄で使える表記',rows:[
    ['$& / $0', '一致した文字列全体。'],
    [String.raw`$1 ～ $99 / \1 ～ \99`, '番号付きグループの内容。'],
    ['${name}', '名前付きグループの内容。名前は文字・数字・アンダースコアを使用します。'],
    ['$$', '半角のドル記号そのもの。'],
    [String.raw`\r / \n / \t`, String.raw`CR / LF / Tabを挿入します。CRLFは \r\n と入力します。`],
    [String.raw`\\`, 'バックスラッシュそのもの。'],
    ['空欄', '一致した文字列を削除します。']
  ]}
];

// Keep syntax and engine-specific notes aligned with the Japanese reference.
const englishTitles=['Search: characters and classes','Search: repetition','Search: positions and lookaround','Search: groups and alternation','Search: Windows-only syntax','Replacement syntax'];
const englishDescriptions=[
  ['Matches the literal character.','Any character; normally excludes LF on Windows and line terminators in the browser.','One of a, b, or c.','Any character except a, b, or c.','A character within the specified range.','Digit / non-digit. Windows includes Unicode digits; the browser matches ASCII digits.','Word character / non-word character. Character sets differ between Windows and browser.','Whitespace, including line breaks and tabs / non-whitespace.','Any character, including line breaks.','CR / LF / CRLF line endings.','Tab / vertical tab / form feed.','Two-digit hex / four-digit hex / control character.','NULL character.','Backspace within a character class.','Escape a special character to search for the character itself.','A literal backslash.'],
  ['Repeat the preceding expression zero or more / one or more / zero or one times.','Repeat the preceding expression n / at least n / n to m times.','Match as few repetitions as possible.','Match as few repetitions as possible within the specified range.'],
  ['Start / end of line. Multiline mode is enabled; CR may remain at the end of a CRLF line.','Word boundary / non-boundary.','Position followed by a matching / non-matching expression.','Position preceded by a matching / non-matching expression.'],
  ['Match either expression.','Capture a numbered group.','Group without capturing.','Capture a named group.','Match the same text as a numbered group.','Match the same text as a named group.'],
  ['Character in / outside a Unicode category or block.','Subtract one set of characters from another.','Start / absolute end / end or before final LF / end of previous match.','Bell / escape character.','Octal character code; digits can be interpreted as a backreference.','Alternative named-group syntax / its backreference.','Balancing group.','Atomic group; matched text is not reconsidered.','Choose an expression according to whether a group matched.','Choose an expression according to a condition.','Set case, multiline, capture, single-line or whitespace options / set them within a group.','A comment in the search expression.'],
  ['The entire match.','Contents of a numbered group.','Contents of a named group. Names use letters, digits and underscores.','A literal dollar sign.',String.raw`Insert CR / LF / tab. Enter \r\n for CRLF.`,'A literal backslash.','Delete the matched text.']
];
const englishSyntax={ '文字':'character', '空欄':'empty', '式1|式2':'expression1|expression2', '(式)':'(expression)', '(?:式)':'(?:expression)', '(?<name>式)':'(?<name>expression)', '(?=式) / (?!式)':'(?=expression) / (?!expression)', '(?<=式) / (?<!式)':'(?<=expression) / (?<!expression)' };
const englishReference=regexReference.map((group,i)=>({...group,title:englishTitles[i],rows:group.rows.map(([syntax],j)=>[englishSyntax[syntax]||syntax.replaceAll('式','expression').replaceAll('名前','name').replaceAll('条件','condition').replaceAll('分類','category').replaceAll('文字集合','set').replaceAll('除く文字','excluded').replaceAll(' など',' etc.').replaceAll(' ～ ',' to '),englishDescriptions[i][j]])}));
export function getRegexReference(){return currentUiLanguage()==='en'?englishReference:regexReference;}
