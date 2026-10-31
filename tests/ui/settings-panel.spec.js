import {test,expect} from '@playwright/test';

async function openSettingsModule(page){
  await page.goto('/');await page.waitForFunction(()=>window.__mdSplit);
  await page.evaluate(async()=>{
    const {showSettings}=await import('/src/settings-panel.js');const {applyWhitespaceStyles}=await import('/src/whitespace.js');
    window._settingsState={openPolicy:'tabs',viewMode:'split',outlineVisible:true,theme:'dark',colorTheme:'black',fontSize:15,wrap:true,sync:true,softBreaks:true,showLineBreaks:false,showFullWidthSpaces:false,showTabs:false,showSpaces:false,updateCheckDays:7};window._settingsSaves=[];window._settingsPreviews=[];window._settingsHosts=[];
    const preview=patch=>{window._settingsPreviews.push(structuredClone(patch));window._settingsState={...window._settingsState,...patch};document.documentElement.dataset.palette=window._settingsState.colorTheme;document.documentElement.dataset.theme=window._settingsState.theme==='light'?'light':'dark';applyWhitespaceStyles(window._settingsState);};
    window._settingsJob=showSettings({settings:()=>window._settingsState,previewSettings:preview,setSettings:async patch=>{window._settingsSaves.push(patch);preview(patch);},host:async method=>{window._settingsHosts.push(method);},notify:()=>{},guard:fn=>(...args)=>Promise.resolve(fn(...args)),updates:{settingsFields(body){const section=document.createElement('section');section.className='settings-update';section.textContent='起動時の更新チェック';body.append(section);},readDays:()=>7},dialog:async(title,html,setup)=>{const modal=document.querySelector('#modal'),body=document.querySelector('#dialog-body');document.querySelector('#dialog-title').textContent=title;body.innerHTML=html;setup(body);modal.returnValue='';modal.showModal();return new Promise(resolve=>modal.addEventListener('close',()=>resolve(modal.returnValue==='ok'),{once:true}));}});
  });
  await expect(page.locator('#modal')).toBeVisible();
}
test('theme and marker appearance preview immediately, cancel restores them without saving',async({page})=>{
  await openSettingsModule(page);await page.getByRole('radio',{name:'テーマカラー：青',exact:true}).check();await page.getByRole('radio',{name:'明るさ：ライト',exact:true}).check();await expect(page.locator('html')).toHaveAttribute('data-palette','blue');await expect(page.locator('html')).toHaveAttribute('data-theme','light');await page.locator('#setting-line-breaks').check();
  await page.locator('#setting-ws-line-break-color').evaluate(input=>{input.value='#123456';input.dispatchEvent(new Event('input',{bubbles:true}));});await page.locator('#setting-ws-line-break-opacity').fill('22');await expect(page.locator('#setting-ws-line-break-value')).toHaveText('22%');
  expect(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--ws-line-break-color'))).toBe('#123456');expect(await page.evaluate(()=>window._settingsState.showLineBreaks)).toBe(true);
  await page.getByRole('button',{name:'キャンセル',exact:true}).click();await page.evaluate(()=>window._settingsJob);await expect(page.locator('html')).toHaveAttribute('data-palette','black');await expect(page.locator('html')).toHaveAttribute('data-theme','dark');expect(await page.evaluate(()=>window._settingsState.whitespaceStyles.lineBreak.opacity)).toBe(0.45);expect(await page.evaluate(()=>window._settingsState.showLineBreaks)).toBe(false);expect(await page.evaluate(()=>window._settingsSaves)).toEqual([]);await expect(page.locator('#modal')).not.toHaveClass(/settings-dialog/);
});
test('apply retains the full settings set, pane selection, outline and independent marker styles',async({page})=>{
  await openSettingsModule(page);await page.locator('#setting-layout').selectOption('windows');await page.locator('#setting-view-mode').selectOption('source');await page.locator('#setting-outline').uncheck();await page.locator('#setting-size').fill('19');await page.locator('#setting-wrap-mode').selectOption('none');await page.locator('#setting-sync').uncheck();await page.locator('#setting-soft-breaks').uncheck();await page.locator('#setting-tabs').check();
  await page.locator('#setting-ws-tab-color').evaluate(input=>{input.value='#cc66aa';input.dispatchEvent(new Event('input',{bubbles:true}));});await page.locator('#setting-ws-tab-opacity').fill('35');await page.getByRole('button',{name:'Windowsの既定アプリ設定を開く',exact:true}).click();expect(await page.evaluate(()=>window._settingsHosts)).toEqual(['association.register']);await page.getByRole('button',{name:'適用',exact:true}).click();await page.evaluate(()=>window._settingsJob);
  const saves=await page.evaluate(()=>window._settingsSaves);expect(saves).toHaveLength(1);expect(saves[0]).toMatchObject({openPolicy:'windows',fileTypeSettings:{markdown:{defaultViewMode:'source',outlineVisible:false,sync:false}},theme:'dark',colorTheme:'black',fontSize:19,wrapMode:'none',wrapColumn:80,wrap:false,softBreaks:false,showTabs:true,updateCheckDays:7,whitespaceStyles:{tab:{color:'#cc66aa',opacity:0.35},space:{color:'#87909a',opacity:0.3}}});
});

test('default-app settings list every supported extension and explain the Windows choice',async({page})=>{
  await openSettingsModule(page);
  const supported=await page.evaluate(async()=>(await import('/src/file-types.js')).supportedTextExtensions);
  const details=page.locator('.settings-association details');
  await details.locator('summary').click();
  const displayed=(await details.locator('p').textContent()).split('、');
  expect(displayed).toEqual(supported);
  for(const extension of ['.md','.markdown','.csv','.tsv','.txt','.html','.htm','.json','.py']){
    expect(displayed).toContain(extension);
  }
  await expect(page.locator('.settings-association')).toContainText('Windowsの画面で種類ごとに選びます');
  await page.getByRole('button',{name:'Windowsの既定アプリ設定を開く',exact:true}).click();
  expect(await page.evaluate(()=>window._settingsHosts)).toEqual(['association.register']);
  await page.getByRole('button',{name:'キャンセル',exact:true}).click();await page.evaluate(()=>window._settingsJob);
});
test('only settings content scrolls while apply and cancel remain visible',async({page})=>{
  await page.setViewportSize({width:900,height:560});await openSettingsModule(page);const button=page.getByRole('button',{name:'適用',exact:true}),before=await button.boundingBox();expect(before.y+before.height).toBeLessThan(560);await page.locator('#dialog-body').evaluate(body=>{body.scrollTop=body.scrollHeight;});expect(await page.locator('#dialog-body').evaluate(body=>body.scrollTop)).toBeGreaterThan(150);const after=await button.boundingBox();expect(after.y).toBe(before.y);await expect(button).toBeVisible();await expect(page.getByRole('button',{name:'キャンセル',exact:true})).toBeVisible();await page.getByRole('button',{name:'キャンセル',exact:true}).click();
});

test('default view normally follows the last selection and brightness toggles are disabled on parchment',async({page})=>{
  await openSettingsModule(page);await expect(page.locator('#setting-view-mode')).toHaveValue('last');
  await page.getByRole('radio',{name:'明るさ：システムに合わせる',exact:true}).check();
  await expect(page.getByRole('radio',{name:'明るさ：システムに合わせる',exact:true})).toBeChecked();
  await page.getByRole('radio',{name:'テーマカラー：羊皮紙',exact:true}).check();
  for(const label of ['ライト','ダーク','システムに合わせる'])await expect(page.getByRole('radio',{name:'明るさ：'+label,exact:true})).toBeDisabled();
  await expect(page.locator('#paper-note')).toBeVisible();
  await page.getByRole('radio',{name:'テーマカラー：黒（標準）',exact:true}).check();
  await expect(page.getByRole('radio',{name:'明るさ：システムに合わせる',exact:true})).toBeEnabled();
  await expect(page.getByRole('radio',{name:'明るさ：システムに合わせる',exact:true})).toBeChecked();
  await page.getByRole('button',{name:'適用',exact:true}).click();await page.evaluate(()=>window._settingsJob);
  expect(await page.evaluate(()=>window._settingsSaves[0])).toMatchObject({fileTypeSettings:{markdown:{defaultViewMode:'last'}},theme:'system'});
});


test('file kinds retain independent drafts and disable only unsupported controls',async({page})=>{
  await openSettingsModule(page);await page.locator('#setting-view-mode').selectOption('preview');await page.locator('#setting-outline').uncheck();await page.locator('#setting-sync').uncheck();
  await page.locator('#setting-file-kind').selectOption('csv');await expect(page.locator('#setting-view-mode')).toHaveValue('last');await expect(page.locator('#setting-outline')).toBeDisabled();await expect(page.locator('#setting-sync')).toBeEnabled();await page.locator('#setting-view-mode').selectOption('source');await page.locator('#setting-sync').check();
  await page.locator('#setting-file-kind').selectOption('html');await expect(page.locator('#setting-outline')).toBeEnabled();await expect(page.locator('#setting-sync')).toBeDisabled();await page.locator('#setting-view-mode').selectOption('split');
  await page.locator('#setting-file-kind').selectOption('markdown');await expect(page.locator('#setting-view-mode')).toHaveValue('preview');await expect(page.locator('#setting-outline')).not.toBeChecked();await expect(page.locator('#setting-sync')).not.toBeChecked();
  await page.getByRole('button',{name:'適用',exact:true}).click();await page.evaluate(()=>window._settingsJob);
  const saved=await page.evaluate(()=>window._settingsSaves[0]);expect(saved.fileTypeSettings).toMatchObject({markdown:{defaultViewMode:'preview',outlineVisible:false,sync:false},csv:{defaultViewMode:'source',outlineVisible:false,sync:true},tsv:{defaultViewMode:'last'},html:{defaultViewMode:'split',outlineVisible:true,sync:false}});expect(saved).not.toHaveProperty('defaultViewMode');expect(saved).not.toHaveProperty('sync');expect(saved).not.toHaveProperty('outlineVisible');
});

test('session policy and startup format can be configured and applied independently',async({page})=>{
  await openSettingsModule(page);
  await expect(page.locator('#setting-session-policy')).toHaveValue('clear');
  await expect(page.locator('#setting-startup-format')).toHaveValue('md');
  await page.locator('#setting-session-policy').selectOption('all');
  await page.locator('#setting-startup-format').selectOption('csv');
  await page.getByRole('button',{name:'適用',exact:true}).click();await page.evaluate(()=>window._settingsJob);
  expect(await page.evaluate(()=>window._settingsSaves[0])).toMatchObject({sessionPolicy:'all',startupFormat:'csv'});
});
