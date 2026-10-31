import './csv-context-menu.css';

export function openCsvContextMenu(x,y,items,onClose=()=>{}){
  const menu=document.createElement('div');menu.className='csv-context-menu';menu.setAttribute('role','menu');
  let closed=false;
  const close=()=>{if(closed)return;closed=true;document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',keyboard,true);menu.remove();onClose();};
  const outside=event=>{if(!menu.contains(event.target))close();};
  const keyboard=event=>{if(event.key==='Escape'){event.preventDefault();close();}};
  for(const item of items){if(!item){const hr=document.createElement('hr');menu.append(hr);continue;}const button=document.createElement('button');button.type='button';button.setAttribute('role','menuitem');button.textContent=item.label;button.disabled=!!item.disabled;button.addEventListener('click',()=>{close();item.action();});menu.append(button);}
  document.body.append(menu);const box=menu.getBoundingClientRect();menu.style.left=Math.max(0,Math.min(x,window.innerWidth-box.width))+'px';menu.style.top=Math.max(0,Math.min(y,window.innerHeight-box.height))+'px';
  document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',keyboard,true);menu.querySelector('button:not(:disabled)')?.focus({preventScroll:true});return close;
}
