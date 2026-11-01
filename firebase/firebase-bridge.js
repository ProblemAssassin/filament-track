import {initializeApp} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import {getAuth,onAuthStateChanged,setPersistence,browserLocalPersistence,GoogleAuthProvider,signInWithPopup,signOut} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import * as firestore from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';
import {firebaseConfig} from './firebase-config.js';
import {FirestoreStore} from './store.js';

export class FirebaseBridge{
  constructor(status,lateResult=()=>{}){
    const app=initializeApp(firebaseConfig);this.auth=getAuth(app);this.db=firestore.getFirestore(app);
    this.status=status;this.lateResult=lateResult;this.user=null;this.store=null;this.epoch=0;this.owner=null;
  }
  async connect(){
    this.status('connecting','Checking your saved sign-in…');
    try{
      await setPersistence(this.auth,browserLocalPersistence);
      onAuthStateChanged(this.auth,user=>this.authenticated(user));
    }catch(error){this.status('error',this.message(error));}
  }
  async authenticated(user){
    const epoch=++this.epoch;this.user=user;this.store=null;this.owner=null;
    if(!user){this.status('signedout','Choose your Google account to open your inventory.');return;}
    this.status('connecting','Checking access to your inventory…');
    try{
      const owner=await firestore.getDoc(firestore.doc(this.db,'owners',user.uid));
      if(epoch!==this.epoch)return;
      if(!user.emailVerified||!owner.exists()||!owner.data().enabled){this.status('error','This Google account does not have access to the inventory. Choose the account used to set it up.');return;}
      this.owner=owner.data();this.store=new FirestoreStore(this.db,user.uid,firestore);this.status('connected','Signed in. Loading your inventory…');
    }catch(error){if(epoch===this.epoch)this.status('error',this.message(error));}
  }
  async signIn(){
    const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
    // Called directly from a user tap so mobile browsers can open Google's account picker.
    try{await signInWithPopup(this.auth,provider);}catch(error){this.status('error',this.message(error));}
  }
  async signOut(){await signOut(this.auth);}
  message(error){
    const messages={
      'auth/popup-blocked':'Your browser blocked Google sign-in. Allow this sign-in window and tap again.',
      'auth/popup-closed-by-user':'Sign-in was closed. Tap Sign in with Google to try again.',
      'auth/unauthorized-domain':'This app address has not been enabled for Google sign-in yet.',
      'auth/network-request-failed':'Google sign-in could not connect. Check your connection and try again.',
      'permission-denied':'This account does not have permission to update the inventory.',
      'unavailable':'The database could not be reached. Your pending roll is kept for retry.'
    };return messages[error.code]||error.message||'Could not connect. Please try again.';
  }
  async call(request,progress=()=>{}){
    if(!this.store)throw new Error('Sign in before updating inventory.');
    if(request.accountUid&&request.accountUid!==this.user?.uid)throw new Error('This pending roll belongs to a different Google account. Switch back to that account to finish it.');
    const epoch=this.epoch,store=this.store,started=performance.now();let timedOut=false,timer,slow;
    progress({stage:'sending'});slow=setTimeout(()=>progress({stage:'slow'}),6000);
    const operation=(async()=>{
      if(request.method==='list')return store.list();
      if(request.method==='receipt')return store.receipt(request.requestId);
      if(request.method==='mutate')return store.mutate(request);
      throw new Error('Unsupported inventory operation.');
    })().then(result=>{
      if(epoch!==this.epoch)throw new Error('Your signed-in account changed. Reconnect before continuing.');
      result.durationMs=Math.round(performance.now()-started);
      if(timedOut&&request.method==='mutate')this.lateResult(request,result);
      return result;
    }).catch(error=>{error.message=this.message(error);if(['permission-denied','invalid-argument'].includes(error.code))error.serverRejected=true;throw error;});
    try{return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>{timedOut=true;reject(new Error('The database has not confirmed this roll yet. Finish / check retries the same transaction safely.'));},20000);})]);}
    finally{clearTimeout(timer);clearTimeout(slow);}
  }
  async importProducts(products){if(!this.store||!this.owner?.importOpen)throw new Error('Opening-stock import is closed.');return this.store.importProducts(products);}
}
