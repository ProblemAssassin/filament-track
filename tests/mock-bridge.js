// Local UI audit adapter. Only tests/serve.mjs --fixture can substitute this for bridge.js.
const products=[{id:'qa-charcoal',material:'PLA',colour:'Charcoal Black',brand:'Bambu Lab',weight:1000,diameter:1.75,storage:1,variant:'Unspecified',location:'Shelf A',sku:'FIL-PLA-001',barcode:'',filamentCode:''}];const events=[];const receipts=new Map();
const copy=()=>({ok:true,products:structuredClone(products),events:structuredClone(events),updatedAt:new Date().toISOString()});
export class GoogleBridge{
 constructor(status){this.status=status;}
 connect(){setTimeout(()=>{this.status('connected','QA fixture only. No Google Sheet writes.');document.getElementById('connection-label').textContent='QA fixture · no Sheet writes';},50);}
 async call(r){await new Promise(resolve=>setTimeout(resolve,80));if(r.method==='list')return copy();if(r.method==='receipt')return{ok:true,found:receipts.has(r.requestId),state:copy()};if(receipts.has(r.requestId))return receipts.get(r.requestId);let p=products.find(p=>p.id===r.product.id);if(r.mode==='USE'&&(!p||p.storage<1)){const e=new Error('Out of stock. Nothing was deducted.');e.serverRejected=true;throw e;}if(!p){p={...r.product,id:crypto.randomUUID(),storage:0};products.push(p);}p.storage+=r.mode==='ADD'?1:-1;const event={requestId:r.requestId,timestamp:new Date().toISOString(),material:p.material,colour:p.colour,brand:p.brand,delta:r.mode==='ADD'?1:-1,mode:r.mode,balance:p.storage,source:r.source};events.unshift(event);const result={ok:true,event,state:copy()};receipts.set(r.requestId,result);return result;}
}
