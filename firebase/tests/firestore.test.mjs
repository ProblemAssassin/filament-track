import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {FirestoreStore,digest} from '../store.js';
import {keyFor} from '../../core.js';
const require=createRequire(process.env.FIREBASE_QA_PACKAGE||import.meta.url);
const sdk=require('firebase/firestore');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
let environment,db,store;
const product={material:'PLA Basic',colour:'Red',brand:'Bambu Lab',weight:1000,diameter:1.75,variant:'Refill',barcode:'6975337030270',sku:'A00-R0-1.75-1000-SPLFREE',filamentCode:'10200',location:'Shelf A'};
const operation=(p=product,mode='ADD',requestId=crypto.randomUUID())=>({method:'mutate',product:p,mode,requestId,source:'Barcode'});
before(async()=>{environment=await initializeTestEnvironment({projectId:'demo-filament-track',firestore:{host:'127.0.0.1',port:8088,rules:fs.readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}});});
beforeEach(async()=>{
 await environment.clearFirestore();
 await environment.withSecurityRulesDisabled(async context=>{await sdk.setDoc(sdk.doc(context.firestore(),'owners','owner'),{enabled:true,importOpen:true});});
 db=environment.authenticatedContext('owner',{email_verified:true}).firestore();store=new FirestoreStore(db,'owner',sdk);
});
after(async()=>{await environment?.cleanup();});
test('only the verified allowlisted owner can read inventory or write data',async()=>{
 await assertSucceeds(store.list());
 for(const otherDb of [environment.unauthenticatedContext().firestore(),environment.authenticatedContext('other',{email_verified:true}).firestore(),environment.authenticatedContext('owner',{email_verified:false}).firestore()]){
  await assertFails(sdk.getDocs(sdk.collection(otherDb,'users','owner','products')));
  await assertFails(sdk.setDoc(sdk.doc(otherDb,'owners','other'),{enabled:true}));
 }
});
test('Add and Use atomically update stock and append an immutable matching receipt',async()=>{
 const added=await store.mutate(operation());assert.equal(added.state.products[0].storage,1);
 const used=await store.mutate(operation(added.state.products[0],'USE'));assert.equal(used.state.products[0].storage,0);
 const fresh=await store.list();assert.equal(fresh.products[0].storage,0);assert.equal(fresh.events.length,2);
 await assertFails(sdk.updateDoc(store.ref('events',used.event.requestId),{balance:999}));
 await assertFails(sdk.deleteDoc(store.ref('events',used.event.requestId)));
});
test('replaying a request ID counts one roll and changed request content is rejected',async()=>{
 const request=operation();await store.mutate(request);assert.equal((await store.mutate(request)).replayed,true);
 assert.equal((await store.list()).products[0].storage,1);
 await assert.rejects(store.mutate({...request,mode:'USE'}),/different details/);
});
test('two simultaneous submissions with the same request ID commit only once',async()=>{
 const request=operation();await Promise.all([store.mutate(request),new FirestoreStore(db,'owner',sdk).mutate(request)]);
 const fresh=await store.list();assert.equal(fresh.products[0].storage,1);assert.equal(fresh.events.length,1);
});
test('using zero stock or an unknown product is rejected',async()=>{
 await assert.rejects(store.mutate(operation(product,'USE')),/existing/);
 const saved=await store.mutate(operation());await store.mutate(operation(saved.state.products[0],'USE'));
 await assert.rejects(store.mutate(operation(saved.state.products[0],'USE')),/out of stock/);
 assert.equal((await store.list()).products[0].storage,0);
});
test('barcode and SKU aliases cannot be attached to a second filament',async()=>{
 await store.mutate(operation());
 await assert.rejects(store.mutate(operation({...product,colour:'Blue'})),/already linked/);
 await assert.rejects(store.mutate(operation({...product,colour:'Blue',barcode:'OTHER'})),/already linked/);
 assert.equal((await store.list()).products.length,1);
});
test('direct writes cannot change stock without a new paired receipt',async()=>{
 const saved=await store.mutate(operation()),ref=store.ref('products',saved.state.products[0].id);
 await assertFails(sdk.updateDoc(ref,{storage:100,updatedAt:sdk.serverTimestamp()}));
 await assertFails(sdk.updateDoc(ref,{storage:-1,updatedAt:sdk.serverTimestamp()}));
 await assertFails(sdk.updateDoc(ref,{colour:'Blue',updatedAt:sdk.serverTimestamp()}));
 await assertFails(sdk.deleteDoc(ref));
});
test('security rules reject a forged multi-roll Add even when product and receipt agree',async()=>{
 const id=await digest(keyFor(product)),requestId=crypto.randomUUID(),batch=sdk.writeBatch(db);
 const data={...product,storage:5,updatedAt:sdk.serverTimestamp(),lastRequestId:requestId};
 batch.set(store.ref('products',id),data);
 batch.set(store.ref('events',requestId),{productId:id,material:product.material,colour:product.colour,brand:product.brand,mode:'ADD',delta:5,balance:5,source:'Manual',hash:'a'.repeat(64),timestamp:sdk.serverTimestamp()});
 for(const value of [product.barcode,product.sku])batch.set(store.ref('codes',await digest(value)),{value,productId:id});
 await assertFails(batch.commit());assert.equal((await store.list()).products.length,0);
});
test('opening balance import is repeat-safe and cannot run after setup closes imports',async()=>{
 const opening={...product,storage:7};await store.importProducts([opening]);await store.importProducts([opening]);assert.equal((await store.list()).products[0].storage,7);
 await environment.withSecurityRulesDisabled(async context=>{await sdk.updateDoc(sdk.doc(context.firestore(),'owners','owner'),{importOpen:false});});
 await assertFails(store.importProducts([{...opening,barcode:'NEW',sku:'NEW-SKU',colour:'Blue'}]));
});
test('canonical barcode spelling is preserved and a second owner cannot access these records',async()=>{
 const saved=await store.mutate(operation({...product,sku:'mixed-case'}));
 await store.mutate(operation({...saved.state.products[0],sku:'MIXED-CASE'}));assert.equal((await store.list()).products[0].sku,'mixed-case');
 await environment.withSecurityRulesDisabled(async context=>{await sdk.setDoc(sdk.doc(context.firestore(),'owners','other'),{enabled:true});});
 const other=environment.authenticatedContext('other',{email_verified:true}).firestore();await assertFails(sdk.getDoc(sdk.doc(other,'users','owner','products',saved.state.products[0].id)));
});
