/* FilamentTrack. Deploy as USER_ACCESSING, access MYSELF. No public write endpoint. */
var TRACKER = {
  appOrigin: 'https://problemassassin.github.io',
  appUrl: 'https://problemassassin.github.io/filament-track/',
  journal: 'Tracker Journal', inventory: 'Tracker Inventory',
  headers: ['Request ID','Timestamp','Action','Product ID','Material','Colour','Brand','Weight (g)','Diameter (mm)','Barcode','SKU','Filament Code','Location','Notes','Source','Delta','Balance','Variant','Request hash']
};

function doGet() {
  var template = HtmlService.createTemplateFromFile('Index');
  template.appOrigin = TRACKER.appOrigin;
  template.appUrl = TRACKER.appUrl;
  template.connectionUrl = ScriptApp.getService().getUrl();
  return template.evaluate().setTitle('FilamentTrack · Google connection')
    .addMetaTag('viewport','width=device-width, initial-scale=1');
}

function requireOwner_() {
  var email = Session.getActiveUser().getEmail().toLowerCase();
  var owner = PropertiesService.getScriptProperties().getProperty('TRACKER_OWNER');
  if (!owner || email !== owner) throw new Error('Sign in with the Google account that owns this inventory.');
}

function setupTracker() {
  var properties=PropertiesService.getScriptProperties();
  if(!properties.getProperty('TRACKER_OWNER')){
    var active=Session.getActiveUser().getEmail().toLowerCase();
    if(!active||active!==Session.getEffectiveUser().getEmail().toLowerCase())throw new Error('Run setup as the project owner.');
    properties.setProperty('TRACKER_OWNER',active);
  }
  requireOwner_();
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var ss = spreadsheet_();
    var journal = ss.getSheetByName(TRACKER.journal);
    if (!journal) {
      journal=ss.insertSheet(TRACKER.journal);
      journal.getRange(1,1,1,TRACKER.headers.length).setValues([TRACKER.headers]);
      journal.setFrozenRows(1);
      journal.getRange('A:A').setNumberFormat('@');
      journal.getRange('D:D').setNumberFormat('@');
      journal.getRange('J:L').setNumberFormat('@');
      journal.getRange(1,1,1,TRACKER.headers.length).setBackground('#143a3a').setFontColor('#ffffff').setFontWeight('bold');
    }
    // Mark initialization with an immutable event, even for an empty source sheet.
    var rows=journal.getDataRange().getValues();
    if (!rows.slice(1).some(function(r){return r[0]==='tracker-initialized';})) {
      var source=ss.getSheetByName('Filament Inventory');
      var original=source?source.getDataRange().getValues().slice(1):[];
      original.forEach(function(r,index){
        if (!String(r[1]||'').trim()||!String(r[2]||'').trim()) return;
        var requestId='opening-row-'+(index+2);
        if (rows.slice(1).some(function(row){return row[0]===requestId;})) return;
        var count=Number(r[5]);
        if (!Number.isInteger(count)||count<0) throw new Error('Invalid opening stock on original row '+(index+2));
        var p={id:Utilities.getUuid(),material:String(r[1]),colour:String(r[2]),brand:String(r[3]||'Unspecified'),weight:Number(r[4])||1000,diameter:1.75,barcode:'',sku:String(r[0]||''),filamentCode:'',location:String(r[6]||''),variant:'Unspecified'};
        appendEvent_(journal,requestId,'OPENING',p,count,count,'Migration',String(r[8]||'Imported opening stock'),'opening');
      });
      appendEvent_(journal,'tracker-initialized','INIT',{id:'',material:'',colour:'',brand:'',weight:0,diameter:0,barcode:'',sku:'',filamentCode:'',location:'',variant:''},0,0,'System','Original inventory and logs preserved','init');
    }
    var state=state_(journal); mirror_(ss,state.products);
    ss.setActiveSheet(ss.getSheetByName(TRACKER.inventory));
    console.log('Tracker ready. '+state.products.length+' product(s) imported. Original tabs preserved.');
    return {ok:true,productCount:state.products.length};
  } finally {lock.releaseLock();}
}

