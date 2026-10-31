import {normalizeWhitespaceStyles} from './whitespace.js';
import {sourceWrapMode,sourceWrapColumn} from './source-wrap.js';
import './settings-panel.css';
import {normalizeFileTypeSettings,presentationCapabilities,presentationTypes} from './view-preference.js';
import {supportedTextExtensions} from './file-types.js';

const palettes=[['black','黒（標準）'],['green','緑'],['red','赤'],['blue','青'],['parchment','羊皮紙'],['parchment-texture','羊皮紙＋質感']];
const brightness=[
  ['light','ライト','<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>'],
  ['dark','ダーク','<path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z"/>'],
  ['system','システムに合わせる','<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>']
];
const marks=[
  {key:'lineBreak',suffix:'line-break',setting:'showLineBreaks',id:'setting-line-breaks',label:'改行',glyph:'↵'},
  {key:'wideSpace',suffix:'wide-space',setting:'showFullWidthSpaces',id:'setting-wide-spaces',label:'全角スペース',glyph:'□'},
  {key:'tab',suffix:'tab',setting:'showTabs',id:'setting-tabs',label:'Tab',glyph:'→'},
  {key:'space',suffix:'space',setting:'showSpaces',id:'setting-spaces',label:'半角スペース',glyph:'·'}
];
const pick=(value,choices,fallback)=>choices.includes(value)?value:fallback;
const formMarkup=`
<section class="settings-section settings-first"><h3>ウィンドウと画面</h3>
  <div class="settings-fields"><label class="field">次に開くファイル<select id="setting-layout"><option value="tabs">同じウィンドウのタブ</option><option value="windows">別ウィンドウ</option></select></label>
  </div><div class="settings-fields settings-type-fields"><label class="field">設定するファイル種類<select id="setting-file-kind" aria-label="設定するファイル種類"><option value="markdown">Markdown（.md）</option><option value="csv">CSV（.csv）</option><option value="tsv">TSV（.tsv）</option><option value="html">HTML（.html / .htm）</option></select></label><label class="field">編集画面の既定<select id="setting-view-mode"><option value="last">最後に選択したモード</option><option value="split">左右に並べる</option><option value="source">原文のみ</option><option value="preview">展開表示のみ</option></select></label></div>
  <p class="muted">表示の既定・見出しナビ・連動をファイル種類ごとに記憶します。通常は、その種類で最後に選択した表示を引き継ぎます。</p>
  <p class="muted" id="setting-type-note"></p>
  <label class="checkbox"><input id="setting-outline" type="checkbox">見出しナビゲーターを表示する</label>
  <label class="checkbox"><input id="setting-sync" type="checkbox">左右の表示位置を連動させる</label>
</section>
<section class="settings-section"><h3>終了と次回起動</h3>
  <div class="settings-fields"><label class="field">ウィンドウを閉じるとき<select id="setting-session-policy"><option value="clear">次回は新規ファイルで始める</option><option value="all">開いていた全タブを次回開く</option><option value="active">表示中のタブだけを次回開く</option></select></label>
  <label class="field">新規開始時のファイルの種類<select id="setting-startup-format"><option value="md">Markdown（.md）</option><option value="csv">CSV（.csv）</option><option value="txt">テキスト（.txt）</option><option value="html">HTML（.html）</option><option value="json">JSON（.json）</option><option value="tsv">TSV（.tsv）</option><option value="xml">XML（.xml）</option></select></label></div>
  <p class="muted">通常の×で閉じるときに適用します。「ファイル」メニューから終了方法を選ぶと、その回だけ設定より優先します。未保存の変更は終了前に確認します。</p>
</section>
<section class="settings-section"><h3>配色と文字</h3>
  <fieldset class="theme-choices"><legend>テーマカラー</legend><div class="theme-grid">${palettes.map(([value,label])=>`<label class="theme-choice"><input type="radio" name="color-theme" value="${value}" aria-label="テーマカラー：${label}"><span class="theme-swatch" data-palette="${value}"></span>${label}</label>`).join('')}</div></fieldset>
  <div class="settings-fields"><fieldset class="settings-brightness" id="setting-theme"><legend>明るさ</legend><div class="settings-theme-toggle">${brightness.map(([value,label,icon])=>`<label title="${label}"><input type="radio" name="setting-theme" value="${value}" aria-label="明るさ：${label}"><span><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>${label==='システムに合わせる'?'システム':label}</span></label>`).join('')}</div></fieldset>
  <label class="field">文字サイズ<input id="setting-size" type="number" min="11" max="28" step="1"></label></div>
  <p class="muted" id="paper-note" hidden>羊皮紙は明るい紙の配色で表示します。</p>
  <p class="muted">配色は選んだ直後に確認できます。キャンセルすると元に戻ります。</p>
  <div class="settings-fields"><label class="field">原文の折り返し<select id="setting-wrap-mode"><option value="none">折り返さない（Ctrl+Alt+X）</option><option value="column">指定桁で折り返す（Ctrl+Alt+S）</option><option value="window">右端で折り返す（Ctrl+Alt+W）</option></select></label><label class="field">指定桁<input id="setting-wrap-column" type="number" min="10" max="500" step="1"></label></div>
  <p class="muted">指定桁は半角文字の幅を基準にした表示幅です。全角文字・タブの幅はフォントや表示位置によって変わります。文書の改行は変更しません。</p>
  <label class="checkbox"><input id="setting-soft-breaks" type="checkbox">原文の1回の改行を右側にも表示する</label>
</section>
<section class="settings-section"><h3>空白・改行の記号（左右共通）</h3>
  <p class="muted">種類ごとに表示・色・濃さを選べます。文書の保存内容は変わりません。</p>
  <div class="whitespace-settings">${marks.map(mark=>`<fieldset class="whitespace-style-row"><legend class="settings-visually-hidden">${mark.label}の表示設定</legend>
    <label class="checkbox ws-enable"><input id="${mark.id}" type="checkbox">${mark.label} <span class="ws-setting-sample" data-whitespace="${mark.suffix}" aria-hidden="true">${mark.glyph}</span></label>
    <label class="ws-color-control"><span>色</span><input type="color" id="setting-ws-${mark.suffix}-color" aria-label="${mark.label}の記号の色"></label>
    <label class="ws-opacity-control"><span>濃さ</span><input type="range" id="setting-ws-${mark.suffix}-opacity" min="10" max="100" step="1" aria-label="${mark.label}の記号の濃さ"><output id="setting-ws-${mark.suffix}-value" for="setting-ws-${mark.suffix}-opacity">45%</output></label>
  </fieldset>`).join('')}</div>
  <label class="checkbox"><input id="setting-distinguish-line-breaks" type="checkbox">改行コードを区別する（↵ CRLF、↓ LF、← CR）</label>
  <p class="muted">「改行」の表示がオンのときに原文の記号を切り替えます。</p>
</section>
<section class="settings-section settings-association"><h3>Windowsの既定アプリ</h3>
  <p class="muted">ファイルをダブルクリックして開くアプリは、Windowsの画面で種類ごとに選びます。Windowsの仕組みにより、このアプリから複数の種類を一括で既定に変更することはできません。</p>
  <button type="button" class="secondary" id="register-app">Windowsの既定アプリ設定を開く</button>
  <p class="muted">Windowsの画面に表示される一覧から、.md、.csv、.txt、.html など必要な種類を設定してください。このアプリの一覧が開かない場合は、MD-CSV Split Editor を検索して選んでください。</p>
  <details><summary>対応する拡張子を表示（${supportedTextExtensions.length}種類）</summary><p class="muted">${supportedTextExtensions.join('、')}</p></details>
</section>`;

