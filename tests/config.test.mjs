import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeScriptUrl,googleAccountChooserUrl,getScriptUrl,saveScriptUrl} from '../config.js';

const canonical='https://script.google.com/macros/s/'+'A'.repeat(40)+'/exec';
test('account-specific copied links lose session indexes and account hints',()=>{
  assert.equal(normalizeScriptUrl(canonical),canonical);
  assert.equal(normalizeScriptUrl('  '+canonical.replace('/macros/','/macros/u/5/')+'/?authuser=5&usp=sharing#old  '),canonical);
});
test('account chooser returns only to the validated deployment, without a preselected account',()=>{
  const chooser=new URL(googleAccountChooserUrl(canonical+'?authuser=5&continue=https://example.com'));
  assert.equal(chooser.origin,'https://accounts.google.com');
  assert.equal(chooser.pathname,'/AccountChooser');
  assert.deepEqual([...chooser.searchParams],[['continue',canonical]]);
});
test('connection URLs reject other origins, credentials and non-deployment paths',()=>{
  for(const bad of ['javascript:alert(1)',canonical.replace('https:','http:'),canonical.replace('script.google.com','script.google.com.evil.example'),canonical.replace('script.google.com','owner@script.google.com'),canonical.replace('/exec','/dev'),canonical.replace('/macros/s/','/macros/u/owner/s/')]){
    assert.throws(()=>googleAccountChooserUrl(bad),/web app URL/);
  }
});
test('browser storage accepts copied account-specific links and tolerates invalid saved data',()=>{
  let stored='';globalThis.localStorage={getItem:()=>stored,setItem:(key,value)=>{stored=value;}};
  try{
    assert.equal(saveScriptUrl(canonical.replace('/macros/','/macros/u/5/')),canonical);
    assert.equal(stored,canonical);assert.equal(getScriptUrl(),canonical);
    stored='https://example.com';assert.equal(getScriptUrl(),'');
  }finally{delete globalThis.localStorage;}
});
