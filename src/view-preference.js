export const isViewMode=value=>['split','source','preview'].includes(value);
export const defaultViewMode=value=>value==='last'||isViewMode(value)?value:'last';
export const presentationTypes=Object.freeze(['markdown','csv','tsv','html']);
export const presentationCapabilities=kind=>({view:presentationTypes.includes(kind),outline:['markdown','html'].includes(kind),sync:['markdown','csv','tsv'].includes(kind)});
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const bool=(value,fallback)=>typeof value==='boolean'?value:fallback;
export function normalizeFileTypeSettings(settings={}){
  const all=object(settings.fileTypeSettings),legacy={defaultViewMode:defaultViewMode(settings.defaultViewMode),viewMode:isViewMode(settings.viewMode)?settings.viewMode:'split',outlineVisible:settings.outlineVisible!==false,sync:settings.sync!==false};
  return Object.fromEntries(presentationTypes.map(kind=>{
    const input=object(all[kind]),caps=presentationCapabilities(kind);
    return [kind,{defaultViewMode:input.defaultViewMode==='last'||isViewMode(input.defaultViewMode)?input.defaultViewMode:legacy.defaultViewMode,viewMode:isViewMode(input.viewMode)?input.viewMode:legacy.viewMode,outlineVisible:caps.outline&&bool(input.outlineVisible,legacy.outlineVisible),sync:caps.sync&&bool(input.sync,legacy.sync)}];
  }));
}
export function presentationFor(settings={},kind='markdown'){
  return normalizeFileTypeSettings(settings)[kind]??{defaultViewMode:'source',viewMode:'source',outlineVisible:false,sync:false};
}
export function updateFileTypeSettings(settings={},kind,change={}){
  const all=normalizeFileTypeSettings(settings);
  if(!presentationTypes.includes(kind))return all;
  const allowed=Object.fromEntries(Object.entries(object(change)).filter(([key])=>['defaultViewMode','viewMode','outlineVisible','sync'].includes(key)));
  return normalizeFileTypeSettings({...settings,fileTypeSettings:{...all,[kind]:{...all[kind],...allowed}}});
}
export function initialViewMode(settings={},kind='markdown'){
  const value=presentationFor(settings,kind);
  return value.defaultViewMode==='last'?value.viewMode:value.defaultViewMode;
}
