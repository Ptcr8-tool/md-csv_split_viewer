import {supportedTextExtensions,filetypeLabel} from './file-types.js';
import {encodingChoices} from './text-codecs.js';
import {currentUiLanguage} from './i18n.js';
const tr=(ja,en)=>currentUiLanguage()==='en'?en:ja;

const commonFormats=[
  ['md','Markdown'],['txt','テキスト'],['csv','CSV'],['tsv','TSV'],
  ['html','HTML'],['json','JSON'],['xml','XML']
];
const browserEncodings=new Set(['utf8','utf8bom','utf16le','utf16be','utf32le','utf32be']);

// The file menu asks for both choices; the toolbar and Ctrl+N remain quick actions.
export async function chooseNewFile({dialog,isDesktop,defaultFormat='md'}) {
  const modal=document.querySelector('#modal'),confirm=modal.querySelector('.dialog-actions [value="ok"]');
  const originalLabel=confirm.textContent;let read;
  modal.classList.add('new-file-dialog');
  try {
    const accepted=await dialog(tr('新規ファイルを作成','Create new file'),`<fieldset class="new-file-formats"><legend>${tr('ファイルの種類','File type')}</legend><div id="new-file-common" class="new-file-grid"></div><details id="new-file-more" class="new-file-more"><summary><span>${tr('もっと見る','More options')}</span><span id="new-file-more-selection" class="new-file-more-selection">${tr('YAML・ソースコードなど','YAML, source code, and more')}</span></summary><div class="new-file-extra"><label class="field" for="new-file-extra-format">${tr('その他のファイル形式','Other file types')}<select id="new-file-extra-format"><option value="">${tr('種類を選択してください','Select a type')}</option></select></label></div></details></fieldset><label class="field new-file-encoding" for="new-file-encoding">${tr('文字コード','Encoding')}<select id="new-file-encoding"></select></label><p class="new-file-hint">${tr('選択した文字コードで保存します。UTF-16・UTF-32はBOM付きです。','The file will be saved using the selected encoding. UTF-16 and UTF-32 include a BOM.')}</p>`,body=>{
      confirm.textContent=tr('作成','Create');
      const grid=body.querySelector('#new-file-common');
      const extra=body.querySelector('#new-file-extra-format');
      const selected=body.querySelector('#new-file-more-selection'),encoding=body.querySelector('#new-file-encoding');
      for(const [extension,label] of commonFormats){
        const choice=document.createElement('label');choice.className='new-file-choice';
        const input=document.createElement('input');input.type='radio';input.name='new-file-format';input.value=extension;input.checked=extension===defaultFormat;
        const text=document.createElement('span'),name=document.createElement('strong'),suffix=document.createElement('small');name.textContent=label==='テキスト'?tr('テキスト','Text'):label;suffix.textContent='.'+extension;text.append(name,suffix);choice.append(input,text);grid.append(choice);
      }
      if(!grid.querySelector('input:checked'))grid.querySelector('input').checked=true;
      const common=new Set(commonFormats.map(([extension])=>'.'+extension));
      const remaining=supportedTextExtensions.filter(extension=>!common.has(extension));
      const extras=['.yml','.yaml',...remaining.filter(extension=>extension!=='.yml'&&extension!=='.yaml')].filter(extension=>remaining.includes(extension));
      for(const extension of extras){const option=document.createElement('option');option.value=extension.slice(1);const label=filetypeLabel('無題'+extension);option.textContent=currentUiLanguage()==='en'?`${({'テキスト':'Text','設定ファイル':'Configuration','バッチ':'Batch'}[label]||label)} (${extension})`:`${label}（${extension}）`;extra.append(option);}
      for(const choice of encodingChoices){const option=document.createElement('option');option.value=choice.id;option.textContent=choice.label;option.disabled=!isDesktop&&!browserEncodings.has(choice.id);if(option.disabled)option.textContent+=tr('（Windows版のみ）',' (Windows only)');encoding.append(option);}
      encoding.value='utf8';
      let lastCommon=grid.querySelector('input:checked').value;
      const update=()=>{selected.textContent=extra.value?extra.selectedOptions[0].textContent:tr('YAML・ソースコードなど','YAML, source code, and more');};
      grid.addEventListener('change',event=>{if(event.target.matches('input:checked')){lastCommon=event.target.value;extra.value='';update();}});
      extra.addEventListener('change',()=>{if(extra.value)grid.querySelectorAll('input').forEach(input=>input.checked=false);else grid.querySelector(`input[value="${lastCommon}"]`).checked=true;update();});
      update();
      read=()=>({extension:extra.value||grid.querySelector('input:checked').value,encoding:encoding.value});
    });
    return accepted?read():null;
  } finally {modal.classList.remove('new-file-dialog');confirm.textContent=originalLabel;}
}
