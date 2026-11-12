(function(){
  let source,preview,probe,initial,minimum,maximum,events=0;
  const timer=setInterval(()=>{
    source=document.querySelector('.cm-scroller');preview=document.querySelector('#preview');
    const input=document.querySelector('.cm-content');
    if(!source||!preview||!input||!input.isContentEditable)return;
    clearInterval(timer);
    probe=document.createElement('input');probe.setAttribute('aria-label','scroll telemetry');probe.readOnly=true;probe.style.cssText='position:fixed;right:3px;top:3px;width:260px;height:24px;z-index:9999;background:white;color:black';document.body.append(probe);
    source.scrollTop=680;preview.scrollTop=687;
    setTimeout(()=>{
      input.focus();
      let lines=[...document.querySelectorAll('.cm-line')],line=lines.find(x=>x.textContent.includes('引用のサンプル'))||lines[Math.floor(lines.length/2)];
      const walker=document.createTreeWalker(line,NodeFilter.SHOW_TEXT),node=walker.nextNode();
      if(node){const range=document.createRange();range.setStart(node,Math.min(2,node.length));range.collapse(true);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);}
      initial=preview.scrollTop;minimum=initial;maximum=initial;
      preview.addEventListener('scroll',()=>{events++;minimum=Math.min(minimum,preview.scrollTop);maximum=Math.max(maximum,preview.scrollTop);});
      setInterval(()=>{probe.value=[initial,preview.scrollTop,minimum,maximum,source.scrollTop,events].join(',');probe.setAttribute('value',probe.value);},100);
    },1500);
  },100);
})();