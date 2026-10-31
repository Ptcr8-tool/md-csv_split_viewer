// URLs opened externally must never carry credentials, controls or a local scheme.
export function safeBrowserUrl(value){
  if(typeof value!=='string'||value.length>8192||/[\s\u0000-\u001f\u007f]/u.test(value))return null;
  try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}
}

// Rendered Markdown also supports relative paths and local images. Reject any
// control character instead of normalizing it into an executable scheme.
export function safeMarkdownUrl(value,{image=false}={}){
  if(typeof value!=='string'||/[\u0000-\u001f\u007f]/u.test(value))return false;
  const url=value.trim();
  if(image&&/^data:image\/(?:png|jpeg|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i.test(url))return true;
  if(image&&/^[a-z]:[\\/]/i.test(url))return true;
  if(image&&/^mdsplit-asset:\/\//i.test(url))return true;
  try{
    const parsed=new URL(url,'https://mdsplit.invalid/');
    return (image?['http:','https:','file:','blob:']:['http:','https:','mailto:']).includes(parsed.protocol);
  }catch{return false;}
}
