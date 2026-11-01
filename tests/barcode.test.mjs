import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {barcodeReader} from '../barcode.js';
const context={BigInt,TextDecoder,TextEncoder};context.window=context;context.self=context;context.global=context;vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../vendor/zxing.min.js',import.meta.url),'utf8'),context);
const decode=barcodeReader(context.ZXing);
const left=['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
const parity=['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];
function fixture(code,vertical=false){
 const right=left.map(bits=>bits.replace(/[01]/g,bit=>bit==='0'?'1':'0')),g=right.map(bits=>[...bits].reverse().join(''));
 const bars='101'+[...code.slice(1,7)].map((digit,i)=>(parity[code[0]][i]==='L'?left:g)[digit]).join('')+'01010'+[...code.slice(7)].map(digit=>right[digit]).join('')+'101';
 const width=bars.length*3+60,height=120,data=new Uint8ClampedArray(width*height*4).fill(255);
 for(let y=20;y<100;y++)for(let x=0;x<bars.length*3;x++)if(bars[Math.floor(x/3)]==='1'){const p=(y*width+x+30)*4;data[p]=data[p+1]=data[p+2]=0;}
 if(!vertical)return {data,width,height};
 const rotated=new Uint8ClampedArray(data.length);for(let y=0;y<height;y++)for(let x=0;x<width;x++)rotated.set(data.subarray((y*width+x)*4,(y*width+x+1)*4),(x*height+height-1-y)*4);
 return {data:rotated,width:height,height:width};
}
for(const vertical of [false,true])test('real ZXing decodes '+(vertical?'vertical':'horizontal')+' EAN-13 bars without OCR',()=>{
 const image=fixture('6975337030270',vertical);assert.equal(decode(image.data,image.width,image.height),'6975337030270');
});
test('invalid barcode checksums and a blank frame are rejected',()=>{
 const invalid=fixture('6975337030271');assert.equal(decode(invalid.data,invalid.width,invalid.height),'');assert.equal(decode(new Uint8ClampedArray(320*240*4).fill(255),320,240),'');
});
test('an off-centre barcode is found within a larger camera frame',()=>{
 const image=fixture('4006381333931',true),width=700,height=900,data=new Uint8ClampedArray(width*height*4).fill(255);
 for(let y=0;y<image.height;y++)data.set(image.data.subarray(y*image.width*4,(y+1)*image.width*4),((y+430)*width+460)*4);
 assert.equal(decode(data,width,height),'4006381333931');
});
