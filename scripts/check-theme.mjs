import assert from 'node:assert/strict';

// Measure rendered colors, including transparent active-line backgrounds.
// This catches low-contrast library defaults as well as palette regressions.
export async function checkTheme(page,theme){
  await page.waitForFunction(expected=>document.documentElement.dataset.theme===expected,theme);
  await page.evaluate(async()=>{await Promise.allSettled(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished));});
  const result=await page.evaluate(()=>{
    const rgba=value=>{const n=value.match(/[\d.]+/g).map(Number);return [...n.slice(0,3),n[3]??1];};
    const background=node=>{
      const ancestors=[];for(let n=node;n;n=n.parentElement)ancestors.unshift(n);
      return ancestors.reduce((color,n)=>{const c=rgba(getComputedStyle(n).backgroundColor);return c.slice(0,3).map((v,i)=>v*c[3]+color[i]*(1-c[3]));},[255,255,255]);
    };
    const luminance=color=>color.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((v,c,i)=>v+c*[.2126,.7152,.0722][i],0);
    const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
    const measure=selector=>Array.from(document.querySelectorAll(selector)).filter(n=>n.textContent.trim()).map(n=>({text:n.textContent.slice(0,65),contrast:contrast(rgba(getComputedStyle(n).color),background(n))}));
    return {
      theme:document.documentElement.dataset.theme,
      palette:document.documentElement.dataset.palette||'black',
      surfaces:['#app','.topbar','.source-pane','.preview-pane','.cm-gutters','.formatbar','.statusbar','.toggle-group .selected'].map(s=>({selector:s,color:background(document.querySelector(s))})),
      markers:measure('.cm-content .md-markup'),
      text:measure('.cm-content .cm-line,.cm-content span,.cm-gutterElement,.pane-heading .pane-note,#preview p,#preview li,#preview blockquote,#preview code,.target-label,.tab-name,.statusbar>span')
    };
  });
  assert.equal(result.theme,theme);
  assert.ok(result.markers.length>=4,'Markdown delimiters must be present in the rendered editor');
  for(const item of [...result.markers,...result.text])assert.ok(item.contrast>=4.5,`${theme}: ${JSON.stringify(item)}`);
  if(theme==='dark'&&result.palette==='black')for(const surface of result.surfaces){assert.equal(surface.color[0],surface.color[1],JSON.stringify(surface));assert.equal(surface.color[1],surface.color[2],JSON.stringify(surface));assert.ok(surface.color[0]<60,JSON.stringify(surface));}
  return {theme,minimumMarkerContrast:Math.min(...result.markers.map(n=>n.contrast)),minimumTextContrast:Math.min(...result.text.map(n=>n.contrast)),markerCount:result.markers.length};
}
