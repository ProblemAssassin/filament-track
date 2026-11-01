import { getScriptUrl } from './config.js';
export class GoogleBridge {
  constructor(onStatus) {this.status=onStatus;this.pending=new Map();this.target=null;this.origin='';this.channel='';window.addEventListener('message',e=>this.message(e));}
  connect(){
    for(const [,p] of this.pending){clearTimeout(p.timer);p.reject(new Error('Connection restarted. Check the previous save before retrying.'));}this.pending.clear();
    this.channel=crypto.randomUUID();this.target=null;this.origin='';
    const scriptUrl=getScriptUrl();if(!scriptUrl){this.status('error','Connect this device using your private Google connection URL.');return;}
    this.status('connecting','Connecting to your private Google Sheet…');
    clearTimeout(this.readyTimer);
    this.readyTimer=setTimeout(()=>{if(!this.target)this.status('error','Google needs a sign-in, authorisation, or permission to use its connection. Open Google connection, then reconnect.');},22000);
    document.getElementById('google-bridge').src=scriptUrl+'?channel='+encodeURIComponent(this.channel)+'&origin='+encodeURIComponent(window.location.origin);
  }
  message(event){
    if(!/^https:\/\/[a-z0-9-]+-script\.googleusercontent\.com$/.test(event.origin))return;
    const d=event.data;
    if(!d||d.channel!==this.channel)return;
    if(d.type==='tracker-ready'){
      if(this.target&&event.source!==this.target)return;
      clearTimeout(this.readyTimer);this.target=event.source;this.origin=event.origin;this.status('connected','Connected to your private Google Sheet.');return;
    }
    if(d.type==='tracker-error'){clearTimeout(this.readyTimer);this.status('error',String(d.error||'Google connection failed.'));return;}
    if(d.type!=='tracker-response'||event.source!==this.target||event.origin!==this.origin)return;
    const pending=this.pending.get(d.id);if(!pending)return;
    clearTimeout(pending.timer);this.pending.delete(d.id);
    if(d.error){const error=new Error(String(d.error));error.serverRejected=true;pending.reject(error);}else if(!d.result?.ok)pending.reject(new Error('Google did not confirm the operation.'));else pending.resolve(d.result);
  }
  call(request){
    if(!this.target)return Promise.reject(new Error('Connect Google Sheets before saving.'));
    const id=crypto.randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Google has not confirmed this request yet. Check its status before scanning another roll.'));},45000);
      this.pending.set(id,{resolve,reject,timer});
      this.target.postMessage({type:'tracker-request',channel:this.channel,id,request},this.origin);
    });
  }
}
