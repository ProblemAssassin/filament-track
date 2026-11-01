import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as core from '../core.js';
import {LabelScanner} from '../scanner.js';

const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'')+'\nthis.flow={state,scanner,bridge,resetDraft,received,scanMaterialLabel,saveRoll};';
const barcode='6975337030270';
const label='Bambu Lab PLA Basic Red Filament Code 10200';
const red={id:'red',material:'PLA Basic',colour:'Red',brand:'Bambu Lab',weight:750,diameter:2.85,variant:'Refill',barcode:'',sku:'',filamentCode:'10200',storage:1};
function environment(products=[],mode='ADD'){
  class Element{
    constructor(){this.value='';this.hidden=false;this.open=false;this.listeners=new Map();this.style={};this.classList={toggle(){}};}
    addEventListener(type,fn){const list=this.listeners.get(type)||[];list.push(fn);this.listeners.set(type,list);}
    setAttribute(){}append(){}prepend(){}replaceChildren(){}focus(){}
    showModal(){this.open=true;}close(){this.open=false;for(const fn of this.listeners.get('close')||[])fn({});}
  }
  const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  class Scanner{
    constructor(video,result,progress,camera){this.result=result;this.progress=progress;this.camera=camera;this.running=false;this.held=true;}
    async start(){this.running=true;this.held=false;this.camera(true);}stop(){this.running=false;this.held=true;this.camera(false);}
    hold(){this.held=true;}resume(){this.held=false;}async photo(){this.stop();this.result(this.nextPhoto);}
  }
  class Bridge{
    constructor(){this.calls=[];}connect(){}
    async call(request){
      this.calls.push(request);assert.equal(request.method,'mutate');
      const p={...request.product,id:request.product.id||'new-product'};
      const previous=flow.state.products.find(x=>x.id===p.id);p.storage=(previous?.storage||0)+(request.mode==='ADD'?1:-1);
      const products=[...flow.state.products.filter(x=>x.id!==p.id),p];
      const event={requestId:request.requestId,material:p.material,colour:p.colour,source:request.source,mode:request.mode,delta:request.mode==='ADD'?1:-1,balance:p.storage,timestamp:new Date().toISOString()};
      return {ok:true,event,state:{ok:true,products,events:[event],updatedAt:new Date().toISOString()}};
    }
  }
  const storage=new Map();
  const context={...core,GoogleBridge:Bridge,LabelScanner:Scanner,getScriptUrl:()=>'',saveScriptUrl(){},googleAccountChooserUrl(){},
    crypto,Intl,Date,URL,Blob,setTimeout:()=>1,clearTimeout(){},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    document:{getElementById:element,createElement:()=>new Element(),querySelector:element,addEventListener(){}},
    window:{addEventListener(){},scrollTo(){}}};
  vm.createContext(context);vm.runInContext(source,context);const flow=context.flow;
  Object.assign(flow.state,{products:structuredClone(products),mode,loaded:true,connected:true});flow.resetDraft();element('scan-dialog').open=true;
  return {...flow,element,async click(id){for(const fn of element(id).listeners.get('click')||[])await fn({target:element(id)});},
    async photo(result){flow.scanner.nextPhoto=result;for(const fn of element('photo-input').listeners.get('change')||[])await fn({target:{files:[{type:'image/jpeg'}],value:'photo.jpg'}});}};
}
test('new barcode prompts for a label, keeps its details, and saves exactly one linked roll on confirmation',async()=>{
  const e=environment();e.received({code:barcode,text:'SKU: TEST-RED-750 Refill 750 g 2.85 mm',source:'Barcode'});
  assert.equal(e.element('label-link-prompt').hidden,false);assert.equal(e.element('label-link-code').textContent,barcode);
  assert.equal(e.element('product-form').hidden,true);assert.equal(e.element('ok-button').disabled,true);assert.equal(e.bridge.calls.length,0);
  await e.click('scan-material-label');assert.equal(e.scanner.labelOnly,true);assert.equal(e.scanner.running,true);
  e.received({text:label,source:'Label'});
  assert.equal(e.element('label-link-prompt').hidden,true);assert.equal(e.state.draft.barcode,barcode);
  assert.equal(e.state.draft.sku,'TEST-RED-750');assert.equal(e.state.draft.weight,750);assert.equal(e.state.draft.diameter,'2.85');assert.equal(e.state.draft.variant,'Refill');
  assert.equal(e.element('ok-button').disabled,false);assert.equal(e.bridge.calls.length,0);
  await e.click('ok-button');assert.equal(e.bridge.calls.length,1);assert.equal(e.bridge.calls[0].product.barcode,barcode);assert.equal(e.state.products[0].storage,1);
});
test('a saved barcode is recognised directly and Scan another clears the old tagging state',async()=>{
  const e=environment([{...red,barcode}]);e.received({code:barcode,source:'Barcode'});
  assert.equal(e.state.selectedId,'red');assert.equal(e.element('label-link-prompt').hidden,true);assert.equal(e.scanner.labelOnly,false);
  await e.click('next-button');assert.equal(e.state.products[0].storage,2);assert.equal(e.state.lastBarcode,'');assert.equal(e.state.readingLabel,false);assert.equal(e.scanner.labelOnly,false);
  e.received({code:'UNFAMILIAR-NEXT-BOX',source:'Barcode'});assert.equal(e.state.draft.material,'');assert.equal(e.state.draft.barcode,'UNFAMILIAR-NEXT-BOX');assert.equal(e.element('label-link-prompt').hidden,false);
});
test('Use can tag an existing filament after reading its label but cannot use an unknown product',async()=>{
  const e=environment([red],'USE');e.received({code:barcode,source:'Barcode'});await e.click('scan-material-label');e.received({text:label,source:'Label'});
  assert.equal(e.state.selectedId,'red');assert.equal(e.element('ok-button').disabled,false);await e.click('ok-button');
  assert.equal(e.bridge.calls[0].mode,'USE');assert.equal(e.bridge.calls[0].product.barcode,barcode);assert.equal(e.state.products[0].storage,0);
  const unknown=environment([],'USE');unknown.received({code:barcode,source:'Barcode'});await unknown.click('scan-material-label');unknown.received({text:label,source:'Label'});
  assert.equal(unknown.element('ok-button').disabled,true);assert.equal(unknown.bridge.calls.length,0);
});
test('label photo and retake keep the box barcode even if OCR reads a different valid number',async()=>{
  const e=environment();e.received({code:barcode,text:'750 g 2.85 mm Refill',source:'Barcode'});
  await e.photo({text:label+' 4006381333931',source:'Label'});
  assert.equal(e.state.draft.barcode,barcode);assert.equal(e.state.draft.weight,750);assert.equal(e.state.readingLabel,true);
  await e.click('retake-button');assert.equal(e.state.lastBarcode,barcode);assert.equal(e.scanner.labelOnly,true);
  e.received({text:'Bambu Lab PLA Basic',source:'Label'});assert.equal(e.state.draft.colour,'Red');assert.equal(e.state.draft.barcode,barcode);
});
test('a new barcode is never silently discarded when a matching product has a different saved barcode',async()=>{
  const e=environment([{...red,barcode:'OTHER-SAVED-CODE'}]);e.received({code:barcode,source:'Barcode'});await e.click('scan-material-label');e.received({text:label,source:'Label'});
  assert.equal(e.state.draft.barcode,barcode);assert.equal(e.element('ok-button').disabled,true);assert.match(e.element('draft-alert').textContent,/different barcode/);assert.equal(e.bridge.calls.length,0);
});
test('manual fallback retains the new barcode and permits reviewed details',async()=>{
  const e=environment();e.received({code:barcode,source:'Barcode'});await e.click('tag-manually');
  assert.equal(e.element('product-form').hidden,false);assert.equal(e.element('field-barcode').value,barcode);
  for(const [key,value] of Object.entries({material:'PLA Basic',colour:'Red',brand:'Bambu Lab'}))e.element('field-'+key).value=value;
  await e.click('ok-button');assert.equal(e.bridge.calls.length,1);assert.equal(e.bridge.calls[0].product.barcode,barcode);
});
test('a shared filament code cannot discard the package weight when tagging a different roll size',async()=>{
  const e=environment([{...red,weight:1000}]);e.received({code:barcode,text:'750 g 2.85 mm Refill',source:'Barcode'});
  await e.click('scan-material-label');e.received({text:label,source:'Label'});
  assert.equal(e.state.selectedId,'');assert.equal(e.state.draft.weight,750);assert.equal(e.state.draft.barcode,barcode);
});
test('label-only live scan and Read label bypass barcode detection and deliver OCR',async()=>{
  for(const action of ['loop','capture']){
    const results=[],scanner=new LabelScanner({},r=>results.push(r),()=>{},()=>{});
    scanner.running=true;scanner.held=false;scanner.labelOnly=true;
    scanner.frame=()=>({toDataURL:()=> 'data:image/jpeg;base64,test'});scanner.decode=()=>{throw new Error('Barcode decoding must not intercept the label step');};scanner.read=async()=>label;
    if(action==='loop')await scanner.loop(scanner.generation);else await scanner.capture();
    assert.equal(results.length,1);assert.equal(results[0].text,label);assert.equal(results[0].source,'Label');
  }
});
