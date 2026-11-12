(function(){
  let source,preview,input,probe,phase='waiting',initial=0,minimum=0,maximum=0,sourceStart=0,events=0,keys=0,inputs=0;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  async function selectPhase(name){
    phase='loading';probe.value='loading';probe.setAttribute('value','loading');
    const target=name==='list'?'野菜を買う':'この段落を選んで';
    let line=null;
    for(let top=0;top<4500;top+=Math.max(100,source.clientHeight*.6)){
      source.scrollTop=top;await sleep(70);
      line=[...document.querySelectorAll('.cm-line')].find(x=>x.textContent.includes(target));if(line)break;
    }
    if(!line){probe.value='notfound:'+name;probe.setAttribute('value',probe.value);return;}
    for(let tries=0;tries<6;tries++){
      source.scrollTop+=line.getBoundingClientRect().top-source.getBoundingClientRect().top-120;
      await sleep(500);
      line=[...document.querySelectorAll('.cm-line')].find(x=>x.textContent.includes(target));
      if(!line){probe.value='lost:'+name;probe.setAttribute('value',probe.value);return;}
      const offset=line.getBoundingClientRect().top-source.getBoundingClientRect().top;
      if(offset>=10&&offset<source.clientHeight-30)break;
    }
    const offset=line.getBoundingClientRect().top-source.getBoundingClientRect().top;
    if(offset<0||offset>source.clientHeight-20){probe.value='notvisible:'+name;probe.setAttribute('value',probe.value);return;}
    input.focus();
    const walker=document.createTreeWalker(line,NodeFilter.SHOW_TEXT);let node,last;
    while((node=walker.nextNode()))if(node.length)last=node;
    if(!last){probe.value='empty:'+name;probe.setAttribute('value',probe.value);return;}
    const range=document.createRange();range.setStart(last,last.length);range.collapse(true);
    const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
    await sleep(600);
    initial=preview.scrollTop;minimum=initial;maximum=initial;sourceStart=source.scrollTop;events=keys=inputs=0;phase=name;
  }
  const timer=setInterval(()=>{
    source=document.querySelector('.cm-scroller');preview=document.querySelector('#preview');input=document.querySelector('.cm-content');
    if(!source||!preview||!input||!input.isContentEditable)return;
    clearInterval(timer);
    const box=document.createElement('div');box.style.cssText='position:fixed;right:3px;top:3px;z-index:9999;background:white;color:black;display:flex;gap:3px';
    probe=document.createElement('input');probe.setAttribute('aria-label','scroll telemetry');probe.readOnly=true;probe.style.width='400px';box.append(probe);
    for(const name of ['list','plain','toggle']){const button=document.createElement('button');button.setAttribute('aria-label','probe '+name);button.textContent=name;button.onclick=()=>name==='toggle'?document.querySelector('#sync-toggle').click():void selectPhase(name);box.append(button);}
    document.body.append(box);
    input.addEventListener('keydown',()=>{if(phase==='list'||phase==='plain')keys++;});
    input.addEventListener('input',()=>{if(phase==='list'||phase==='plain')inputs++;});
    preview.addEventListener('scroll',()=>{if(phase==='list'||phase==='plain'){events++;minimum=Math.min(minimum,preview.scrollTop);maximum=Math.max(maximum,preview.scrollTop);}});
    setInterval(()=>{if(phase!=='list'&&phase!=='plain')return;probe.value=[phase,initial,preview.scrollTop,minimum,maximum,sourceStart,source.scrollTop,events,keys,inputs].join(',');probe.setAttribute('value',probe.value);},100);
    probe.value='ready';probe.setAttribute('value','ready');
  },100);
})();