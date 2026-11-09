import {test,expect} from '@playwright/test';

// Real browser-edition captures using the project UI and fictional examples.
test.use({viewport:{width:1400,height:900},colorScheme:'dark'});
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('mdsplit.settings',JSON.stringify({welcomeShown:true,updateCheckDays:-1})));
  await page.goto('/');
  await page.waitForFunction(()=>window.__mdSplit?.openDocument);
});
const open=async(page,name,text)=>{
  await page.evaluate(({name,text})=>window.__mdSplit.openDocument({name,text,savedText:text,needsInitialSave:false,encoding:'utf8',hasBom:false}),{name,text});
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.model().name)).toBe(name);
  await page.getByRole('button',{name:'無題.mdを閉じる',exact:true}).click();
  await expect(page.locator('.tab')).toHaveCount(1);
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.model().dirty)).toBe(false);
};
const save=async(page,name)=>{await page.mouse.move(1390,890);await page.screenshot({path:'docs/screenshots/'+name,animations:'disabled'});};

const markdown=`# チーム共有ノート

作業の進め方や、お知らせをまとめています。
**Markdown の原文とプレビュー**を並べて、どちらからでも編集できます。

## 今日の予定

- 文章を整える
- 表の内容を確認する
- 完成したらチームに共有する

## 作業状況

| 項目 | 担当 | 状態 |
| --- | --- | --- |
| 資料の確認 | 佐藤 | 完了 |
| 文章の更新 | 鈴木 | 進行中 |
| 最終確認 | 高橋 | これから |

> 見出しナビから、目的の場所へすぐに移動できます。
`;

test('Markdown split view',async({page})=>{
  await open(page,'共有ノート.md',markdown);
  await expect(page.locator('#preview h1')).toContainText('チーム共有ノート');
  await expect(page.locator('#preview table')).toBeVisible();
  await save(page,'01-markdown-split.png');
});

test('CSV source and editable table',async({page})=>{
  const csv='案件名,日程,担当,状況\n企画の確認,11/12,佐藤,完了\n写真の整理,11/14,鈴木,進行中\n文章の作成,11/18,高橋,これから\n最終チェック,11/20,田中,これから\n公開準備,11/22,佐藤,未着手\n';
  await open(page,'作業一覧.csv',csv);
  await expect(page.locator('#text-preview [data-cell-row="1"][data-cell-column="0"]')).toContainText('企画の確認');
  await expect(page.locator('#text-preview')).toContainText('写真の整理');
  await save(page,'02-csv-grid.png');
});

test('Discord mode and split panel',async({page})=>{
  const text='# お知らせ\n\n次回の予定を共有します。\n\n## 準備すること\n\n- 参加予定を確認\n- 資料を確認\n\n当日はよろしくお願いします。';
  await open(page,'お知らせ.md',text);
  await page.getByRole('button',{name:'Discord表示',exact:true}).click();
  await page.locator('#show-chunks').click();
  await expect(page.locator('.chunk')).toHaveCount(1);
  const point=await page.locator('.chunk-body').first().evaluate(el=>{
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node;let left=35;
    while((node=walker.nextNode())){if(left<=node.length){const range=document.createRange();range.setStart(node,left);range.setEnd(node,Math.min(node.length,left+1));const rect=range.getBoundingClientRect();return {x:rect.left+Math.min(rect.width/2,2),y:rect.top+rect.height/2};}left-=node.length;}
    throw new Error('Sample text position was not found');
  });
  await page.mouse.click(point.x,point.y);
  await expect(page.locator('.chunk-add')).toBeEnabled();
  await page.locator('.chunk-add').click();
  await expect(page.locator('.chunk')).toHaveCount(2);
  await save(page,'03-discord-mode.png');
});

test('file type settings',async({page})=>{
  await open(page,'共有ノート.md',markdown);
  await page.getByRole('button',{name:'設定',exact:true}).click();
  await expect(page.locator('#setting-file-kind')).toBeVisible();
  await page.getByRole('radio',{name:'明るさ：ライト',exact:true}).check();
  await page.locator('#setting-file-kind').selectOption('csv');
  await expect(page.locator('#setting-file-kind')).toHaveValue('csv');
  await expect(page.locator('#setting-outline')).toBeDisabled();
  await page.getByRole('navigation',{name:'設定のカテゴリ'}).getByRole('button',{name:'ウィンドウと画面',exact:true}).click();
  await save(page,'04-file-type-settings.png');
});

test('safe HTML preview',async({page})=>{
  const html=`<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>お知らせ</title>
  <style>
    body { font-family: sans-serif; color: #243147; padding: 2rem; line-height: 1.7; }
    h1 { color: #165b86; }
    section { padding: 1rem; background: #f0f6f8; border-radius: .5rem; }
  </style>
</head>
<body>
  <h1>お知らせ</h1>
  <p>新しいページをご覧いただきありがとうございます。</p>
  <section>
    <h2>今週の予定</h2>
    <p>内容を確認して、準備を進めましょう。</p>
    <ul><li>資料の確認</li><li>日程の共有</li></ul>
  </section>
</body>
</html>`;
  await open(page,'お知らせ.html',html);
  await expect(page.frameLocator('#text-preview iframe').getByRole('heading',{name:'お知らせ',exact:true})).toBeVisible();
  await save(page,'05-html-preview.png');
});

test('Mermaid diagram view',async({page})=>{
  const text='# 作業の流れ\n\n以下の図は Mermaid のコードから表示しています。\n\n```mermaid\nflowchart LR\n  A[企画] --> B[作成]\n  B --> C[共有]\n```\n\nコードを編集すると、図も描き直せます。';
  await open(page,'作業フロー.md',text);
  await expect(page.locator('.mermaid-stage svg')).toHaveCount(1,{timeout:30000});
  await expect(page.locator('#preview')).toContainText('作業の流れ');
  await save(page,'06-mermaid-diagram.png');
});