export async function showSettings(api){
  const modal=document.querySelector('#modal');
  const original=api.settings();
  const snapshot={theme:original.theme??'dark',colorTheme:original.colorTheme??'black',distinguishLineBreaks:original.distinguishLineBreaks!==false,whitespaceStyles:normalizeWhitespaceStyles(original.whitespaceStyles),...Object.fromEntries(marks.map(mark=>[mark.setting,!!original[mark.setting]]))};
  let applied=false,readSettings;
  modal.classList.add('settings-dialog');
  try{
    const ok=await api.dialog('設定',formMarkup,body=>{
      const $=selector=>body.querySelector(selector);
      const setChecked=(id,value)=>$(id).checked=!!value;
      api.updates.settingsFields(body);
      $('#setting-layout').value=pick(original.openPolicy,['tabs','windows'],'tabs');
      $('#setting-session-policy').value=pick(original.sessionPolicy,['clear','all','active'],'clear');
      $('#setting-startup-format').value=pick(original.startupFormat,['md','csv','txt','html','json','tsv','xml'],'md');
      const typeSettings=normalizeFileTypeSettings(original);
      let chosenType=presentationTypes.includes(api.fileKind?.())?api.fileKind():'markdown';
      const readType=()=>{
        const caps=presentationCapabilities(chosenType),entry=typeSettings[chosenType];
        entry.defaultViewMode=$('#setting-view-mode').value;
        if(caps.outline)entry.outlineVisible=$('#setting-outline').checked;
        if(caps.sync)entry.sync=$('#setting-sync').checked;
      };
      const displayType=()=>{
        const caps=presentationCapabilities(chosenType),entry=typeSettings[chosenType];
        $('#setting-file-kind').value=chosenType;$('#setting-view-mode').value=entry.defaultViewMode;
        $('#setting-outline').checked=entry.outlineVisible;$('#setting-outline').disabled=!caps.outline;
        $('#setting-sync').checked=entry.sync;$('#setting-sync').disabled=!caps.sync;
        $('#setting-type-note').textContent=chosenType==='markdown'?'見出しナビと左右連動に対応しています。':chosenType==='html'?'HTMLは原文と読み取り専用プレビューに対応します。見出しナビと左右連動は対象外です。':'CSV・TSVは原文と表の左右連動に対応します。見出しナビは対象外です。';
      };
      $('#setting-file-kind').addEventListener('change',()=>{readType();chosenType=$('#setting-file-kind').value;displayType();});
      for(const input of body.querySelectorAll('input[name="setting-theme"]'))input.checked=input.value===pick(original.theme,['system','light','dark'],'dark');
      $('#setting-size').value=Number.isFinite(original.fontSize)?Math.min(28,Math.max(11,original.fontSize)):15;
      $('#setting-wrap-mode').value=sourceWrapMode(original);$('#setting-wrap-column').value=sourceWrapColumn(original);setChecked('#setting-soft-breaks',original.softBreaks!==false);displayType();
      const selected=pick(original.colorTheme,palettes.map(p=>p[0]),'black');
      for(const input of body.querySelectorAll('input[name="color-theme"]'))input.checked=input.value===selected;
      const readTheme=()=>body.querySelector('input[name="setting-theme"]:checked')?.value||'dark';
      const readPalette=()=>body.querySelector('input[name="color-theme"]:checked')?.value||'black';
      const preview=patch=>api.guard(()=>api.previewSettings(patch))();
      const updatePaper=()=>{const paper=readPalette().startsWith('parchment');$('#setting-theme').disabled=paper;$('#paper-note').hidden=!paper;};
      const previewPalette=()=>{updatePaper();preview({theme:readTheme(),colorTheme:readPalette()});};
      for(const input of body.querySelectorAll('input[name="color-theme"]'))input.addEventListener('change',previewPalette);
      $('#setting-theme').addEventListener('change',previewPalette);updatePaper();
      const readWhitespace=()=>normalizeWhitespaceStyles(Object.fromEntries(marks.map(mark=>[mark.key,{color:$('#setting-ws-'+mark.suffix+'-color').value,opacity:Number($('#setting-ws-'+mark.suffix+'-opacity').value)/100}])));
      const previewWhitespace=()=>{
        const styles=readWhitespace();
        for(const mark of marks){const output=$('#setting-ws-'+mark.suffix+'-value');output.value=Math.round(styles[mark.key].opacity*100)+'%';const sample=body.querySelector('[data-whitespace="'+mark.suffix+'"]');sample.style.color=styles[mark.key].color;sample.style.opacity=String(styles[mark.key].opacity);}
        $('#setting-distinguish-line-breaks').disabled=!$('#setting-line-breaks').checked;
        preview({whitespaceStyles:styles,distinguishLineBreaks:$('#setting-distinguish-line-breaks').checked,...Object.fromEntries(marks.map(mark=>[mark.setting,$('#'+mark.id).checked]))});
      };
      setChecked('#setting-distinguish-line-breaks',snapshot.distinguishLineBreaks);$('#setting-distinguish-line-breaks').disabled=!snapshot.showLineBreaks;
      $('#setting-distinguish-line-breaks').addEventListener('change',previewWhitespace);
      for(const mark of marks){
        const style=snapshot.whitespaceStyles[mark.key];setChecked('#'+mark.id,snapshot[mark.setting]);
        const color=$('#setting-ws-'+mark.suffix+'-color'),opacity=$('#setting-ws-'+mark.suffix+'-opacity');color.value=style.color;opacity.value=String(Math.round(style.opacity*100));
        const output=$('#setting-ws-'+mark.suffix+'-value');output.value=Math.round(style.opacity*100)+'%';
        const sample=body.querySelector('[data-whitespace="'+mark.suffix+'"]');sample.style.color=style.color;sample.style.opacity=String(style.opacity);
        color.addEventListener('input',previewWhitespace);opacity.addEventListener('input',previewWhitespace);$('#'+mark.id).addEventListener('change',previewWhitespace);
      }
      $('#register-app').onclick=api.guard(async()=>{await api.host('association.register');api.notify('Windowsの画面でファイルの種類ごとに既定アプリを選んでください。');});
      readSettings=()=>{readType();return ({
        updateCheckDays:api.updates.readDays(),openPolicy:$('#setting-layout').value,sessionPolicy:$('#setting-session-policy').value,startupFormat:$('#setting-startup-format').value,fileTypeSettings:typeSettings,
        theme:readTheme(),colorTheme:readPalette(),fontSize:Math.round(Math.min(28,Math.max(11,Number($('#setting-size').value)||15))),wrapMode:$('#setting-wrap-mode').value,wrapColumn:sourceWrapColumn({wrapColumn:$('#setting-wrap-column').value}),wrap:$('#setting-wrap-mode').value!=='none',softBreaks:$('#setting-soft-breaks').checked,
        whitespaceStyles:readWhitespace(),distinguishLineBreaks:$('#setting-distinguish-line-breaks').checked,...Object.fromEntries(marks.map(mark=>[mark.setting,$('#'+mark.id).checked]))
      });};
    });
    if(ok){await api.setSettings(readSettings());applied=true;}
  }finally{
    try{if(!applied)await api.previewSettings(snapshot);}
    finally{modal.classList.remove('settings-dialog');}
  }
}
