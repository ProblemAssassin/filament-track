import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import crypto from 'node:crypto';
import * as core from '../../core.js';import {readInventoryCsv} from '../import-csv.js';
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8'),html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=app.replace(/^import[^\n]*\n/gm,'')+'\nthis.ui={state,bridge};';
function environment(signedIn=false){
 class Element{constructor(){this.hidden=false;this.value='';this.open=false;this.style={};this.classList={toggle(){}};this.listeners=new Map();}setAttribute(){}replaceChildren(){}append(){}prepend(){}focus(){}showModal(){this.open=true;}close(){this.open=false;}addEventListener(type,fn){const handlers=this.listeners.get(type)||[];handlers.push(fn);this.listeners.set(type,handlers);}async click(){if(this.disabled)return;for(const fn of this.listeners.get('click')||[])await fn({target:this});}}
 const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};element('auth-dashboard').hidden=true;
 class Bridge{constructor(status){this.status=status;this.user=signedIn?{displayName:'Test Owner'}:null;this.owner={enabled:true};this.calls=[];this.signIns=0;}connect(){this.status(this.user?'connected':'signedout','Choose your Google account.');}async signIn(){this.signIns++;this.user={displayName:'Test Owner'};this.status('connected','Signed in.');}async signOut(){this.user=null;this.status('signedout','Signed out.');}async call(request){this.calls.push(request);assert.equal(request.method,'list');return {ok:true,products:[],events:[],updatedAt:new Date().toISOString()};}}
 const context={...core,readInventoryCsv,FirebaseBridge:Bridge,LabelScanner:class{stop(){}hold(){}},crypto,Intl,Date,URL,Blob,setTimeout:()=>1,clearTimeout(){},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},document:{getElementById:element,createElement:()=>new Element(),querySelector:element,addEventListener(){}},window:{addEventListener(){},scrollTo(){}}};
 vm.createContext(context);vm.runInContext(source,context);return {...context.ui,element,async settle(){await new Promise(resolve=>setImmediate(resolve));}};
}
test('the entry page has every referenced control and no Google connection URL field',()=>{
 const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));
 for(const [,id] of app.matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.has(id),'Missing '+id);
 assert.ok(!html.includes('id="connection-url"'));assert.ok(html.includes('id="auth-dashboard" hidden'));assert.ok(html.includes('Sign in with Google'));
});
test('signed-out visitors see sign-in before any inventory request or dashboard',async()=>{
 const e=environment();await e.settle();assert.equal(e.element('auth-gate').hidden,false);assert.equal(e.element('auth-dashboard').hidden,true);assert.equal(e.bridge.calls.length,0);assert.equal(e.element('auth-signin').disabled,false);
});
test('one Google sign-in action opens the dashboard without tapping Add or a connection button',async()=>{
 const e=environment();await e.element('auth-signin').click();await e.settle();assert.equal(e.bridge.signIns,1);assert.equal(e.bridge.calls.length,1);assert.equal(e.element('auth-gate').hidden,true);assert.equal(e.element('auth-dashboard').hidden,false);assert.equal(e.state.loaded,true);
});
test('a saved session loads the dashboard directly and sign-out hides inventory',async()=>{
 const e=environment(true);await e.settle();assert.equal(e.element('auth-dashboard').hidden,false);assert.equal(e.bridge.signIns,0);
 await e.element('sign-out').click();assert.equal(e.element('auth-dashboard').hidden,true);assert.equal(e.element('auth-gate').hidden,false);assert.equal(e.state.products.length,0);
});
const headers='Material,Colour,In Storage,Brand,Weight (g),Diameter (mm),Barcode,SKU,Filament Code,Variant,Location';
test('inventory CSV import preserves counts, quoted commas, quotes and newlines',()=>{
 const rows=readInventoryCsv('\ufeff'+headers+'\r\n"PLA Basic","Red, Blue",3,"Bambu Lab",1000,1.75,6975337030270,SKU-1,10200,Refill,"Shelf ""A""\nTop"\r\n');
 assert.equal(rows.length,1);assert.equal(rows[0].storage,3);assert.equal(rows[0].colour,'Red, Blue');assert.equal(rows[0].location,'Shelf "A"\nTop');
});
test('inventory CSV import rejects wrong exports, incomplete rows and negative counts',()=>{
 for(const value of ['not,inventory\n1,2',headers+'\nPLA,Red,-1,Brand,1000,1.75,,,,,Shelf',headers+'\nPLA,Red,1',headers+'\n"unclosed'])assert.throws(()=>readInventoryCsv(value));
});
test('CSV formula protection is decoded as text during migration without executing it',()=>{
 const rows=readInventoryCsv(headers+'\nPLA,Red,1,Brand,1000,1.75,,\'=SKU-1,,,Shelf');assert.equal(rows[0].sku,'=SKU-1');
});
