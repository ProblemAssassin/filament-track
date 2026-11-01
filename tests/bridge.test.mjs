import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';import crypto from 'node:crypto';
const source=fs.readFileSync(new URL('../bridge.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'').replace('export class GoogleBridge','class GoogleBridge')+'\nthis.GoogleBridge=GoogleBridge;';
function environment(){
 const origin='https://n-qa-script.googleusercontent.com',channel=crypto.randomUUID(),statuses=[],sent=[],openerMessages=[],late=[],timers=new Map();let nextTimer=0;
 const context={URLSearchParams,location:{hash:'#bridge='+channel+'&googleOrigin='+encodeURIComponent(origin)},crypto:{randomUUID:()=>crypto.randomUUID()},window:{opener:{postMessage:(...args)=>openerMessages.push(args)},addEventListener(){}},setTimeout:(fn,delay)=>{timers.set(++nextTimer,{fn,delay});return nextTimer;},clearTimeout:id=>timers.delete(id),getScriptUrl:()=>'',saveScriptUrl(){}};
 vm.createContext(context);vm.runInContext(source,context);const bridge=new context.GoogleBridge((...s)=>statuses.push(s),(request,result)=>late.push({request,result}));bridge.connect();
 const target={postMessage:(...args)=>sent.push(args)};
 const message=(type,options={})=>bridge.message({origin:options.origin||origin,source:options.source||target,data:{channel:options.channel||channel,type,...options.data}});
 return{bridge,origin,channel,statuses,target,sent,message,openerMessages,late,fire(delay){const entry=[...timers].find(([,t])=>t.delay===delay);assert.ok(entry,'Missing timer '+delay);timers.delete(entry[0]);entry[1].fn();}};
}
test('connection pins the Google origin and nonce, independent of wrapper opener identity',()=>{const e=environment();e.message('tracker-ready',{origin:'https://other-script.googleusercontent.com'});assert.equal(e.bridge.target,null);e.message('tracker-ready',{channel:crypto.randomUUID()});assert.equal(e.bridge.target,null);e.message('tracker-ready');assert.equal(e.bridge.target,e.target);assert.equal(e.statuses.at(-1)[0],'connected');});
test('responses from another window cannot satisfy a pending save',async()=>{const e=environment();e.message('tracker-ready');const promise=e.bridge.call({method:'list'});const id=e.sent[0][0].id;e.message('tracker-response',{source:{},data:{id,result:{ok:true,wrong:true}}});assert.equal(e.bridge.pending.size,1);e.message('tracker-response',{data:{id,result:{ok:true,products:[]}}});const result=await promise;assert.equal(result.ok,true);assert.equal(e.bridge.pending.size,0);});
test('explicit server errors remain distinct from unconfirmed transport failures',async()=>{const e=environment();e.message('tracker-ready');const promise=e.bridge.call({method:'mutate'});const id=e.sent[0][0].id;e.message('tracker-response',{data:{id,error:'Out of stock'}});await assert.rejects(promise,error=>error.serverRejected===true&&error.message==='Out of stock');});
test('slow feedback distinguishes a paused Google tab from an acknowledged request',async()=>{
 const e=environment(),progress=[];e.message('tracker-ready');const promise=e.bridge.call({method:'list'},value=>progress.push(value));const id=e.sent[0][0].id;
 e.message('tracker-accepted',{source:{},data:{id}});assert.equal(progress.length,0);
 e.message('tracker-accepted',{data:{id}});assert.equal(progress[0].stage,'accepted');e.fire(6000);assert.equal(progress[1].accepted,true);
 e.message('tracker-response',{data:{id,result:{ok:true}}});await promise;
});
test('a late save confirmation is delivered once after transport timeout instead of discarded',async()=>{
 const e=environment(),request={method:'mutate',requestId:crypto.randomUUID()};e.message('tracker-ready');const promise=e.bridge.call(request);const id=e.sent[0][0].id;
 const rejection=assert.rejects(promise,/not confirmed/);e.fire(45000);await rejection;assert.equal(e.bridge.pending.size,1);
 const result={ok:true,event:{requestId:request.requestId},state:{products:[]}};
 e.message('tracker-response',{data:{id,result}});e.message('tracker-response',{data:{id,result}});
 assert.equal(e.late.length,1);assert.equal(e.late[0].request.requestId,request.requestId);assert.equal(e.bridge.pending.size,0);
});
test('timed-out reads expire immediately and late saves have bounded retention',async()=>{
 for(const method of ['list','mutate']){
  const e=environment();e.message('tracker-ready');const promise=e.bridge.call({method});const rejection=assert.rejects(promise);e.fire(45000);await rejection;
  if(method==='mutate')e.fire(300000);assert.equal(e.bridge.pending.size,0);
 }
});