function trackerApi(request) {
  requireOwner_();
  if (!request||typeof request!=='object') throw new Error('Invalid request.');
  var ss=spreadsheet_();
  var journal=ss.getSheetByName(TRACKER.journal);
  if(!journal) throw new Error('Run setupTracker in Apps Script before connecting.');
  var lock=LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var state=state_(journal);
    if(request.method==='list') return response_(ss,state);
    if(request.method==='receipt') {
      var event=state.events.filter(function(e){return e.requestId===request.requestId;})[0];
      return {ok:true,found:!!event,event:event||null,state:response_(ss,state)};
    }
    if(request.method!=='mutate') throw new Error('Unsupported operation.');
    var requestId=String(request.requestId||'');
    if(!/^[a-zA-Z0-9-]{20,100}$/.test(requestId)) throw new Error('Invalid request ID.');
    if(['ADD','USE'].indexOf(request.mode)<0) throw new Error('Invalid action.');
    var hash=requestHash_(request);
    var previous=state.events.filter(function(e){return e.requestId===requestId;})[0];
    if(previous){
      if(previous.hash!==hash) throw new Error('This request ID was already used for a different action.');
      return {ok:true,replayed:true,event:previous,state:response_(ss,state)};
    }
    var proposed=validatedProduct_(request.product);
    var existing=proposed.id?state.products.filter(function(p){return p.id===proposed.id;})[0]:null;
    if(proposed.id&&!existing) throw new Error('This product no longer exists. Refresh and select it again.');
    var proposedKey=productKey_(proposed);
    if(!existing) existing=state.products.filter(function(p){return productKey_(p)===proposedKey;})[0];
    if(request.mode==='USE'&&!existing) throw new Error('Select an existing filament to use.');
    var p=existing?JSON.parse(JSON.stringify(existing)):proposed;
    if(!p.id)p.id=Utilities.getUuid();
    // Existing material fields cannot silently change during a stock operation.
    if(existing&&productKey_(existing)!==proposedKey) throw new Error('Existing product details changed. Reselect the product or add a separate product.');
    ['barcode','sku','filamentCode'].forEach(function(field){
      var value=proposed[field];
      if(!value)return;
      if(p[field]&&norm_(p[field])!==norm_(value))throw new Error('This product already has a different '+field+'. Check the selected product.');
      if(field!=='filamentCode'&&state.products.some(function(other){return other.id!==p.id&&[other.barcode,other.sku].some(function(v){return norm_(v)===norm_(value);});})) throw new Error('That barcode or SKU is already linked to another filament.');
      p[field]=value;
    });
    var before=existing?existing.storage:0;
    var delta=request.mode==='ADD'?1:-1;
    if(before+delta<0)throw new Error('Out of stock. Nothing was deducted.');
    var source=['Barcode','Label','Manual'].indexOf(request.source)>=0?request.source:'Manual';
    var row=appendEvent_(journal,requestId,request.mode,p,delta,before+delta,source,'',hash);
    SpreadsheetApp.flush(); // The append-only journal is the authoritative commit.
    // Earlier rows were reconciled under this same lock. Apply the confirmed append
    // in memory instead of fetching and reconciling the whole journal a second time.
    p.storage=before+delta;p.updatedAt=row[1];
    var index=state.products.findIndex(function(product){return product.id===p.id;});
    if(index<0)state.products.push(p);else state.products[index]=p;
    var event=event_(row,p);state.events.push(event);
    var warning='';
    try {mirror_(ss,state.products,true,index<0);} catch(err){warning='Saved in the journal. The Sheet inventory view could not be updated.';}
    return {ok:true,event:event,state:response_(ss,state),warning:warning};
  } finally {lock.releaseLock();}
}

