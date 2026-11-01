export function readInventoryCsv(value){
  const source=String(value).replace(/^\ufeff/,'');if(source.length>1024*1024)throw new Error('Choose an inventory CSV smaller than 1 MB.');
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<source.length;i++){
    const character=source[i];
    if(character==='"'){
      if(quoted&&source[i+1]==='"'){field+='"';i++;}else if(quoted||field==='')quoted=!quoted;else throw new Error('Invalid CSV quoting.');
    }else if(!quoted&&(character===','||character==='\r'||character==='\n')){
      row.push(field);field='';if(character!==','){if(row.some(Boolean))rows.push(row);row=[];if(character==='\r'&&source[i+1]==='\n')i++;}
    }else field+=character;
  }
  if(quoted)throw new Error('The CSV has an unclosed quoted field.');row.push(field);if(row.some(Boolean))rows.push(row);
  const headers=rows.shift(),names=['Material','Colour','In Storage','Brand','Weight (g)','Diameter (mm)','Barcode','SKU','Filament Code','Variant','Location'];
  if(!headers||names.some((name,index)=>headers[index]!==name)||headers.length!==names.length)throw new Error('Use an inventory CSV exported from FilamentTrack.');
  if(!rows.length||rows.length>500)throw new Error('The export must contain 1 to 500 filament varieties.');
  return rows.map(values=>{
    if(values.length!==names.length)throw new Error('The inventory CSV has a row with missing or extra columns.');
    const text=values.map(value=>/^'[\s]*[=+@-]/.test(value)?value.slice(1):value);
    const product={material:text[0],colour:text[1],storage:Number(text[2]),brand:text[3],weight:Number(text[4]),diameter:Number(text[5]),barcode:text[6],sku:text[7],filamentCode:text[8],variant:text[9]||'Unspecified',location:text[10]};
    if(text[2].trim()===''||!Number.isInteger(product.storage)||product.storage<0||product.storage>100000)throw new Error('An opening stock count is invalid.');
    return product;
  });
}
