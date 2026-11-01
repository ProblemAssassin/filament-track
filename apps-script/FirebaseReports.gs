/* Optional personal Sheet report. Firestore remains authoritative.
 * Private Script Properties: TRACKER_OWNER, TRACKER_SHEET_ID, FIREBASE_OWNER_UID.
 * Add https://www.googleapis.com/auth/datastore to the project's OAuth scopes,
 * alongside its existing Sheets, userinfo.email, external_request and scriptapp scopes.
 * Run setupFirebaseReports once as the owner after authorising the added scope.
 */
function setupFirebaseReports() {
  requireOwner_();
  var result=syncFirebaseReport();
  if(!ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='syncFirebaseReport';}))
    ScriptApp.newTrigger('syncFirebaseReport').timeBased().everyMinutes(5).create();
  console.log('Private Firebase inventory report configured; scheduled about every five minutes.');
  return result;
}

function syncFirebaseReport() {
  var props=PropertiesService.getScriptProperties();
  var effective=Session.getEffectiveUser().getEmail().toLowerCase();
  if(!effective||effective!==props.getProperty('TRACKER_OWNER'))throw new Error('Run the report as the inventory owner.');
  var uid=props.getProperty('FIREBASE_OWNER_UID');
  var project=props.getProperty('FIREBASE_PROJECT_ID')||'filamenttrack';
  if(!uid||!(/^[A-Za-z0-9_-]{1,128}$/).test(uid)||!(/^[a-z][a-z0-9-]{4,29}$/).test(project))throw new Error('Set valid private Firebase project and owner UID properties first.');
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(1000))return {ok:false,skipped:true};
  try {
    var products=[],token='',pages=0;
    var base='https://firestore.googleapis.com/v1/projects/'+project+'/databases/(default)/documents/users/'+encodeURIComponent(uid)+'/products?pageSize=500';
    do {
      if(++pages>20)throw new Error('Inventory report exceeds its supported size. Existing report was preserved.');
      var response=UrlFetchApp.fetch(base+(token?'&pageToken='+encodeURIComponent(token):''),{headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true});
      if(response.getResponseCode()!==200)throw new Error('Firestore report read failed (HTTP '+response.getResponseCode()+'). Existing report was preserved.');
      var page=JSON.parse(response.getContentText());
      if(page.documents!==undefined&&!Array.isArray(page.documents))throw new Error('Invalid inventory report response.');
      (page.documents||[]).forEach(function(doc){
        var p={};Object.keys(doc.fields||{}).forEach(function(key){p[key]=firebaseReportValue_(doc.fields[key]);});
        if(!p.material||!p.colour||!p.brand||!Number.isInteger(p.storage)||p.storage<0||!Number.isFinite(p.weight)||p.weight<=0||!Number.isFinite(p.diameter)||p.diameter<=0)throw new Error('Invalid inventory record. Existing report was preserved.');
        products.push(p);
      });
      token=page.nextPageToken||'';
    }while(token);
    products.sort(function(a,b){return (a.material+'|'+a.colour+'|'+a.brand).localeCompare(b.material+'|'+b.colour+'|'+b.brand);});
    var headers=['Material','Colour','In Storage','Brand','Weight (g)','Diameter (mm)','Barcode','SKU','Filament Code','Variant','Location','Updated at'];
    var rows=products.map(function(p){return [p.material,p.colour,p.storage,p.brand,p.weight,p.diameter,p.barcode||'',p.sku||'',p.filamentCode||'',p.variant||'',p.location||'',p.updatedAt||''].map(function(v){return typeof v==='string'?safeCell_(v):v;});});
    var ss=spreadsheet_(),sheet=ss.getSheetByName('Firebase Inventory'),created=!sheet;
    if(created)sheet=ss.insertSheet('Firebase Inventory');
    var prior=sheet.getLastRow();ensureRows_(sheet,rows.length+1);
    // All pages and records are checked before replacing any report values.
    sheet.getRange(1,1,rows.length+1,headers.length).setValues([headers].concat(rows));
    if(prior>rows.length+1)sheet.getRange(rows.length+2,1,prior-rows.length-1,headers.length).clearContent();
    if(created){sheet.setFrozenRows(1);sheet.getRange(1,1,1,headers.length).setBackground('#143a3a').setFontColor('#ffffff').setFontWeight('bold');sheet.setColumnWidths(1,headers.length,145);}
    var info=ss.getSheetByName('Firebase Sync')||ss.insertSheet('Firebase Sync');
    var updated=new Date().toISOString();
    info.getRange(1,1,5,2).setValues([['Source','Firebase / Cloud Firestore'],['Last successful report',updated],['Schedule','About every 5 minutes; app saves do not wait for this report'],['Filament varieties',products.length],['Rolls in storage',products.reduce(function(total,p){return total+p.storage;},0)]]);
    SpreadsheetApp.flush();props.setProperty('FIREBASE_REPORT_LAST_SUCCESS',updated);
    return {ok:true,products:products.length,rolls:products.reduce(function(total,p){return total+p.storage;},0),updatedAt:updated,sheetUrl:ss.getUrl()+'#gid='+sheet.getSheetId()};
  }finally{lock.releaseLock();}
}

function firebaseReportValue_(value) {
  if(Object.prototype.hasOwnProperty.call(value,'stringValue'))return value.stringValue;
  if(Object.prototype.hasOwnProperty.call(value,'integerValue'))return Number(value.integerValue);
  if(Object.prototype.hasOwnProperty.call(value,'doubleValue'))return Number(value.doubleValue);
  if(Object.prototype.hasOwnProperty.call(value,'timestampValue'))return value.timestampValue;
  if(Object.prototype.hasOwnProperty.call(value,'booleanValue'))return value.booleanValue;
  if(Object.prototype.hasOwnProperty.call(value,'nullValue'))return null;
  throw new Error('Unsupported Firestore report value.');
}
