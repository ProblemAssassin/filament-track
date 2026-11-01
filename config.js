const key='filament-track-google-connection-v1';
export function normalizeScriptUrl(value){
  let url;try{url=new URL(String(value||'').trim());}catch{}
  const match=url?.pathname.match(/^\/macros\/(?:u\/\d+\/)?s\/([A-Za-z0-9_-]{20,})\/exec\/?$/);
  if(!url||url.origin!=='https://script.google.com'||url.username||url.password||!match)throw new Error('Paste the Google Apps Script web app URL ending in /exec.');
  // Account indexes belong to one browser session. Never reuse them on another device.
  return 'https://script.google.com/macros/s/'+match[1]+'/exec';
}
export function getScriptUrl(){try{const value=localStorage.getItem(key);return value?normalizeScriptUrl(value):'';}catch{return '';}}
export function saveScriptUrl(value){const url=normalizeScriptUrl(value);localStorage.setItem(key,url);return url;}
export function googleAccountChooserUrl(value){
  const chooser=new URL('https://accounts.google.com/AccountChooser');
  chooser.searchParams.set('continue',normalizeScriptUrl(value));
  return chooser.href;
}
