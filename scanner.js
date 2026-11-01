import {parseLabel} from './core.js';
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
  constructor(video,onResult,onProgress,onCamera){this.video=video;this.onResult=onResult;this.progress=onProgress;this.onCamera=onCamera;this.stream=null;this.running=false;this.held=false;this.busy=false;this.generation=0;this.workerPromise=null;this.lastOcr=0;this.reader=null;this.autoOcr=true;this.labelOnly=false;}
  async start(){
    await this.stop();const generation=++this.generation;this.held=false;
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw new Error('Live camera needs HTTPS and a supported browser. You can still take or upload a photo.');
    let stream;
    try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});}
    catch(e){const messages={NotAllowedError:'Camera access was denied or blocked. Allow camera access in browser settings, or take/upload a photo.',NotFoundError:'No camera was found. Take/upload a label photo instead.',NotReadableError:'The camera is busy. Close other camera apps and try again.',OverconstrainedError:'This camera cannot use the requested settings. Take/upload a photo instead.'};throw new Error(messages[e.name]||'Could not start the camera. Take/upload a photo instead.');}
    if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());return;}
    this.stream=stream;this.video.srcObject=stream;await this.video.play();
    if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());return;}
    this.running=true;this.onCamera(true);this.progress('Point at the label. Barcode lookup and label reading are active.');
    if(window.BarcodeDetector){try{const formats=await BarcodeDetector.getSupportedFormats();this.detector=new BarcodeDetector({formats:formats.filter(f=>['qr_code','code_128','code_39','ean_13','ean_8','upc_a','upc_e','itf','data_matrix'].includes(f))});}catch{this.detector=null;}}
    this.lastOcr=0;this.loop(generation);
  }
  async stop(){this.generation++;this.running=false;this.held=true;clearTimeout(this.timer);if(this.stream)this.stream.getTracks().forEach(t=>t.stop());this.stream=null;this.video.srcObject=null;this.onCamera(false);}
  hold(){this.held=true;clearTimeout(this.timer);}
  resume(){this.held=false;this.lastOcr=0;if(this.running)this.loop(this.generation);}
  frame(){
    if(!this.video.videoWidth)throw new Error('The camera is still starting. Try again in a moment.');
    const canvas=document.createElement('canvas'),scale=Math.min(1,1800/Math.max(this.video.videoWidth,this.video.videoHeight));
    canvas.width=Math.round(this.video.videoWidth*scale);canvas.height=Math.round(this.video.videoHeight*scale);canvas.getContext('2d').drawImage(this.video,0,0,canvas.width,canvas.height);return canvas;
  }
  async decode(canvas){
    if(this.detector){try{const codes=await this.detector.detect(canvas);if(codes[0]?.rawValue)return codes[0].rawValue;}catch{}}
    if(!window.ZXing)return '';
    try{this.reader ||= new ZXing.BrowserMultiFormatReader();const image=new Image();image.src=canvas.toDataURL('image/png');await image.decode();return (await this.reader.decodeFromImageElement(image)).getText();}catch{return '';}
  }
  async worker(){
    if(!this.workerPromise){
      if(!window.Tesseract)throw new Error('Text recognition did not load. Refresh or enter the details manually.');
      this.workerPromise=Tesseract.createWorker('eng',1,{workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',langPath:'https://tessdata.projectnaptha.com/4.0.0',logger:m=>{if(m.status==='recognizing text')this.progress('Reading label… '+Math.round(m.progress*100)+'%');else if(m.status?.startsWith('loading'))this.progress('Preparing text recognition. First use downloads the reading engine…');}}).catch(e=>{this.workerPromise=null;throw e;});
    }
    return this.workerPromise;
  }
  async read(canvas){const worker=await this.worker();return (await worker.recognize(canvas)).data.text;}
  async loop(generation){
    if(!this.running||this.held||generation!==this.generation)return;
    if(this.busy){this.timer=setTimeout(()=>this.loop(generation),500);return;}
    this.busy=true;
    try{
      const canvas=this.frame();let code=this.labelOnly?'':await this.decode(canvas);
      if(generation!==this.generation||this.held)return;
      if(code){this.hold();this.onResult({code,source:'Barcode',image:canvas.toDataURL('image/jpeg',.8)});return;}
      if(this.autoOcr&&Date.now()-this.lastOcr>4500){
        this.lastOcr=Date.now();const text=await this.read(canvas);
        if(generation!==this.generation||this.held)return;
        const parsed=parseLabel(text);
        if(parsed.material&&parsed.colour){this.hold();this.onResult({text,source:'Label',image:canvas.toDataURL('image/jpeg',.8)});return;}
        this.progress('Keep the label steady and fill the guide. You can also tap Read label.');
      }
    }catch(e){if(generation===this.generation){this.autoOcr=false;this.progress('Automatic label reading paused. Tap Read label or enter manually.');}}
    finally{this.busy=false;if(this.running&&!this.held&&generation===this.generation)this.timer=setTimeout(()=>this.loop(generation),800);}
  }
  async capture(){
    if(this.busy)throw new Error('Reading is already in progress. Wait for the result.');
    this.hold();this.busy=true;const generation=this.generation;
    try{const canvas=this.frame();const code=this.labelOnly?'':await this.decode(canvas);const text=await this.read(canvas);if(generation!==this.generation)return;this.onResult({code,text,source:text?'Label':'Barcode',image:canvas.toDataURL('image/jpeg',.8)});}
    catch(e){if(generation===this.generation)this.resume();throw e;}finally{this.busy=false;}
  }
  async photo(file){
    if(file.size>25*1024*1024)throw new Error('Choose a photo smaller than 25 MB.');
    if(!file.type.startsWith('image/'))throw new Error('Choose an image of the label.');
    await this.stop();const generation=this.generation;this.busy=true;
    const url=URL.createObjectURL(file);
    try{
      const image=new Image();image.src=url;
      try{await image.decode();}catch{throw new Error('This image format could not be opened. Choose JPEG or PNG, or take another photo.');}
      let best={text:'',score:-1,canvas:null},code='';
      const label=cropPaper(image);
      const angles=label.height>label.width?[90,270,0,180]:[0,180,90,270];
      for(const angle of angles){
        if(generation!==this.generation)return;
        const swap=angle%180!==0,width=swap?label.height:label.width,height=swap?label.width:label.height,scale=Math.min(1,2400/Math.max(width,height));
        const canvas=document.createElement('canvas');canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);const ctx=canvas.getContext('2d');ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(angle*Math.PI/180);ctx.drawImage(label,-label.width*scale/2,-label.height*scale/2,label.width*scale,label.height*scale);
        if(!this.labelOnly)code ||= await this.decode(canvas);
        const text=await this.read(canvas),parsed=parseLabel(text),score=Number(!!parsed.material)*4+Number(!!parsed.colour)*4+Number(!!parsed.brand)*2+Number(!!parsed.filamentCode)+Number(!!parsed.sku);
        if(score>best.score)best={text,score,canvas};
        if(score>=10||code&&score<4)break;
      }
      if(generation!==this.generation)return;
      this.onResult({code,text:best.text,source:code?'Barcode':'Label',image:best.canvas?.toDataURL('image/jpeg',.8)});
    }finally{URL.revokeObjectURL(url);this.busy=false;}
  }
}
