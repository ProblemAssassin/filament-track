export const clean = value => String(value ?? '').trim().replace(/\s+/g, ' ');
export const normal = value => clean(value).toUpperCase();
export const keyFor = p => [p.brand,p.material,p.colour,p.weight,p.diameter,p.variant].map(normal).join('|');
export function validEan13(value){if(!/^\d{13}$/.test(value))return false;let sum=0;for(let i=0;i<12;i++)sum+=Number(value[i])*(i%2?3:1);return (10-sum%10)%10===Number(value[12]);}
export function findByCode(products, code) {
  const n = normal(code);
  if (!n) return null;
  return products.find(p => [p.barcode,p.sku,p.id].some(v => normal(v) === n)) || null;
}
export function parseLabel(text) {
  const raw = clean(text);
  const upper = raw.toUpperCase();
  const material = upper.match(/\b(PLA[\s-]*CF|PETG[\s-]*CF|PA[\s-]*(?:6[\s-]*)?CF|PLA|PETG|ABS|ASA|TPU|PVA|HIPS|PC|NYLON)\b/);
  let type = material ? material[1].replace(/\s*-\s*|\s+/g,'-') : '';
  if (type === 'PLA') {
    const finish = upper.match(/\b(?:PLA\s+)?(BASIC|MATTE|SILK|TOUGH|GLOW|WOOD|MARBLE|METAL|LITE)\b/);
    if (finish) type += ' ' + finish[1][0] + finish[1].slice(1).toLowerCase();
  }
  const colours = ['Charcoal Black','Jade White','Sky Blue','Royal Blue','Forest Green','Light Grey','Dark Grey','Light Gray','Dark Gray','Matte Black','Red','Black','White','Grey','Gray','Blue','Green','Yellow','Orange','Purple','Pink','Brown','Beige','Silver','Gold','Cyan','Magenta','Transparent','Natural'];
  const colour = colours.find(c => new RegExp('\\b'+c.replace(/ /g,'\\s+')+'\\b','i').test(raw)) || '';
  const brands = [['Bambu Lab',/BAMBU(?:\s*LAB)?/i],['Polymaker',/POLYMAKER/i],['eSUN',/\bESUN\b/i],['SUNLU',/\bSUNLU\b/i],['Prusament',/PRUSAMENT/i],['Creality',/CREALITY/i],['Overture',/OVERTURE/i]];
  const brand = brands.find(([,r])=>r.test(raw))?.[0] || '';
  const weight = raw.match(/\b(\d+(?:\.\d+)?)\s*(kg|g)\b/i);
  const diameter = raw.match(/\b(1[.,]75|2[.,]85|3[.,]00)\s*(?:mm)?\b/i);
  const filamentCode = raw.match(/(?:filament\s*code|colour\s*code|color\s*code)[^\d]{0,12}(\d{4,8})/i)?.[1] || '';
  const sku = raw.match(/\bSKU\s*[:：]?\s*([A-Z0-9][A-Z0-9._-]{3,100})/i)?.[1] || '';
  const barcode=(raw.match(/\b\d{13}\b/g)||[]).find(validEan13)||'';
  return {material:type,colour,brand,weight:weight ? Number(weight[1])*(weight[2].toLowerCase()==='kg'?1000:1):'',diameter:diameter?diameter[1].replace(',','.'): '',filamentCode,sku,barcode,variant:/SPLFREE|REFILL|SPOOL[ -]?FREE/i.test(raw)?'Refill':'',location:'',raw};
}
export function labelMatches(products, draft) {
  if (draft.barcode || draft.sku) {
    const exact = findByCode(products,draft.barcode) || findByCode(products,draft.sku);
    if (exact) return [exact];
  }
  if (draft.filamentCode && draft.brand) {
    const byCode=products.filter(p=>normal(p.brand)===normal(draft.brand)&&normal(p.filamentCode)===normal(draft.filamentCode)&&(!draft.variant||normal(p.variant)===normal(draft.variant)));
    if (byCode.length) return byCode;
  }
  if (!draft.material || !draft.colour) return [];
  return products.filter(p => normal(p.material)===normal(draft.material)&&normal(p.colour)===normal(draft.colour)&&(!draft.brand||normal(p.brand)===normal(draft.brand))&&(!draft.weight||Number(p.weight)===Number(draft.weight))&&(!draft.diameter||Number(p.diameter)===Number(draft.diameter))&&(!draft.variant||normal(p.variant)===normal(draft.variant)));
}
export function validateDraft(product, mode) {
  if (!['ADD','USE'].includes(mode)) return 'Choose Add or Use first.';
  if (mode==='USE'&&!product.id) return 'Choose an existing filament to use.';
  if (!clean(product.material)||!clean(product.colour)||!clean(product.brand)) return 'Check the material, colour and brand.';
  if (!(Number(product.weight)>0&&Number(product.weight)<=25000)) return 'Enter a spool weight between 1 and 25,000 g.';
  if (!(Number(product.diameter)>0&&Number(product.diameter)<=10)) return 'Check the filament diameter in mm.';
  if (mode==='USE'&&Number(product.storage)<1) return 'This filament is out of stock.';
  return '';
}
export function csvCell(value) {
  let s=String(value??'');
  if (/^[\s]*[=+@-]/.test(s)) s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
}
