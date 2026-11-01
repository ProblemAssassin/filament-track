import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../apps-script/FirebaseReports.gs',import.meta.url),'utf8');
const record=(colour='Red',storage=2)=>({fields:{material:{stringValue:'PLA'},colour:{stringValue:colour},brand:{stringValue:'Bambu Lab'},storage:{integerValue:String(storage)},weight:{integerValue:'1000'},diameter:{doubleValue:1.75},sku:{stringValue:'=SKU-1'}}});
function environment(pages){
 const props=new Map([['TRACKER_OWNER','owner@example.com'],['FIREBASE_OWNER_UID','private-owner'],['TRACKER_SHEET_ID','private-sheet']]);
 const sheets=new Map([['Original Inventory',{untouched:true}]]),requests=[];let owner='owner@example.com',released=0;
 class Sheet{constructor(){this.rows=[];}getLastRow(){return this.rows.length;}getSheetId(){return 123;}setFrozenRows(){}setColumnWidths(){}getRange(r,c,n,m){const chain={setValues:rows=>{for(let i=0;i<rows.length;i++)this.rows[r-1+i]=structuredClone(rows[i]);return chain;},clearContent:()=>{this.rows.splice(r-1,n);return chain;},setBackground:()=>chain,setFontColor:()=>chain,setFontWeight:()=>chain};return chain;}}
 const ss={getSheetByName:n=>sheets.get(n),insertSheet:n=>{const sheet=new Sheet();sheets.set(n,sheet);return sheet;},getUrl:()=> 'https://docs.google.com/spreadsheets/d/private-sheet/edit'};
 const context={console:{log(){}},Date,PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v)})},Session:{getEffectiveUser:()=>({getEmail:()=>owner})},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>released++})},UrlFetchApp:{fetch:(url,options)=>{requests.push({url,options});const page=pages.shift();return{getResponseCode:()=>page.status||200,getContentText:()=>JSON.stringify(page.body||page)};}},ScriptApp:{getOAuthToken:()=> 'private-token'},spreadsheet_:()=>ss,ensureRows_(){},safeCell_:s=>/^[\s]*[=+@-]/.test(s)?"'"+s:s,SpreadsheetApp:{flush(){}}};
 vm.createContext(context);vm.runInContext(source,context);return {context,sheets,requests,props,setOwner:v=>owner=v,released:()=>released};
}
test('the Sheet report reads every page and preserves counts, aliases as text and original tabs',()=>{
 const e=environment([{documents:[record()],nextPageToken:'next page'},{documents:[record('Blue',3)]}]);const result=e.context.syncFirebaseReport();
 assert.equal(result.rolls,5);assert.equal(result.products,2);assert.equal(e.requests.length,2);assert.ok(e.requests[1].url.includes('pageToken=next%20page'));assert.equal(e.requests[0].options.headers.Authorization,'Bearer private-token');
 assert.equal(e.sheets.get('Firebase Inventory').rows[1][7],"'=SKU-1");assert.equal(e.sheets.get('Original Inventory').untouched,true);assert.equal(e.released(),1);
});
test('a failed later page leaves the previous Sheet report intact',()=>{
 const e=environment([{documents:[record()],nextPageToken:'next'},{status:503}]);const previous={rows:[['Keep previous report']]};e.sheets.set('Firebase Inventory',previous);
 assert.throws(()=>e.context.syncFirebaseReport(),/HTTP 503/);assert.deepEqual(previous.rows,[['Keep previous report']]);assert.equal(e.props.get('FIREBASE_REPORT_LAST_SUCCESS'),undefined);assert.equal(e.released(),1);
});
test('invalid source data cannot replace the prior report or silently produce zero stock',()=>{
 const e=environment([{documents:[record('Red',-1)]}]);assert.throws(()=>e.context.syncFirebaseReport(),/Invalid inventory/);assert.equal(e.sheets.has('Firebase Inventory'),false);assert.equal(e.released(),1);
});
test('another Google account cannot run the private inventory report',()=>{
 const e=environment([]);e.setOwner('another@example.com');assert.throws(()=>e.context.syncFirebaseReport(),/inventory owner/);assert.equal(e.requests.length,0);
});