function norm_(v){return String(v==null?'':v).trim().replace(/\s+/g,' ').toUpperCase();}
function spreadsheet_(){var id=PropertiesService.getScriptProperties().getProperty('TRACKER_SHEET_ID');if(!id)throw new Error('Set TRACKER_SHEET_ID in Apps Script project properties before setup.');return SpreadsheetApp.openById(id);}
function productKey_(p){return [p.brand,p.material,p.colour,p.weight,p.diameter,p.variant].map(norm_).join('|');}
function text_(value,max){
  var s=String(value==null?'':value).trim().replace(/\s+/g,' ');
  if(s.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s))throw new Error('A product field is too long or contains invalid characters.');
  return s;
}
function validatedProduct_(input){
  if(!input||typeof input!=='object')throw new Error('Missing filament details.');
  var p={};
  ['id','material','colour','brand','barcode','sku','filamentCode','location','variant'].forEach(function(k){p[k]=text_(input[k],k==='location'?160:120);});
  if(!p.material||!p.colour||!p.brand)throw new Error('Material, colour and brand are required.');
  p.weight=Number(input.weight);p.diameter=Number(input.diameter);
  if(!Number.isFinite(p.weight)||p.weight<=0||p.weight>25000)throw new Error('Invalid weight.');
  if(!Number.isFinite(p.diameter)||p.diameter<=0||p.diameter>10)throw new Error('Invalid diameter.');
  return p;
}
function requestHash_(r){
  var p=validatedProduct_(r.product);
  var bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify({mode:r.mode,product:p,source:r.source||'Manual'}));
  return bytes.map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
}
function safeCell_(value){var s=String(value==null?'':value);return /^[\s]*[=+@-]/.test(s)?"'"+s:s;}
function appendEvent_(sheet,id,action,p,delta,balance,source,notes,hash){
  var row=[id,new Date().toISOString(),action,p.id,p.material,p.colour,p.brand,p.weight,p.diameter,p.barcode,p.sku,p.filamentCode,p.location,notes,source,delta,balance,p.variant,hash];
  var next=sheet.getLastRow()+1;ensureRows_(sheet,next);
  sheet.getRange(next,1,1,row.length).setValues([row.map(function(v){return typeof v==='string'?safeCell_(v):v;})]);
  return row;
}
function event_(r,p){return {requestId:String(r[0]),timestamp:String(r[1]),mode:String(r[2]),productId:p.id,material:p.material,colour:p.colour,brand:p.brand,delta:Number(r[15]),balance:p.storage,source:String(r[14]),hash:String(r[18])};}
function ensureRows_(sheet,needed){var capacity=sheet.getMaxRows();if(needed>capacity)sheet.insertRowsAfter(capacity,Math.max(100,needed-capacity));}
function state_(journal){
  var rows=journal.getDataRange().getValues().slice(1),products={},events=[],seen={};
  rows.forEach(function(r){
    if(!r[0]||r[2]==='INIT')return;
    if(seen[r[0]])throw new Error('Duplicate journal request ID. Review the journal before continuing.');seen[r[0]]=true;
    var id=String(r[3]),delta=Number(r[15]),previous=products[id],before=previous?previous.storage:0;
    if(!Number.isInteger(delta)||before+delta<0)throw new Error('Invalid journal balance. Review the journal before continuing.');
    if(Number(r[16])!==before+delta)throw new Error('Journal balance mismatch. Review the journal before continuing.');
    var p={id:id,material:String(r[4]),colour:String(r[5]),brand:String(r[6]),weight:Number(r[7]),diameter:Number(r[8]),barcode:String(r[9]),sku:String(r[10]),filamentCode:String(r[11]),location:String(r[12]),storage:before+delta,variant:String(r[17]||''),updatedAt:String(r[1])};
    products[id]=p;
    events.push(event_(r,p));
  });
  return {products:Object.keys(products).map(function(id){return products[id];}),events:events};
}
function response_(ss,state){
  var mirror=ss.getSheetByName(TRACKER.inventory);
  return {ok:true,products:state.products,events:state.events.slice(-100).reverse().map(function(e){var copy=Object.assign({},e);delete copy.hash;return copy;}),updatedAt:new Date().toISOString(),sheetUrl:ss.getUrl()+(mirror?'#gid='+mirror.getSheetId():'')};
}
function mirror_(ss,products,fast,growing){
  var sheet=ss.getSheetByName(TRACKER.inventory),configure=!sheet||!fast;
  if(!sheet)sheet=ss.insertSheet(TRACKER.inventory);
  var headers=['Material','Colour','In Storage','Brand','Weight (g)','Diameter (mm)','Barcode','SKU','Filament Code','Variant','Location','Updated','Product ID'];
  if(configure){
    sheet.getRange(1,1,1,headers.length).setValues([headers]);sheet.setFrozenRows(1);
    sheet.getRange(1,1,1,headers.length).setBackground('#143a3a').setFontColor('#ffffff').setFontWeight('bold');
    sheet.getRange('G:I').setNumberFormat('@');sheet.getRange('M:M').setNumberFormat('@');
  }
  if(products.length){
    if(configure||growing)ensureRows_(sheet,products.length+1);
    var rows=products.map(function(p){return[p.material,p.colour,p.storage,p.brand,p.weight,p.diameter,p.barcode,p.sku,p.filamentCode,p.variant,p.location,p.updatedAt,p.id].map(function(v){return typeof v==='string'?safeCell_(v):v;});});
    sheet.getRange(2,1,rows.length,headers.length).setValues(rows);
  }
  if(configure){sheet.setColumnWidths(1,2,150);sheet.setColumnWidth(3,100);sheet.setColumnWidth(4,140);sheet.setColumnWidths(7,3,190);}
  if(configure||growing){
    var filter=sheet.getFilter(),needed=Math.max(2,products.length+1);
    if(filter&&filter.getRange().getNumRows()<needed){filter.remove();filter=null;}
    if(!filter)sheet.getRange(1,1,needed,headers.length).createFilter();
  }
}
