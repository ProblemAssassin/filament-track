import {GoogleBridge} from './bridge.js';
import {LabelScanner} from './scanner.js';
import {clean,normal,findByCode,labelMatches,mergeScanDetails,parseLabel,validateDraft,csvCell} from './core.js';
import {getScriptUrl,saveScriptUrl,googleAccountChooserUrl} from './config.js';
const $=id=>document.getElementById(id);
const state={products:[],events:[],connected:false,loaded:false,mode:'ADD',draft:null,source:'Manual',saving:false,session:0,selectedId:'',raw:'',lastBarcode:'',saveResolved:false,scanDetails:{},readingLabel:false};
const pendingKey='filament-track-pending-v1';let pending=null;let toastTimer;
try{pending=JSON.parse(localStorage.getItem(pendingKey)||'null');}catch{}
const fields=['material','colour','brand','weight','diameter','variant','barcode','sku','filamentCode','location'];
const colours={red:'#e95758',black:'#24292e',white:'#e7e8e3',grey:'#91989d',gray:'#91989d',blue:'#4d8ed4',green:'#53ae84',yellow:'#e3c94f',orange:'#e6a05d',purple:'#a189d5',pink:'#d98fb5',brown:'#9a7054',silver:'#a5b6c1',gold:'#c4a15d'};
const scanner=new LabelScanner($('camera-video'),received,setProgress,cameraState);
const bridge=new GoogleBridge(connectionStatus);
function node(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
function setProgress(text){$('scan-progress').textContent=text;}
function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
function formatTime(time){return new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(time));}
function connectionStatus(status,detail){
  const wasConnected=state.connected;state.connected=status==='connected';
  $('connection-label').textContent=status==='connected'?'Google Sheet connected':status==='connecting'?'Connecting…':'Connection needed';
  $('connection-dot').className='status-dot '+(state.connected?'connected':status==='error'?'error':'');
  $('connection-detail').textContent=detail;
  if(state.connected&&getScriptUrl())$('connection-url').value=getScriptUrl();
  if(status==='error'&&!state.loaded)$('inventory-summary').textContent='Connect Google Sheets to load your inventory.';
  $('connection-notice').hidden=status!=='error';$('connection-notice').replaceChildren(node('span',detail));
  if(status==='error'){const button=node('button','Connect Google','button secondary compact');button.addEventListener('click',()=>$('connection-dialog').showModal());$('connection-notice').append(button);}
  if(state.connected&&!wasConnected)refresh();updateSaveButtons();
}
function applyState(result){
  if(!result?.ok||!Array.isArray(result.products))throw new Error('The Sheet returned an invalid inventory response.');
  state.products=result.products;state.events=result.events||[];state.loaded=true;
  if(result.sheetUrl&&result.sheetUrl.startsWith('https://docs.google.com/spreadsheets/')){$('sheet-link').href=result.sheetUrl;$('sheet-link').hidden=false;}
  $('last-saved').textContent='Checked '+formatTime(result.updatedAt);render();
}
async function refresh(){
  $('refresh-button').disabled=true;
  try{applyState(await bridge.call({method:'list'}));$('connection-notice').hidden=true;if(pending)showPending();}
  catch(e){$('inventory-summary').textContent=state.loaded?'Showing previously loaded stock. Refresh failed.':'Inventory has not loaded.';toast(e.message);}
  finally{$('refresh-button').disabled=false;}
}
function render(){
  const total=state.products.reduce((n,p)=>n+Number(p.storage),0);$('total-rolls').textContent=total;$('total-products').textContent=state.products.length;$('low-stock').textContent=state.products.filter(p=>p.storage===1).length;
  $('total-weight').textContent=(state.products.reduce((n,p)=>n+p.storage*p.weight,0)/1000).toLocaleString(undefined,{maximumFractionDigits:1})+' kg';
  $('inventory-summary').textContent=total+' roll'+(total===1?'':'s')+' across '+state.products.length+' filament variet'+(state.products.length===1?'y':'ies');
  const selected=$('material-filter').value;const options=[node('option','All materials')];options[0].value='';[...new Set(state.products.map(p=>p.material))].sort().forEach(m=>{const o=node('option',m);o.value=m;options.push(o);});$('material-filter').replaceChildren(...options);$('material-filter').value=selected;renderTable();renderHistory();
}
function renderTable(){
  const query=$('search').value.toLowerCase().trim(),material=$('material-filter').value,stock=$('stock-filter').value;
  const products=state.products.filter(p=>(!material||p.material===material)&&(!stock||(stock==='low'?p.storage===1:p.storage===0))&&(!query||[p.material,p.colour,p.brand,p.barcode,p.sku,p.filamentCode,p.location].join(' ').toLowerCase().includes(query))).sort((a,b)=>a.material.localeCompare(b.material)||a.colour.localeCompare(b.colour));
  $('inventory-body').replaceChildren(...products.map(p=>{
    const row=node('tr'),materialCell=node('td');materialCell.append(node('strong',p.material),node('span',p.weight+' g · '+p.diameter+' mm','sub'));row.append(materialCell);
    const colourCell=node('td'),name=node('span',p.colour,'colour-name'),dot=node('span',undefined,'colour-dot');dot.style.background=colours[p.colour.toLowerCase()]||'#7f8fa6';dot.setAttribute('aria-hidden','true');name.prepend(dot);colourCell.append(name);row.append(colourCell);
    const count=node('td',undefined,'count-col'),badge=node('span',String(p.storage),'stock-badge'+(p.storage===0?' out':p.storage===1?' low':''));badge.title=p.storage===0?'Out of stock':p.storage===1?'Low stock':'';count.append(badge);row.append(count);
    const brand=node('td');brand.append(node('span',p.brand),node('span',p.variant&&p.variant!=='Unspecified'?p.variant:(p.sku||p.barcode||'No code linked'),'sub'));row.append(brand,node('td',p.location||'—'));
    const actions=node('td');for(const mode of ['ADD','USE']){const b=node('button',mode==='ADD'?'+':'−','row-action'+(mode==='USE'?' use-row':''));b.setAttribute('aria-label',(mode==='ADD'?'Add':'Use')+' one '+p.material+' '+p.colour+' roll');b.disabled=mode==='USE'&&p.storage===0;b.addEventListener('click',()=>openSession(mode,p));actions.append(b);}row.append(actions);return row;
  }));
  $('empty-state').hidden=products.length>0;$('empty-title').textContent=state.products.length?'No matching filament.':'Your shelf starts here.';$('empty-description').textContent=state.products.length?'Try another search or change the filters.':'Tap Add Filament to scan or enter your first roll.';
  $('results-count').textContent=products.length+' of '+state.products.length+' varieties';
}
function renderHistory(){
  if(!state.events.length){$('history-list').replaceChildren(node('p','No transactions yet. Your first confirmed roll will appear here.','muted'));return;}
  $('history-list').replaceChildren(...state.events.map(e=>{
    const row=node('div',undefined,'history-row'),symbol=node('span',e.delta>=0?'+':'−','history-symbol'+(e.delta<0?' deduct':'')),body=node('div');body.append(node('h3',e.material+' · '+e.colour),node('p',(e.mode==='OPENING'?'Opening stock':e.mode==='ADD'?'Added 1 roll':'Used 1 roll')+' · '+e.source+' · Balance '+e.balance));row.append(symbol,body,node('span',formatTime(e.timestamp),'history-time'));return row;
  }));
}
function populateExisting(){
  const o=node('option',state.mode==='USE'?'Choose existing filament…':'New filament');o.value='';
  const products=state.products.filter(p=>state.mode==='ADD'||p.storage>0).sort((a,b)=>(a.material+a.colour).localeCompare(b.material+b.colour));
  $('existing-product').replaceChildren(o,...products.map(p=>{const option=node('option',p.brand+' · '+p.material+' · '+p.colour+' ('+p.storage+' in storage)');option.value=p.id;return option;}));
}
function blankDraft(){return {material:'',colour:'',brand:'',weight:1000,diameter:1.75,variant:'Unspecified',barcode:'',sku:'',filamentCode:'',location:''};}
function fillFields(p){for(const f of fields)$('field-'+f).value=p[f]??'';if(!$('field-variant').value)$('field-variant').value='Unspecified';}
function readFields(){const draft={id:state.selectedId};for(const f of fields)draft[f]=clean($('field-'+f).value);draft.weight=Number(draft.weight);draft.diameter=Number(draft.diameter);const existing=state.products.find(p=>p.id===state.selectedId);if(existing)draft.storage=existing.storage;return draft;}
function lockIdentity(locked){for(const f of ['material','colour','brand','weight','diameter'])$('field-'+f).readOnly=locked;$('field-variant').disabled=locked;}
async function openSession(mode,product){
  if(pending){showPending();toast('Check the previous save before scanning another roll.');return;}
  if(!state.loaded||!state.connected){$('connection-dialog').showModal();return;}
  if(mode==='USE'&&!state.products.some(p=>p.storage>0)){toast('There are no rolls in storage to use. Add a roll first.');return;}
  state.mode=mode;state.session=0;state.saving=false;state.lastBarcode='';$('scan-dialog').classList.toggle('mode-use',mode==='USE');$('scan-mode').textContent=mode==='ADD'?'ADDING TO STORAGE':'USING FROM STORAGE';$('scan-title').textContent=mode==='ADD'?'Add one roll':'Use one roll';$('session-count').textContent='0 '+(mode==='ADD'?'added':'used');$('ok-button').textContent='OK · '+(mode==='ADD'?'add':'use')+' 1 & finish';
  populateExisting();resetDraft();$('scan-dialog').showModal();
  if(product){chooseProduct(product);setManual(true);$('product-form').hidden=true;}else{setManual(false);await startCamera();}
}
function resetDraft(){
  state.draft=null;state.selectedId='';state.source='Manual';state.raw='';state.lastBarcode='';state.saving=false;state.saveResolved=false;
  state.scanDetails={};state.readingLabel=false;scanner.labelOnly=false;$('label-link-prompt').hidden=true;$('capture-button').textContent='Read label';
  fillFields(blankDraft());lockIdentity(false);$('existing-product').value='';$('product-form').hidden=true;$('detected-product').hidden=true;$('detection-placeholder').hidden=false;$('edit-button').hidden=true;$('detection-status').textContent='READY TO SCAN';$('detection-status').className='badge';$('draft-alert').hidden=true;$('save-error').hidden=true;$('ocr-details').hidden=true;$('capture-preview').hidden=true;$('camera-guide').hidden=false;$('camera-idle').hidden=!!scanner.running;$('camera-paused').hidden=true;$('retake-button').hidden=true;updateSaveButtons();
}
function chooseProduct(product,aliases={}){
  state.selectedId=product.id;state.draft={...product};
  for(const field of ['barcode','sku','filamentCode'])if(aliases[field])state.draft[field]=aliases[field];
  fillFields(state.draft);$('existing-product').value=product.id;lockIdentity(true);displayDraft(true);updateSaveButtons();
}
function displayDraft(matched=false){
  const p=state.draft;if(!p)return;
  $('detected-material').textContent=p.material||(p.barcode?'New barcode':'Check material');$('detected-description').textContent=[p.colour||'Check colour',p.brand||'Check brand',p.weight?p.weight+' g':'',p.variant&&p.variant!=='Unspecified'?p.variant:''].filter(Boolean).join(' · ');
  $('detected-code').textContent=p.barcode?'Barcode '+p.barcode:p.sku?'SKU '+p.sku:p.filamentCode?'Filament code '+p.filamentCode:'No code linked';
  const before=Number(p.storage||0);$('stock-preview').textContent='Storage '+before+' → '+(before+(state.mode==='ADD'?1:-1));
  $('detection-placeholder').hidden=true;$('detected-product').hidden=false;$('edit-button').hidden=false;$('detection-status').textContent=matched?'MATCH FOUND · CHECK DETAILS':'CHECK DETECTED DETAILS';$('detection-status').className='badge'+(matched?'':' review');
}
function setAlert(message){$('draft-alert').textContent=message;$('draft-alert').hidden=!message;}
function aliasConflict(product){
  const existing=state.products.find(p=>p.id===product?.id);if(!existing)return '';
  const field=['barcode','sku','filamentCode'].find(f=>existing[f]&&product[f]&&normal(existing[f])!==normal(product[f]));
  return field?'This filament already has a different '+field+'. Check the scanned code or choose a separate filament.':'';
}
function prepareLabelScan(){
  if(state.saving||!state.lastBarcode)return false;
  state.readingLabel=true;scanner.labelOnly=true;scanner.autoOcr=true;
  $('label-link-prompt').hidden=true;$('capture-preview').hidden=true;$('camera-paused').hidden=true;$('camera-guide').hidden=false;$('retake-button').hidden=true;$('product-form').hidden=true;
  $('detection-status').textContent='SCAN MATERIAL LABEL';$('capture-button').textContent='Read material label';
  setProgress('Barcode kept. Show the material label on the same box, or take/upload its photo. Nothing has been saved.');return true;
}
async function scanMaterialLabel(){
  if(!prepareLabelScan())return;
  setManual(false);if(scanner.running)scanner.resume();else await startCamera();
  if(scanner.running)setProgress('Barcode kept. Point at the material label on the same box. We’ll fill the details above for you to verify.');
}
function received({code='',text='',source,image}){
  if(!$('scan-dialog').open||state.saving)return;
  scanner.hold();state.source=source;state.raw=text;
  if(image){$('capture-preview').src=image;$('capture-preview').hidden=false;$('camera-idle').hidden=true;$('camera-guide').hidden=true;}$('camera-paused').hidden=false;$('retake-button').hidden=false;
  if(text){$('ocr-text').textContent=text;$('ocr-details').hidden=false;}
  const read=parseLabel(text),detectedCode=code||read.barcode;
  if(!state.readingLabel&&detectedCode&&state.lastBarcode&&normal(detectedCode)!==normal(state.lastBarcode))state.scanDetails={};
  const barcode=state.readingLabel?state.lastBarcode:detectedCode||state.lastBarcode;
  state.scanDetails=mergeScanDetails(state.scanDetails,read,barcode);
  const parsed={...blankDraft(),...state.scanDetails};
  if(parsed.barcode)state.lastBarcode=parsed.barcode;
  const exact=findByCode(state.products,parsed.barcode),matches=exact?[exact]:labelMatches(state.products,state.scanDetails);
  $('label-link-prompt').hidden=true;
  if(matches.length===1){chooseProduct(matches[0],parsed);const conflict=aliasConflict(state.draft);setAlert(conflict||(!exact&&parsed.barcode?'Label matches saved filament. Confirm to link this barcode and '+(state.mode==='ADD'?'add':'use')+' one roll.':'Check that this is the right filament. Each confirmation counts one roll.'));$('product-form').hidden=!conflict;}
  else{
    state.selectedId='';state.draft=parsed;fillFields(parsed);lockIdentity(false);displayDraft(false);$('product-form').hidden=false;
    const defaults=[!state.scanDetails.weight?'weight defaults to 1,000 g':'',!state.scanDetails.diameter?'diameter defaults to 1.75 mm':''].filter(Boolean).join('; ');
    setAlert((matches.length>1?'More than one product matches. Choose the correct existing filament.':state.mode==='USE'?'Choose an existing filament. Unknown products cannot be deducted.':parsed.barcode&&!parsed.material?'New code. Read the material label or enter the details to link it.':'Check the suggested details. Missing fields need your input.')+(defaults?' Not read: '+defaults+'. Verify these values.':''));
  }
  const needsLabel=!!parsed.barcode&&!exact&&matches.length!==1&&(!parsed.material||!parsed.colour||!parsed.brand);
  if(needsLabel){
    $('label-link-prompt').hidden=false;$('label-link-code').textContent=parsed.barcode;
    $('scan-material-label').textContent=state.readingLabel?'Read material label again':'Scan material label';
    $('detection-status').textContent='NEW BARCODE · LABEL NEEDED';
    if(!state.readingLabel)$('product-form').hidden=true;
  }
  setProgress(needsLabel?'Barcode kept. Scan the material label on the same box to fill its details, or enter them manually.':!exact&&parsed.barcode?'Check the label details. Your confirmation saves this barcode link and counts exactly one roll.':'Result held for verification. OK finishes; Scan another saves and continues.');updateSaveButtons();
}
function setManual(manual){
  $('manual-tab').classList.toggle('active',manual);$('manual-tab').setAttribute('aria-pressed',String(manual));$('camera-tab').classList.toggle('active',!manual);$('camera-tab').setAttribute('aria-pressed',String(!manual));
  if(manual){scanner.hold();$('label-link-prompt').hidden=true;$('product-form').hidden=false;if(!state.draft){state.draft=blankDraft();fillFields(state.draft);}setProgress('Choose an existing filament or enter details. Each confirmation counts one roll.');updateSaveButtons();}
}
function cameraState(active){$('camera-idle').hidden=active;$('capture-button').disabled=!active;$('start-camera').disabled=false;}
async function startCamera(){
  if(!state.connected)return;
  $('start-camera').disabled=true;$('camera-idle-text').textContent='Starting camera…';setManual(false);
  try{await scanner.start();}catch(e){$('camera-idle-text').textContent=e.message;$('start-camera').textContent='Try camera again';$('start-camera').disabled=false;setProgress('Take/upload a photo or enter details manually.');}
}
function updateSaveButtons(){
  if(!$('ok-button'))return;
  const p=state.draft?readFields():null;
  const conflict=aliasConflict(p);
  const disabled=state.saving||!state.connected||!p||!!validateDraft(p,state.mode)||!!conflict||!!pending;
  if(conflict)setAlert(conflict);
  $('ok-button').disabled=disabled;$('next-button').disabled=disabled;
  $('close-scan').disabled=state.saving;$('retake-button').disabled=state.saving;$('edit-button').disabled=state.saving;
  $('scan-material-label').disabled=state.saving;$('tag-manually').disabled=state.saving;
}
function savePending(request){localStorage.setItem(pendingKey,JSON.stringify(request));pending=request;}
function clearPending(){localStorage.removeItem(pendingKey);pending=null;$('pending-notice').hidden=true;$('check-save').hidden=true;$('check-save').textContent='Check save';$('resolve-pending').textContent='Check save';$('resolve-pending').onclick=resolvePending;}
function showPending(){$('pending-notice').hidden=!pending;$('check-save').hidden=!pending;if(pending)$('pending-text').textContent=(pending.mode==='ADD'?'Add':'Use')+' 1 '+(pending.product?.material||'filament')+' · '+(pending.product?.colour||'')+'. Check whether Google recorded it before continuing.';updateSaveButtons();}
async function saveRoll(again){
  if(state.saving||pending)return;
  const product=readFields(),error=validateDraft(product,state.mode)||aliasConflict(product);
  if(error){$('save-error').textContent=error;$('save-error').hidden=false;return;}
  const request={method:'mutate',requestId:crypto.randomUUID(),mode:state.mode,product,source:state.source};
  state.saving=true;scanner.hold();$('save-error').hidden=true;
  try{savePending(request);}catch{state.saving=false;$('save-error').textContent='Browser storage is unavailable. Enable site storage before saving, so a network interruption cannot cause duplicate rolls.';$('save-error').hidden=false;updateSaveButtons();return;}
  updateSaveButtons();$('ok-button').textContent='Saving to Google…';
  try{
    const result=await bridge.call(request);if(!result.event)throw new Error('Google did not return a transaction receipt.');
    clearPending();applyState(result.state);state.session++;$('session-count').textContent=state.session+' '+(state.mode==='ADD'?'added':'used');
    toast(result.warning||((state.mode==='ADD'?'Added':'Used')+' 1 '+product.material+' · '+product.colour+'. Saved to Google Sheet.'));
    if(again){populateExisting();resetDraft();setManual(false);if(scanner.running)scanner.resume();else await startCamera();}else{$('scan-dialog').close();}
  }catch(e){
    // An explicit server rejection is checked against the journal before clearing the pending request.
    if(e.serverRejected){
      try{const receipt=await bridge.call({method:'receipt',requestId:request.requestId});if(!receipt.found){clearPending();applyState(receipt.state);$('save-error').textContent=e.message;$('save-error').hidden=false;return;}}catch{}
    }
    $('save-error').textContent=e.message+' Tap “Check save” before continuing.';$('save-error').hidden=false;showPending();
  }
  finally{state.saving=false;$('ok-button').textContent='OK · '+(state.mode==='ADD'?'add':'use')+' 1 & finish';updateSaveButtons();}
}
async function resolvePending(){
  if(!pending)return;$('resolve-pending').disabled=true;$('check-save').disabled=true;
  try{
    let receipt=await bridge.call({method:'receipt',requestId:pending.requestId});
    if(receipt.found){clearPending();applyState(receipt.state);state.session++;toast('The previous roll was saved once. Inventory refreshed.');if($('scan-dialog').open)$('scan-dialog').close();$('resolve-pending').onclick=resolvePending;$('resolve-pending').textContent='Check save';}
    else{
      applyState(receipt.state);$('pending-text').textContent='Google has no receipt for this roll. Retry uses the same transaction ID, so it cannot count twice.';
      $('save-error').textContent='Google has no receipt yet. Retry uses the same transaction ID and cannot count twice.';$('save-error').hidden=false;$('check-save').textContent='Retry this save';
      $('resolve-pending').textContent='Retry this save';$('resolve-pending').onclick=async()=>{
        $('resolve-pending').disabled=true;$('check-save').disabled=true;
        try{const r=await bridge.call(pending);clearPending();applyState(r.state);toast('Saved once. Inventory refreshed.');if($('scan-dialog').open)$('scan-dialog').close();$('resolve-pending').onclick=resolvePending;$('resolve-pending').textContent='Check save';}
        catch(e){
          if(e.serverRejected){try{const receipt=await bridge.call({method:'receipt',requestId:pending.requestId});if(!receipt.found){clearPending();applyState(receipt.state);toast(e.message+' Nothing was saved.');if($('scan-dialog').open)$('scan-dialog').close();return;}}catch{}}
          $('pending-text').textContent=e.message+' The pending transaction is retained.';
        }
        finally{$('resolve-pending').disabled=false;$('check-save').disabled=false;}
      };
    }
  }catch(e){$('pending-text').textContent=e.message;$('save-error').textContent=e.message;$('save-error').hidden=false;}finally{$('resolve-pending').disabled=false;$('check-save').disabled=false;}
}
document.querySelector('.brand').addEventListener('click',event=>{event.preventDefault();window.scrollTo(0,0);});
$('add-button').addEventListener('click',()=>openSession('ADD'));$('use-button').addEventListener('click',()=>openSession('USE'));
$('close-scan').addEventListener('click',()=>$('scan-dialog').close());
$('scan-dialog').addEventListener('cancel',e=>{if(state.saving)e.preventDefault();});
$('scan-dialog').addEventListener('close',()=>{scanner.stop();if(pending)showPending();});
$('camera-tab').addEventListener('click',async()=>{setManual(false);if(!scanner.running)await startCamera();else if(!state.draft)scanner.resume();});
$('manual-tab').addEventListener('click',()=>{setManual(true);$('existing-product').focus();});
$('start-camera').addEventListener('click',startCamera);
$('capture-button').addEventListener('click',async()=>{try{await scanner.capture();}catch(e){setProgress(e.message);}});
$('scan-material-label').addEventListener('click',scanMaterialLabel);
$('tag-manually').addEventListener('click',()=>{setManual(true);$('field-material').focus();});
$('retake-button').addEventListener('click',async()=>{if(state.readingLabel){await scanMaterialLabel();return;}resetDraft();setManual(false);if(scanner.running)scanner.resume();else await startCamera();});
$('photo-input').addEventListener('change',async e=>{
  const file=e.target.files?.[0];e.target.value='';if(!file||state.saving)return;
  if(state.lastBarcode&&!findByCode(state.products,state.lastBarcode))prepareLabelScan();
  else{resetDraft();}
  setProgress('Reading photo on your device…');$('photo-input').disabled=true;$('capture-button').disabled=true;
  try{await scanner.photo(file);}catch(error){setProgress(error.message);}finally{$('photo-input').disabled=false;$('capture-button').disabled=!scanner.running;}
});
$('edit-button').addEventListener('click',()=>{$('product-form').hidden=!$('product-form').hidden;});
$('existing-product').addEventListener('change',e=>{
  const product=state.products.find(p=>p.id===e.target.value);
  if(product){chooseProduct(product,{barcode:state.lastBarcode});setAlert('Existing product selected. Check the identity before saving.');}
  else{state.selectedId='';state.draft={...blankDraft(),barcode:state.lastBarcode};fillFields(state.draft);lockIdentity(false);displayDraft(false);updateSaveButtons();}
});
$('product-form').addEventListener('submit',e=>e.preventDefault());
$('product-form').addEventListener('input',()=>{state.draft=readFields();displayDraft(!!state.selectedId);updateSaveButtons();});
$('product-form').addEventListener('change',()=>{state.draft=readFields();displayDraft(!!state.selectedId);updateSaveButtons();});
$('ok-button').addEventListener('click',()=>saveRoll(false));$('next-button').addEventListener('click',()=>saveRoll(true));
for(const id of ['search','material-filter','stock-filter'])$(id).addEventListener(id==='search'?'input':'change',renderTable);
$('refresh-button').addEventListener('click',refresh);
$('history-button').addEventListener('click',()=>$('history-dialog').showModal());$('close-history').addEventListener('click',()=>$('history-dialog').close());
$('connection-button').addEventListener('click',()=>$('connection-dialog').showModal());$('close-connection').addEventListener('click',()=>$('connection-dialog').close());
$('connection-url').value=getScriptUrl();
$('google-connect-link').addEventListener('click',()=>{try{const url=saveScriptUrl($('connection-url').value);window.location.assign(googleAccountChooserUrl(url));}catch(e){$('connection-detail').textContent=e.message;$('connection-url').focus();}});
$('resolve-pending').onclick=resolvePending;
$('check-save').addEventListener('click',()=>$('resolve-pending').click());
$('export-button').addEventListener('click',()=>{
  if(!state.loaded){toast('Load your inventory before exporting.');return;}
  const headers=['Material','Colour','In Storage','Brand','Weight (g)','Diameter (mm)','Barcode','SKU','Filament Code','Variant','Location'];
  const rows=state.products.map(p=>[p.material,p.colour,p.storage,p.brand,p.weight,p.diameter,p.barcode,p.sku,p.filamentCode,p.variant,p.location]);
  const csv='\ufeff'+[headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='filament-inventory-'+new Date().toISOString().slice(0,10)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
window.addEventListener('pagehide',()=>scanner.stop());
document.addEventListener('visibilitychange',()=>{if(document.hidden&&scanner.running){scanner.stop();setProgress('Camera paused while the app was in the background. Tap Start camera to continue.');}});
if(pending)showPending();bridge.connect();
