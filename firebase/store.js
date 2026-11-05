import {clean,normal,keyFor,validateDraft} from '../core.js';

export async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
function reject(message){const error=new Error(message);error.serverRejected=true;throw error;}
export function productInput(input={}){
  const product={};
  for(const field of ['id','material','colour','brand','barcode','sku','filamentCode','location','variant']){
    product[field]=clean(input[field]);
    if(product[field].length>(field==='location'?160:120)||/[\x00-\x1f]/.test(product[field]))reject('A product field is too long or contains invalid characters.');
  }
  product.weight=Number(input.weight);product.diameter=Number(input.diameter);product.variant||='Unspecified';
  const error=validateDraft(product,'ADD');if(error)reject(error);
  if([product.brand,product.material,product.colour,product.variant].some(value=>value.includes('|')))reject('Do not use | in material, colour, brand or format.');
  return product;
}
function timestamp(value){return value?.toDate?value.toDate().toISOString():new Date().toISOString();}
function productView(snapshot){const data=snapshot.data();return {...data,id:snapshot.id,updatedAt:timestamp(data.updatedAt)};}
function eventView(data,id){const {hash,...event}=data;return {...event,requestId:id,timestamp:timestamp(data.timestamp)};}

export class FirestoreStore{
  constructor(db,uid,sdk){this.db=db;this.uid=uid;this.sdk=sdk;this.products=[];this.events=[];this.codes=[];this.sheetUrl='';}
  ref(collection,id){return this.sdk.doc(this.db,'users',this.uid,collection,id);}
  response(){
    const aliases=new Map();for(const code of this.codes){if(!aliases.has(code.productId))aliases.set(code.productId,[]);aliases.get(code.productId).push(code.value);}
    return {ok:true,products:this.products.map(p=>({...p,aliases:[...new Set([p.barcode,p.sku,...(aliases.get(p.id)||[])].filter(Boolean))]})),events:this.events,updatedAt:new Date().toISOString(),sheetUrl:this.sheetUrl};
  }
  async list(){
    const s=this.sdk;
    const [products,events,settings,codes]=await Promise.all([
      s.getDocs(s.collection(this.db,'users',this.uid,'products')),
      s.getDocs(s.query(s.collection(this.db,'users',this.uid,'events'),s.orderBy('timestamp','desc'),s.limit(100))),
      s.getDoc(this.ref('meta','settings')),
      s.getDocs(s.collection(this.db,'users',this.uid,'codes'))
    ]);
    this.products=products.docs.map(productView);this.events=events.docs.map(doc=>eventView(doc.data(),doc.id));this.sheetUrl=settings.data()?.sheetUrl||'';this.codes=codes.docs.map(doc=>doc.data());
    return this.response();
  }
  async receipt(id){const doc=await this.sdk.getDoc(this.ref('events',id));return {ok:true,found:doc.exists(),event:doc.exists()?eventView(doc.data(),id):null,state:await this.list()};}
  async mutate(request,{opening=false}={}){
    if(!/^[A-Za-z0-9-]{20,100}$/.test(request.requestId||''))reject('Invalid transaction ID.');
    if(!opening&&!['ADD','USE'].includes(request.mode))reject('Choose Add or Use.');
    const proposed=productInput(request.product),s=this.sdk;
    const id=proposed.id||await digest(keyFor(proposed));
    if(id!==await digest(keyFor(proposed)))reject('The saved filament identity does not match these details.');
    const mode=opening?'OPENING':request.mode,delta=opening?Number(request.product.storage):mode==='ADD'?1:-1;
    if(!Number.isInteger(delta)||opening&&(delta<0||delta>100000))reject('Invalid opening stock.');
    const source=opening?'Migration':['Barcode','Label','Manual'].includes(request.source)?request.source:'Manual';
    const hash=await digest(JSON.stringify({mode,product:proposed,source,...(opening?{storage:delta}:{})}));
    const aliases=await Promise.all([...new Set([proposed.barcode,proposed.sku].map(normal).filter(Boolean))].map(async value=>({value,id:await digest(value)})));
    let result;
    try{result=await s.runTransaction(this.db,async transaction=>{
      const eventRef=this.ref('events',request.requestId),productRef=this.ref('products',id);
      const receipt=await transaction.get(eventRef);
      if(receipt.exists()){
        if(receipt.data().hash!==hash)reject('This transaction ID was already used for different details.');
        return {replayed:true,event:eventView(receipt.data(),request.requestId),product:null};
      }
      const saved=await transaction.get(productRef),existing=saved.exists()?saved.data():null;
      if(opening&&existing)reject('This filament already exists. Opening stock was not imported twice.');
      if(proposed.id&&!existing||mode==='USE'&&!existing)reject('Choose an existing filament to use.');
      const product=existing?{...existing}:proposed;
      delete product.id;
      if(existing&&keyFor(existing)!==keyFor(proposed))reject('Existing filament details cannot change during a stock update.');
      for(const field of ['barcode','sku','filamentCode']){
        if(field!=='barcode'&&existing?.[field]&&proposed[field]&&normal(existing[field])!==normal(proposed[field]))reject('This filament already has a different '+field+'.');
        if(proposed[field]&&!existing?.[field])product[field]=proposed[field];
      }
      // All reads precede all writes, including unique barcode/SKU reservations.
      for(const alias of aliases){const savedAlias=await transaction.get(this.ref('codes',alias.id));if(savedAlias.exists()&&savedAlias.data().productId!==id)reject('This barcode or SKU is already linked to another filament.');}
      const before=existing?.storage||0,balance=before+delta;
      if(balance<0)reject('This filament is out of stock. Nothing was deducted.');
      product.storage=balance;product.updatedAt=s.serverTimestamp();product.lastRequestId=request.requestId;
      const event={productId:id,material:product.material,colour:product.colour,brand:product.brand,mode,delta,balance,source,hash,timestamp:s.serverTimestamp()};
      transaction.set(productRef,product);transaction.set(eventRef,event);
      for(const alias of aliases)transaction.set(this.ref('codes',alias.id),{value:alias.value,productId:id});
      return {event:eventView(event,request.requestId),product:{...product,id,updatedAt:new Date().toISOString()}};
    });}catch(error){
      // A concurrent replay can lose its create race before the SDK retries it.
      // A matching immutable receipt is the authority; never create a fresh ID.
      let receipt;try{receipt=await s.getDoc(this.ref('events',request.requestId));}catch{throw error;}
      if(!receipt.exists())throw error;
      if(receipt.data().hash!==hash)reject('This transaction ID was already used for different details.');
      result={replayed:true,event:eventView(receipt.data(),request.requestId),product:null};
    }
    if(result.product){const index=this.products.findIndex(p=>p.id===id);if(index<0)this.products.push(result.product);else this.products[index]=result.product;}
    else{const snapshot=await s.getDoc(this.ref('products',id));if(snapshot.exists()){const index=this.products.findIndex(p=>p.id===id);if(index<0)this.products.push(productView(snapshot));else this.products[index]=productView(snapshot);}}
    if(!this.events.some(e=>e.requestId===request.requestId))this.events=[result.event,...this.events].slice(0,100);
    for(const alias of aliases)if(!this.codes.some(code=>code.value===alias.value))this.codes.push({value:alias.value,productId:id});
    return {ok:true,replayed:!!result.replayed,event:result.event,state:this.response()};
  }
  async importProducts(products){
    if(!Array.isArray(products)||!products.length||products.length>500)throw new Error('Choose an inventory export containing 1 to 500 varieties.');
    let imported=0;
    for(const product of products){
      const input=productInput({...product,id:''}),id=await digest(keyFor(input));
      await this.mutate({requestId:'opening-'+id,product:{...input,storage:product.storage},source:'Migration'},{opening:true});imported++;
    }
    return {ok:true,imported,state:await this.list()};
  }
}
