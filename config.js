const key='filament-track-google-connection-v1';
export function getScriptUrl(){try{return localStorage.getItem(key)||'';}catch{return '';}}
export function saveScriptUrl(value){const url=String(value||'').trim();if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/.test(url))throw new Error('Paste the Google Apps Script web app URL ending in /exec.');localStorage.setItem(key,url);return url;}
