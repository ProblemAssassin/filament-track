import {parseLabel} from './core.js';
import {barcodeReader} from './barcode.js';
function limited(promise,ms,message){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);})]).finally(()=>clearTimeout(timer));}
function picture(image,max=1800,angle=0){
  const swap=angle%180!==0,width=swap?image.height:image.width,height=swap?image.width:image.height,scale=Math.min(1,max/Math.max(width,height));
  const canvas=document.createElement('canvas');canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(angle*Math.PI/180);ctx.drawImage(image,-image.width*scale/2,-image.height*scale/2,image.width*scale,image.height*scale);return canvas;
}
// Prefer a large, internal light-paper label over surrounding box texture.
// If no confident region is found, retain the entire image.
function cropPaper(image){
  const sample=document.createElement('canvas'),ratio=Math.min(1,400/Math.max(image.width,image.height));sample.width=Math.round(image.width*ratio);sample.height=Math.round(image.height*ratio);
  const ctx=sample.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,sample.width,sample.height);const {data}=ctx.getImageData(0,0,sample.width,sample.height),w=sample.width,h=sample.height,mask=new Uint8Array(w*h),visited=new Uint8Array(w*h);let best=null;
  for(let i=0;i<mask.length;i++){const r=data[i*4],g=data[i*4+1],b=data[i*4+2];mask[i]=Math.min(r,g,b)>145&&Math.max(r,g,b)-Math.min(r,g,b)<65?1:0;}
  for(let start=0;start<mask.length;start++){
    if(!mask[start]||visited[start])continue;
    const queue=[start];visited[start]=1;let head=0,minX=w,minY=h,maxX=0,maxY=0,count=0;
    while(head<queue.length){const index=queue[head++],x=index%w,y=Math.floor(index/w);count++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      for(const [nx,ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]])if(nx>=0&&nx<w&&ny>=0&&ny<h){const n=ny*w+nx;if(mask[n]&&!visited[n]){visited[n]=1;queue.push(n);}}
    }
    const area=(maxX-minX+1)*(maxY-minY+1),edge=minX<2||minY<2||maxX>w-3||maxY>h-3;
    if(!edge&&count>w*h*.018&&count/area>.35&&(!best||count>best.count))best={minX,minY,maxX,maxY,count};
  }
  if(!best)return image;
  const padding=7/ratio,x=Math.max(0,best.minX/ratio-padding),y=Math.max(0,best.minY/ratio-padding),width=Math.min(image.width-x,(best.maxX-best.minX+1)/ratio+padding*2),height=Math.min(image.height-y,(best.maxY-best.minY+1)/ratio+padding*2);
  const crop=document.createElement('canvas');crop.width=Math.round(width);crop.height=Math.round(height);crop.getContext('2d').drawImage(image,x,y,width,height,0,0,crop.width,crop.height);return crop;
}
export class LabelScanner {
  constructor(video,onResult,onProgress,onCamera){this.video=video;this.onResult=onResult;this.progress=onProgress;this.onCamera=onCamera;this.stream=null;this.running=false;this.held=false;this.busy=false;this.generation=0;this.workerPromise=null;this.lastOcr=0;this.reader=null;this.autoOcr=false;this.labelOnly=false;this.startPromise=null;this.job=null;this.readingText=false;}
  async start(){
    if(this.startPromise)return this.startPromise;
    const opening=this.openCamera();this.startPromise=opening;
    try{return await opening;}finally{if(this.startPromise===opening)this.startPromise=null;}
  }
  async openCamera(){
    this.stop();const generation=++this.generation;this.held=false;
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw new Error('Live camera needs HTTPS and a supported browser. You can still take or upload a photo.');
    let stream,cancelled=false;
    try{
      const requested=navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:24,max:30}},audio:false});
      requested.then(value=>{if(cancelled||generation!==this.generation)value.getTracks().forEach(track=>track.stop());},()=>{});
      stream=await limited(requested,12000,'The camera has not responded. Check the camera permission, or take/upload a photo.');
      if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());return false;}
      this.stream=stream;this.video.muted=true;this.video.srcObject=stream;
      await limited(this.video.play(),8000,'The camera preview did not start. Take/upload a photo, or try the camera again.');
      if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());return false;}
      try{const track=stream.getVideoTracks?.()[0];if(track?.getCapabilities?.().focusMode?.includes('continuous'))track.applyConstraints({advanced:[{focusMode:'continuous'}]}).catch(()=>{});}catch{/* Optional camera controls vary by phone. */}
      this.running=true;this.onCamera(true);this.progress('Barcode scanner ready. Keep the whole barcode in view. For printed details, tap Read label or take a photo.');
      // Native capability discovery must never hold up the camera or JS decoder.
      this.detector=null;
      if(window.BarcodeDetector)limited(window.BarcodeDetector.getSupportedFormats(),800,'Native scanner unavailable').then(formats=>{
        if(generation===this.generation&&formats.length)this.detector=new window.BarcodeDetector({formats:formats.filter(f=>['qr_code','code_128','code_39','ean_13','ean_8','upc_a','upc_e','itf','data_matrix'].includes(f))});
      }).catch(()=>{});
      this.lastOcr=Date.now();this.loop(generation);return true;
    }catch(e){
      cancelled=true;if(stream)stream.getTracks().forEach(t=>t.stop());
      if(generation!==this.generation)return false;
      this.stop();const messages={NotAllowedError:'Camera access was denied or blocked. Allow camera access in browser settings, or take/upload a photo.',NotFoundError:'No camera was found. Take/upload a photo instead.',NotReadableError:'The camera is busy. Close other camera apps and try again.',OverconstrainedError:'This camera cannot use the requested settings. Take/upload a photo instead.'};throw new Error(messages[e.name]||e.message||'Could not start the camera. Take/upload a photo instead.');
    }
  }
  stop(){this.generation++;this.startPromise=null;this.running=false;this.held=true;this.job=null;this.busy=false;this.photoBusy=false;clearTimeout(this.timer);if(this.stream)this.stream.getTracks().forEach(t=>t.stop());this.stream=null;this.video.srcObject=null;if(this.readingText){const worker=this.workerPromise;this.workerPromise=null;worker?.then(value=>value.terminate()).catch(()=>{});}this.readingText=false;this.onCamera(false);}
  hold(){this.held=true;clearTimeout(this.timer);}
  resume(){this.held=false;this.lastOcr=0;if(this.running)this.loop(this.generation);}
  frame(){
    if(!this.video.videoWidth)throw new Error('The camera is still starting. Try again in a moment.');
    const canvas=document.createElement('canvas'),scale=Math.min(1,1280/Math.max(this.video.videoWidth,this.video.videoHeight));
    canvas.width=Math.round(this.video.videoWidth*scale);canvas.height=Math.round(this.video.videoHeight*scale);canvas.getContext('2d').drawImage(this.video,0,0,canvas.width,canvas.height);return canvas;
  }
  async decode(canvas){
    if(this.detector){try{const codes=await limited(this.detector.detect(canvas),600,'Native scan timed out');if(codes[0]?.rawValue)return codes[0].rawValue;}catch{this.detector=null;}}
    if(!window.ZXing)return '';
    try{this.reader ||= barcodeReader(window.ZXing);const pixels=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height);return this.reader(pixels.data,canvas.width,canvas.height);}catch{return '';}
  }
  async worker(){
    if(!this.workerPromise){
      if(!window.Tesseract)throw new Error('Text recognition did not load. Refresh or enter the details manually.');
      this.progress('Preparing label reader… the first label downloads the reading engine. Barcode scans do not need it.');
      const loading=window.Tesseract.createWorker('eng',1,{
        workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',
        langPath:'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int',legacyCore:false,legacyLang:false,cachePath:'filament-track-eng-int-v1',
        errorHandler:()=>{}, // Job promises carry errors to the visible retry/manual fallback.
        logger:m=>{if(!this.readingText)return;const percent=Math.round((m.progress||0)*100);if(m.status==='recognizing text')this.progress('Reading label… '+percent+'%');else if(m.status?.startsWith('loading'))this.progress('Preparing label reader… '+m.status.replace('loading ','')+' '+percent+'%');}
      });
      this.workerPromise=limited(loading,30000,'The label reader download is taking too long. Check your connection and retry, or enter the details manually.').catch(e=>{this.workerPromise=null;loading.then(w=>w.terminate()).catch(()=>{});throw e;});
    }
    return this.workerPromise;
  }
  async read(canvas){
    this.readingText=true;const generation=this.generation;let worker;
    try{worker=await this.worker();if(generation!==this.generation)return '';return (await limited(worker.recognize(canvas),20000,'Label reading took too long. Try a closer, upright photo or enter the details manually.')).data.text;}
    catch(e){if(generation===this.generation){this.workerPromise=null;worker?.terminate().catch(()=>{});}throw new Error(e?.message||String(e)||'Label reading failed. Try another photo or enter manually.');}
    finally{if(generation===this.generation)this.readingText=false;}
  }
  labelFrame(canvas){return cropPaper(canvas);}
  async loop(generation){
    if(!this.running||this.held||generation!==this.generation)return;
    if(this.busy){this.timer=setTimeout(()=>this.loop(generation),500);return;}
    const job={};this.job=job;this.busy=true;
    try{
      const canvas=this.frame();let code=this.labelOnly?'':await this.decode(canvas);
      if(generation!==this.generation||this.held)return;
      if(code){this.hold();this.onResult({code,source:'Barcode',image:canvas.toDataURL('image/jpeg',.8)});return;}
      if(this.labelOnly&&this.autoOcr&&Date.now()-this.lastOcr>4500){
        this.lastOcr=Date.now();const text=await this.read(canvas);
        if(generation!==this.generation||this.held)return;
        const parsed=parseLabel(text);
        if(parsed.material&&parsed.colour){this.hold();this.onResult({text,source:'Label',image:canvas.toDataURL('image/jpeg',.8)});return;}
        this.progress('Keep the label steady and fill the guide. You can also tap Read label.');
      }
    }catch(e){if(generation===this.generation){this.autoOcr=false;this.progress(this.video.videoWidth?'Keep the barcode steady, or tap Read label / take a photo.':'Camera is warming up…');}}
    finally{if(this.job===job){this.job=null;this.busy=false;}if(this.running&&!this.held&&generation===this.generation)this.timer=setTimeout(()=>this.loop(generation),200);}
  }
  async capture(){
    if(this.readingText||this.photoBusy)throw new Error('Reading is already in progress. Wait for the result.');
    this.hold();const job={};this.job=job;this.busy=true;const generation=this.generation;
    try{const canvas=this.frame();const text=await this.read(this.labelFrame(canvas));if(generation!==this.generation)return;this.onResult({text,source:'Label',image:canvas.toDataURL('image/jpeg',.8)});}
    catch(e){if(generation!==this.generation)return;this.resume();throw e;}finally{if(this.job===job){this.job=null;this.busy=false;}}
  }
  async photo(file){
    this.stop();
    if(file.size>25*1024*1024)throw new Error('Choose a photo smaller than 25 MB.');
    if(!file.type.startsWith('image/'))throw new Error('Choose an image of the label.');
    const generation=this.generation;this.busy=true;this.photoBusy=true;
    const url=URL.createObjectURL(file);
    try{
      const image=new Image();image.src=url;
      try{await image.decode();}catch{throw new Error('This image format could not be opened. Choose JPEG or PNG, or take another photo.');}
      // A barcode photo returns immediately, before any OCR download or job.
      if(!this.labelOnly){
        this.progress('Checking photo for a barcode…');const canvas=picture(image,2400),code=await this.decode(canvas);
        if(generation!==this.generation)return;
        if(code){this.onResult({code,source:'Barcode',image:canvas.toDataURL('image/jpeg',.8)});return;}
      }
      let best={text:'',score:-1,canvas:null};
      const label=cropPaper(image);
      const angles=label.height>label.width?[270,90]:[0,180];
      for(const angle of angles){
        if(generation!==this.generation)return;
        const canvas=picture(label,1800,angle);
        const text=await this.read(canvas),parsed=parseLabel(text),score=Number(!!parsed.material)*4+Number(!!parsed.colour)*4+Number(!!parsed.brand)*2+Number(!!parsed.filamentCode)+Number(!!parsed.sku);
        if(score>best.score)best={text,score,canvas};
        if(score>=8)break;
      }
      if(generation!==this.generation)return;
      this.onResult({text:best.text,source:'Label',image:best.canvas?.toDataURL('image/jpeg',.8)});
    }finally{URL.revokeObjectURL(url);if(generation===this.generation){this.busy=false;this.photoBusy=false;}}
  }
}
