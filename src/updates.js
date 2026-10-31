import {host,isDesktop} from './bridge.js';
const $=s=>document.querySelector(s);
const checkFailure='更新を確認できませんでした。編集はそのまま続けられます。';
const downloadFailure='更新を取得・検証できませんでした。編集はそのまま続けられます。';
export class UpdateController{
  constructor(api){this.api=api;this.busy=false;$('#update-cancel').onclick=()=>{this.cancelled=true;host('update.cancel').catch(()=>api.notify('更新の中止を確認できませんでした。'));};}
  startup(){if(isDesktop&&this.api.settings().updateCheckDays!==-1)setTimeout(()=>this.check(false),1600);}
  settingsFields(body){const section=document.createElement('section');section.className='settings-update';section.innerHTML='<h3>起動時の更新チェック</h3><label class="field">確認する間隔<select id="setting-updates"><option value="-1">なし</option><option value="0">毎回</option><option value="1">1日</option><option value="7">7日</option><option value="30">30日</option><option value="custom">日数を指定</option></select></label><label class="field" id="update-days-field" hidden>日数（1〜365）<input id="setting-update-days" type="number" min="1" max="365"></label><p class="muted">GitHubへ新しい版を確認します。ダウンロード前に確認を表示します。</p><button type="button" id="manual-update" class="secondary">今すぐ更新を確認</button>';body.append(section);const days=this.api.settings().updateCheckDays??7;$('#setting-updates').value=[-1,0,1,7,30].includes(days)?String(days):'custom';$('#setting-update-days').value=Math.max(1,days);const change=()=>$('#update-days-field').hidden=$('#setting-updates').value!=='custom';$('#setting-updates').onchange=change;change();$('#manual-update').onclick=()=>{const modal=$('#modal');modal.addEventListener('close',()=>this.check(true),{once:true});modal.close('cancel');};}
  readDays(){const value=$('#setting-updates').value;return value==='custom'?Math.max(1,Math.min(365,Number($('#setting-update-days').value)||7)):Number(value);}
  async check(manual){if(!isDesktop){if(manual)this.api.notify('更新の確認はWindows版で利用できます。');return;}if(this.busy)return;this.busy=true;
    let downloading=false;
    try{const result=await host('update.check',{manual});if(!result||typeof result!=='object'||typeof result.available!=='boolean'){this.api.notify(checkFailure);return;}if(!result.available){if(result.status==='current'||result.status==='notDue'){if(manual)this.api.notify(result.status==='current'?'最新バージョンです。':'確認する時期ではありません。');}else this.api.notify(result.status==='busy'?'別のウィンドウで更新を処理しています。編集は続けられます。':checkFailure);return;}
      if(typeof result.version!=='string'||!result.version||!Number.isSafeInteger(result.bytes)||result.bytes<=0||typeof result.notes!=='string'){this.api.notify(checkFailure);return;}
      if($('#modal').open){if(!manual)this.api.notify('新しいバージョンがあります。設定から更新を確認できます。');return;}
      const ok=await this.api.dialog('新しいバージョンがあります','<p id="update-version"></p><p class="muted" id="update-size"></p><div id="update-notes" class="update-notes"></div><p class="muted">ダウンロード・検証後、開いているすべてのウィンドウを終了して更新します。設定とタブを引き継ぎます。</p>',()=>{$('#update-version').textContent='MD-CSV Split Editor '+result.version;$('#update-size').textContent='セットアップ全体: '+Math.ceil(result.bytes/1024/1024)+' MB';$('#update-notes').textContent=result.notes||'';$('#modal .primary').textContent='更新';});$('#modal .primary').textContent='適用';if(!ok)return;
      downloading=true;this.cancelled=false;$('#update-progress').hidden=false;$('#update-status').textContent='更新をダウンロードしています…';$('#update-progress progress').removeAttribute('value');try{await host('update.download',{version:result.version});if(this.cancelled){this.api.notify('更新を中止しました。');return;}$('#update-status').textContent='検証完了。終了前の確認をしています…';await host('update.prepare');}finally{$('#update-progress').hidden=true;}
    }catch{
      const session=this.preparingSession;
      if(session){this.preparingSession=null;document.querySelector('#app').inert=false;if(this.dialogSession===session&&$('#modal').open)$('#modal').close('cancel');this.dialogSession=null;host('update.ready',{ready:false,session}).catch(()=>{});}
      this.api.notify(downloading?(this.cancelled?'更新を中止しました。':downloadFailure):checkFailure);
    }finally{this.busy=false;}
  }
  async onEvent(event){
    if(event.type==='update-progress'){$('#update-status').textContent='更新をダウンロード中 '+Math.round(event.percent)+'%';$('#update-progress progress').value=event.percent;return true;}
    if(event.type==='update-close-request'){if($('#modal').open||this.preparingSession){await host('update.ready',{ready:false,session:event.session});this.api.notify('別の操作を終えてから更新を再試行してください。');return true;}this.preparingSession=event.session;await this.prepare(event.session);return true;}
    if(event.type==='update-aborted'){if(this.preparingSession===event.session){this.preparingSession=null;document.querySelector('#app').inert=false;if(this.dialogSession===event.session&&$('#modal').open)$('#modal').close('cancel');}this.api.notify(typeof event.message==='string'&&event.message?event.message:'更新を中止しました。編集を続けられます。');return true;}return false;
  }
  async prepare(session){
    if(this.api.documents().some(d=>d.composing||d.pendingImports||d.componentEditing)){await host('update.ready',{ready:false,session});this.preparingSession=null;this.api.notify('入力の変換・画像の取り込み・セル編集を終えてから更新してください。');return;}
    try{for(const d of this.api.documents()){if(this.preparingSession!==session)return;if(!d.dirty)continue;this.api.switchDocument(d.id);this.dialogSession=session;const ok=await this.api.dialog('更新前に変更を保存しますか？','<p id="update-document"></p><p class="muted">更新を中止すると編集を続けられます。</p><button type="button" id="update-discard" class="secondary">変更を破棄して更新</button>',()=>{$('#update-document').textContent=d.name;$('#modal .primary').textContent='保存して更新';$('#update-discard').onclick=()=>$('#modal').close('discard');});const choice=$('#modal').returnValue;this.dialogSession=null;$('#modal .primary').textContent='適用';if(this.preparingSession!==session)return;if(!ok&&choice!=='discard'||ok&&!await this.api.saveDocument(d)){await host('update.ready',{ready:false,session});return;}if(this.preparingSession!==session)return;if(choice==='discard'){d.raw=d.saved;d.encoding=d.savedEncoding;d.hasBom=d.savedHasBom;d.selection={from:0,to:0};this.api.render();}}
      if(this.preparingSession!==session)return;document.querySelector('#app').inert=true;this.api.clearRecoveryTimer();await this.api.writeRecovery('update');if(this.preparingSession===session)await host('update.ready',{ready:true,session});
    }catch{document.querySelector('#app').inert=false;this.dialogSession=null;host('update.ready',{ready:false,session}).catch(()=>{});this.api.notify(downloadFailure);}finally{if(this.preparingSession===session&&!document.querySelector('#app').inert)this.preparingSession=null;}
  }
}
