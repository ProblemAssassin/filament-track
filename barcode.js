// One finite decode per frame. BrowserMultiFormatReader's still-image helper can
// retry checksum/format failures indefinitely on the same image; live scans must
// always return so the next camera frame gets a chance.
export function barcodeRegions(gray,width,height){
  const found=[];
  for(const vertical of [false,true]){
    const length=vertical?height:width,across=vertical?width:height,step=Math.max(1,Math.floor(across/48)),gap=Math.max(8,Math.floor(length*.018));
    for(let line=step;line<across;line+=step){
      let edges=[],previous=gray[vertical?line:line*width]<128;
      const finish=()=>{
        if(edges.length>=28){
          const span=edges.at(-1)-edges[0];
          if(span>=55){const pad=Math.max(12,Math.ceil(span*.06)),band=Math.max(36,Math.ceil(span*.48)),start=Math.max(0,edges[0]-pad),end=Math.min(length,edges.at(-1)+pad),side=Math.max(0,Math.round(line-band/2)),size=Math.min(across-side,band);
            found.push({x:vertical?side:start,y:vertical?start:side,width:vertical?size:end-start,height:vertical?end-start:size,vertical,score:edges.length*edges.length/span});}
        }edges=[];
      };
      for(let at=1;at<length;at++){
        const dark=gray[vertical?at*width+line:line*width+at]<128;
        if(dark!==previous){
          let low=255,high=0;for(let offset=-2;offset<=2;offset++){const p=Math.max(0,Math.min(length-1,at+offset)),value=gray[vertical?p*width+line:line*width+p];low=Math.min(low,value);high=Math.max(high,value);}
          if(high-low>=70){if(edges.length&&at-edges.at(-1)>gap)finish();edges.push(at);}
        }previous=dark;
      }
      finish();
    }
  }
  const regions=[];
  for(const region of found.sort((a,b)=>b.score-a.score)){
    if(regions.some(other=>other.vertical===region.vertical&&Math.abs(other.x-region.x)<region.width*.35&&Math.abs(other.y-region.y)<region.height*.35))continue;
    regions.push(region);if(regions.length===4)break;
  }
  return regions;
}
export function barcodeReader(zxing){
  const reader=new zxing.MultiFormatReader();
  const hints=new Map([
    [zxing.DecodeHintType.POSSIBLE_FORMATS,['EAN_13','EAN_8','UPC_A','UPC_E','CODE_128','CODE_39','CODE_93','ITF'].map(name=>zxing.BarcodeFormat[name])]
  ]);
  return (rgba,width,height)=>{
    const gray=new Uint8ClampedArray(width*height);
    for(let i=0;i<gray.length;i++){const p=i*4;gray[i]=rgba[p+3]===0?255:(rgba[p]*306+rgba[p+1]*601+rgba[p+2]*117+512)>>10;}
    const rotated=(data,w,h)=>{const result=new Uint8ClampedArray(data.length);for(let y=0;y<h;y++)for(let x=0;x<w;x++)result[x*h+h-1-y]=data[y*w+x];return result;};
    const regions=barcodeRegions(gray,width,height);
    const attempts=regions.map(region=>{
      const data=new Uint8ClampedArray(region.width*region.height);for(let y=0;y<region.height;y++)data.set(gray.subarray((region.y+y)*width+region.x,(region.y+y)*width+region.x+region.width),y*region.width);
      return region.vertical?{data:rotated(data,region.width,region.height),w:region.height,h:region.width}:{data,w:region.width,h:region.height};
    });
    attempts.push({data:gray,w:width,h:height},{data:rotated(gray,width,height),w:height,h:width});
    for(const {data,w,h} of attempts){
      try{return reader.decode(new zxing.BinaryBitmap(new zxing.HybridBinarizer(new zxing.RGBLuminanceSource(data,w,h))),hints).getText();}
      catch{/* A failed frame is normal. The next frame may be sharp or better aligned. */}
      finally{reader.reset();}
    }
    return '';
  };
}
