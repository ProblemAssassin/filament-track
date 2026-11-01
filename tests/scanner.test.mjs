import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {parseLabel} from '../core.js';import {barcodeReader} from '../barcode.js';
const source=fs.readFileSync(new URL('../scanner.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'').replace('export class LabelScanner','class LabelScanner')+'\nthis.Scanner=LabelScanner;';
function environment(getUserMedia){
 const timers=new Map(),results=[],messages=[],camera=[];let number=0,stops=0;
 const track={stop:()=>stops++},stream={getTracks:()=>[track],getVideoTracks:()=>[track]},video={videoWidth:640,videoHeight:480,play:async()=>{}};
 const canvas=()=>({width:2,height:2,toDataURL:()=> 'data:image/jpeg;base64,test',getContext:()=>({translate(){},rotate(){},drawImage(){}})});
 const context={parseLabel,barcodeReader,Date,Map,Uint8ClampedArray,Error,Math,Promise,Image:class{width=2;height=2;async decode(){}},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},window:{isSecureContext:true},navigator:{mediaDevices:{getUserMedia:getUserMedia||(async()=>stream)}},document:{createElement:canvas},setTimeout:(fn,ms)=>{const id=++number;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
 vm.createContext(context);vm.runInContext(source,context);const scanner=new context.Scanner(video,value=>results.push(value),message=>messages.push(message),active=>camera.push(active));
 scanner.decode=async()=>'';return {scanner,context,results,messages,camera,video,stream,timers,stops:()=>stops};
}
const settle=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
test('normal live scanning never starts OCR and schedules a fresh frame after a miss',async()=>{
 const e=environment();e.scanner.running=true;e.scanner.held=false;e.scanner.read=()=>{throw new Error('Barcode mode must not run OCR');};
 await e.scanner.loop(e.scanner.generation);assert.equal(e.results.length,0);assert.equal(e.scanner.busy,false);assert.ok([...e.timers.values()].some(timer=>timer.ms===200));e.scanner.stop();
});
test('a barcode photo returns immediately without creating an OCR worker',async()=>{
 const e=environment();e.scanner.decode=async()=> '6975337030270';e.scanner.read=()=>{throw new Error('Barcode photos must not wait for OCR');};
 await e.scanner.photo({size:100,type:'image/jpeg'});assert.equal(e.results[0].code,'6975337030270');assert.equal(e.results[0].source,'Barcode');assert.equal(e.scanner.workerPromise,null);
});
test('late camera permission after cancellation releases the stream instead of restarting the preview',async()=>{
 let permit;const e=environment(()=>new Promise(resolve=>{permit=resolve;}));const starting=e.scanner.start();e.scanner.stop();permit(e.stream);
 assert.equal(await starting,false);assert.equal(e.scanner.running,false);assert.equal(e.video.srcObject,null);assert.ok(e.stops()>0);assert.ok(!e.camera.includes(true));
});
test('double camera start opens only one stream and native capability discovery cannot delay it',async()=>{
 let calls=0;const e=environment(async()=>{calls++;return e.stream;});e.context.window.BarcodeDetector=class{static getSupportedFormats(){return new Promise(()=>{});}};
 await Promise.all([e.scanner.start(),e.scanner.start()]);assert.equal(calls,1);assert.equal(e.scanner.running,true);assert.ok(e.camera.includes(true));e.scanner.stop();
});
test('a hung video preview produces a bounded retry error and releases the camera',async()=>{
 const e=environment(async()=>e.stream);e.video.play=()=>new Promise(()=>{});const starting=e.scanner.start();await settle();
 const timer=[...e.timers.values()].find(value=>value.ms===8000);assert.ok(timer);timer.fn();await assert.rejects(starting,/preview did not start/);assert.equal(e.scanner.running,false);assert.equal(e.video.srcObject,null);assert.ok(e.stops()>0);
});
