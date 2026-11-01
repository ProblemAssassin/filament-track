import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';import crypto from 'node:crypto';
const source=fs.readFileSync(new URL('../bridge.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'').replace('export class GoogleBridge','class GoogleBridge')+'\nthis.GoogleBridge=GoogleBridge;';
function environment(){
 const origin='https://n-qa-script.googleusercontent.com',channel=crypto.randomUUID(),statuses=[],sent=[],openerMessages=[];
 const context={URLSearchParams,location:{hash:'#bridge='+channel+'&googleOrigin='+encodeURIComponent(origin)},crypto:{randomUUID:()=>crypto.randomUUID()},window:{opener:{postMessage:(...args)=>openerMessages.push(args)},addEventListener(){}},setTimeout:()=>1,clearTimeout(){},getScriptUrl:()=>'',saveScriptUrl(){}};
 vm.createContext(context);vm.runInContext(source,context);const bridge=new context.GoogleBridge((...s)=>statuses.push(s));bridge.connect();
 const target={postMessage:(...args)=>sent.push(args)};
 const message=(type,options={})=>bridge.message({origin:options.origin||origin,source:options.source||target,data:{channel:options.channel||channel,type,...options.data}});
 return{bridge,origin,channel,statuses,target,sent,message,openerMessages};
}
test('connection pins the Google origin and nonce, independent of wrapper opener identity',()=>{const e=environment();e.message('tracker-ready',{origin:'https://other-script.googleusercontent.com'});assert.equal(e.bridge.target,null);e.message('tracker-ready',{channel:crypto.randomUUID()});assert.equal(e.bridge.target,null);e.message('tracker-ready');assert.equal(e.bridge.target,e.target);assert.equal(e.statuses.at(-1)[0],'connected');});
test('responses from another window cannot satisfy a pending save',async()=>{const e=environment();e.message('tracker-ready');const promise=e.bridge.call({method:'list'});const id=e.sent[0][0].id;e.message('tracker-response',{source:{},data:{id,result:{ok:true,wrong:true}}});assert.equal(e.bridge.pending.size,1);e.message('tracker-response',{data:{id,result:{ok:true,products:[]}}});const result=await promise;assert.equal(result.ok,true);assert.equal(e.bridge.pending.size,0);});
test('explicit server errors remain distinct from unconfirmed transport failures',async()=>{const e=environment();e.message('tracker-ready');const promise=e.bridge.call({method:'mutate'});const id=e.sent[0][0].id;e.message('tracker-response',{data:{id,error:'Out of stock'}});await assert.rejects(promise,error=>error.serverRejected===true&&error.message==='Out of stock');});
