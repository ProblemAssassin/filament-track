import { getScriptUrl, saveScriptUrl } from './config.js';
export class GoogleBridge {
  constructor(onStatus,onLateResult=()=>{}) {this.status=onStatus;this.onLateResult=onLateResult;this.pending=new Map();this.target=null;this.origin='';this.channel='';window.addEventListener('message',e=>this.message(e));}
  connect(){
    for(const [,p] of this.pending){clearTimeout(p.timer);clearTimeout(p.slowTimer);clearTimeout(p.expiry);p.reject(new Error('Connection restarted. Check the previous save before retrying.'));}this.pending.clear();
    this.channel=crypto.randomUUID();this.target=null;this.origin='';
    const parameters=new URLSearchParams(location.hash.slice(1)),launchedChannel=parameters.get('bridge'),expectedOrigin=parameters.get('googleOrigin');
    if(launchedChannel&&/^[a-zA-Z0-9-]{16,100}$/.test(launchedChannel)&&/^https:\/\/[a-z0-9-]+-script\.googleusercontent\.com$/.test(expectedOrigin||'')){
      this.expectedOrigin=expectedOrigin;
      this.channel=launchedChannel;this.status('connecting','Connecting through your signed-in Google tab…');
      clearTimeout(this.readyTimer);this.readyTimer=setTimeout(()=>{if(!this.target)this.status('error','Return to your Google connection tab and choose Open connected app. Keep that tab open while scanning.');},22000);
      // The hello contains only a random channel, never inventory or credentials.
      if(window.opener)window.opener.postMessage({type:'tracker-hello',channel:this.channel},expectedOrigin);return;
    }
    const scriptUrl=getScriptUrl();if(!scriptUrl){this.status('error','Connect this device using your private Google connection URL.');return;}
    this.status('error','Open your Google connection, then choose Open connected app. Keep the Google tab open in the background while scanning.');return;
  }
  message(event){
    if(!/^https:\/\/[a-z0-9-]+-script\.googleusercontent\.com$/.test(event.origin))return;
    if(event.origin!==this.expectedOrigin)return;
    const d=event.data;
    if(!d||d.channel!==this.channel)return;
    if(this.target&&event.source!==this.target)return;
    if(d.type==='tracker-ready'){
      if(this.target&&event.source!==this.target)return;
      if(d.connectionUrl){try{saveScriptUrl(d.connectionUrl);}catch{}}
      clearTimeout(this.readyTimer);this.target=event.source;this.origin=event.origin;this.status('connected','Connected to your private Google Sheet.');return;
    }
    if(d.type==='tracker-error'){clearTimeout(this.readyTimer);this.status('error',String(d.error||'Google connection failed.'));return;}
    if(!['tracker-response','tracker-accepted'].includes(d.type)||event.source!==this.target||event.origin!==this.origin)return;
    const pending=this.pending.get(d.id);if(!pending)return;
    if(d.type==='tracker-accepted'){pending.accepted=true;pending.progress({stage:'accepted'});return;}
    clearTimeout(pending.timer);clearTimeout(pending.slowTimer);clearTimeout(pending.expiry);this.pending.delete(d.id);
    if(pending.late){if(!d.error&&d.result?.ok&&d.result.event)this.onLateResult(pending.request,d.result);return;}
    if(d.error){const error=new Error(String(d.error));error.serverRejected=true;pending.reject(error);}else if(!d.result?.ok)pending.reject(new Error('Google did not confirm the operation.'));else pending.resolve(d.result);
  }
  wake(){try{if(window.opener&&!window.opener.closed){window.opener.focus();return true;}}catch{}return false;}
  call(request,progress=()=>{}){
    if(!this.target)return Promise.reject(new Error('Connect Google Sheets before saving.'));
    const id=crypto.randomUUID();
    return new Promise((resolve,reject)=>{
      const entry={resolve,reject,request,progress,accepted:false,late:false};
      entry.slowTimer=setTimeout(()=>progress({stage:'slow',accepted:entry.accepted}),6000);
      entry.timer=setTimeout(()=>{
        clearTimeout(entry.slowTimer);
        if(request.method==='mutate'){
          entry.late=true;entry.expiry=setTimeout(()=>this.pending.delete(id),300000);
        }else this.pending.delete(id);
        reject(new Error('Google has not confirmed this request yet. Finish / check the pending save before scanning another roll.'));
      },45000);
      this.pending.set(id,entry);
      this.target.postMessage({type:'tracker-request',channel:this.channel,id,request},this.origin);
    });
  }
}
