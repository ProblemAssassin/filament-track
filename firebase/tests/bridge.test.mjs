import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../firebase-bridge.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'').replace('export class FirebaseBridge','class FirebaseBridge')+'\nthis.Bridge=FirebaseBridge;';
function environment(){
 const calls=[],statuses=[];
 const context={initializeApp:()=>({}),firebaseConfig:{},getAuth:()=>({}),firestore:{getFirestore:()=>({})},performance,setTimeout,clearTimeout,GoogleAuthProvider:class{setCustomParameters(value){this.parameters=value;}},signInWithPopup:async(auth,provider)=>calls.push(provider.parameters),signOut:async()=>{},browserLocalPersistence:{}};
 vm.createContext(context);vm.runInContext(source,context);
 const bridge=new context.Bridge((...status)=>statuses.push(status));bridge.user={uid:'owner-one'};bridge.store={mutate:async()=>{calls.push('mutate');return {ok:true};}};
 return {bridge,calls,statuses};
}
test('a pending roll cannot be submitted through another Google account',async()=>{
 const {bridge,calls}=environment();await assert.rejects(bridge.call({method:'mutate',accountUid:'owner-two'}),/different Google account/);assert.equal(calls.length,0);
});
test('a committed save includes measured duration and leaves no progress timer running',async()=>{
 const {bridge,calls}=environment();const result=await bridge.call({method:'mutate',accountUid:'owner-one'});assert.equal(calls.length,1);assert.equal(result.ok,true);assert.ok(Number.isFinite(result.durationMs));
});
test('sign-in requests the Google account picker directly from the user action',async()=>{
 const {bridge,calls}=environment();await bridge.signIn();assert.equal(calls[0].prompt,'select_account');
});
test('results from the previous account cannot update the current dashboard',async()=>{
 const {bridge}=environment();let finish;bridge.store.mutate=()=>new Promise(resolve=>{finish=resolve;});
 const request=bridge.call({method:'mutate',accountUid:'owner-one'});bridge.epoch++;finish({ok:true});await assert.rejects(request,/account changed/);
});
