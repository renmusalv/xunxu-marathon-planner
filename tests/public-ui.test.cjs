const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const ProfileStore=require('../src/profile-store.js');
const GuestStore=require('../src/guest-store.js');
const copy=value=>JSON.parse(JSON.stringify(value));
const blank=(form={})=>({form,records:[],plans:{},history:[]});
const record=(id,profileId)=>({id,profileId,date:'2026-11-01',distanceKm:10,elapsedSeconds:3000,effort:'race',confirmed:true,include:true,durationType:'elapsed',course:'road_flat',hasImage:true});

test('trial images and data stay isolated by profile and by page instance',async()=>{
 const statuses=[],client=GuestStore.createClient({onStatus:s=>statuses.push(s.status)}),otherPage=GuestStore.createClient();
 await client.create({id:'a',name:'A',data:blank({restingHr:'52'})});await client.create({id:'b',name:'B',data:blank({restingHr:'67'})});client.markBaseline();
 const image=new Blob(['a-image'],{type:'image/png'});
 await client.commit('a',data=>{data.records=[record('same-record','a')];return data},{recordId:'same-record',blob:image});
 await client.commit('b',data=>{data.records=[record('same-record','b')];return data});
 assert.equal(await(await client.fetchImage('a','same-record')).text(),'a-image');await assert.rejects(client.fetchImage('b','same-record'),/没有截图/);
 assert.equal(client.getData('b').form.restingHr,'67');assert.equal(client.getData('b').records[0].hasImage,false);
 const changed=client.getData('a');changed.form.restingHr='999';assert.equal(client.getData('a').form.restingHr,'52');
 assert.equal(otherPage.profiles().length,0);assert.ok(client.hasUnsaved());assert.ok(statuses.every(s=>s==='guest'));
 await client.flush('a');assert.ok(client.hasUnsaved(),'confirming a trial must not imply durable saving');
});
test('trial rejects cross-profile records and removes detached screenshots',async()=>{
 const client=GuestStore.createClient();await client.create({id:'a',name:'A',data:blank()});
 await assert.rejects(client.commit('a',data=>{data.records=[record('x','b')];return data},{recordId:'x',blob:new Blob(['x'])}),/其他档案/);
 assert.equal(client.getData('a').records.length,0);
 await client.commit('a',data=>{data.records=[record('x','a')];return data},{recordId:'x',blob:new Blob(['x'])});
 await client.commit('a',data=>{data.records=[];return data});await assert.rejects(client.fetchImage('a','x'),/没有截图/);
 client.clear();assert.equal(client.profiles().length,0);assert.equal(client.hasUnsaved(),false);
});
test('explicit import remaps record ownership and check-in keys without mutating trial',()=>{
 const snapshot={profile:{id:'default',name:'Trial',data:{form:{weeklyKm:'40'},records:[record('x','default')],plans:{'plan-key':{started:'2026-11-01',checkins:{'2026-11-02':true}}},history:[{planKey:'plan-key',started:'2026-11-01',dates:['2026-11-02']}]}}},before=copy(snapshot);
 const next=GuestStore.remapProfile(snapshot,'new-profile');assert.equal(next.records[0].profileId,'new-profile');assert.equal(next.records[0].hasImage,false);
 assert.ok(next.plans['plan-key:profile:new-profile'].checkins['2026-11-02']);assert.equal(next.history[0].planKey,'plan-key:profile:new-profile');assert.deepEqual(snapshot,before);
 const named={profile:{id:'old',data:{...blank(),plans:{'plan-key:profile:old':{started:'2026-11-01',checkins:{}}},history:[{planKey:'plan-key:profile:old'}]}}};
 assert.ok(GuestStore.remapProfile(named,'new').plans['plan-key:profile:new']);
});
function harness({configured=false,emailEnabled=true}={}){
 const elements=new Map(),remote=new Map(),boundOwners=[],cloudStatuses=new Map(),flushCalls=[];let authUser=null,sends=0,authListener=null,sendWait=null,releaseSend=null;
 function element(id){
  if(elements.has(id))return elements.get(id);
  const attrs=new Map(),classes=new Set();const e={id,value:'',textContent:'',innerHTML:'',hidden:false,open:false,disabled:false,dataset:{},style:{},children:[],tagName:'INPUT',checked:true,
   classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,yes){if(yes??!classes.has(x))classes.add(x);else classes.delete(x)}},
   setAttribute:(n,v)=>attrs.set(n,String(v)),getAttribute:n=>attrs.get(n)??null,removeAttribute:n=>attrs.delete(n),parentElement:{setAttribute(){}},
   addEventListener(){},focus(){},scrollIntoView(){},reportValidity:()=>true,setCustomValidity(){},showModal(){e.open=true},close(){e.open=false},
   replaceChildren(){e.children=[];e.value=''},appendChild(child){e.children.push(child);if(e.children.length===1)e.value=child.value}};elements.set(id,e);return e;
 }
 const document={getElementById:element,createElement:tag=>({...element('created-'+elements.size),tagName:tag.toUpperCase()}),querySelector:()=>null,querySelectorAll(selector){
  if(selector==='#weekList .checkin[data-workout="true"]')return [...element('weekList').innerHTML.matchAll(/<button\b([^>]*)>/g)].filter(m=>/data-workout="true"/.test(m[1])).map(m=>{const a=Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(x=>[x[1],x[2]]));return{dataset:{date:a['data-date']},getAttribute:key=>a[key]??null}});
  return[];
 }};
 const defaults={distance:'21.0975',halfGoalTime:'01:45:00',paceMin:'5',paceSec:'0',weeklyKm:'',days:'',longRun:'',maxHrSource:'observed',thresholdHrSource:'watch',vo2maxSource:'watch'};Object.entries(defaults).forEach(([id,value])=>element(id).value=value);
 function remoteClient(owner,onStatus){
  if(!remote.has(owner))remote.set(owner,GuestStore.createClient());const store=remote.get(owner);
  return{...store,session:async()=>({user:{id:owner,email:owner+'@example.com'},profiles:store.profiles()}),status:id=>cloudStatuses.get(owner)||({...store.status(id),status:'saved'}),hasUnsaved:()=>Boolean(cloudStatuses.get(owner)?.dirty),flush:async id=>{flushCalls.push(owner);cloudStatuses.delete(owner);return store.flush(id)}};
 }
 const provider={isConfigured:()=>configured,isEmailLoginEnabled:()=>emailEnabled,getUser:()=>authUser,init:async()=>authUser,
  createFetch(owner){boundOwners.push(owner);return Object.assign(()=>{},{owner})},sendCode:async()=>{sends++;if(sendWait)await sendWait},verifyCode:async()=>{authListener?.(authUser);return authUser},signOut:async()=>{authUser=null},onAuthChange(callback){authListener=callback;return()=>{authListener=null}}};
 const context=vm.createContext({document,ProfileStore:{...ProfileStore,createClient:options=>remoteClient(options.fetch?.owner,options.onStatus)},GuestStore,XunxuCloud:provider,
  RunningAssessment:require('../src/assessment.js'),TargetPlan:require('../src/target-plan.js'),SessionAdvice:require('../src/session-advice.js'),
  crypto:webcrypto,Date,Blob,URL,AbortController,DOMException,confirm:()=>true,setTimeout:()=>0,clearTimeout(){}});
 const source=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8'),marker='// Boot and explicit UI events.';
 vm.runInContext(source.slice(0,source.indexOf(marker))+`
 globalThis.api={startPublicApp,startGuest,activateCloud,signOut,saveProfileForm,render,importTrial,openLogin,sendCode,verifyCode,updateCloudStatus,hasUnsavedChanges,
 client:()=>cloud,mode:()=>storageMode,pending:()=>savedGuestClient,active:()=>activeProfileId,
 setDraft:draft=>{recordDraft=draft},draft:()=>recordDraft};`,context);
 return{api:context.api,element,remote,boundOwners,flushCalls,setCloudStatus:(owner,status)=>cloudStatuses.set(owner,status),setUser:user=>{authUser=user},emitUser:user=>{authUser=user;authListener?.(user)},blockSending(){sendWait=new Promise(resolve=>{releaseSend=resolve});return()=>releaseSend()},sends:()=>sends,async seed(owner,form){const client=remoteClient(owner);await client.create({id:'default',name:owner,data:blank(form)});return client}};
}
test('unconfigured public app generates 1:45 plan without authentication and cannot send fake OTP',async()=>{
 const h=harness();await h.api.startPublicApp();assert.equal(h.api.mode(),'guest');assert.match(h.element('weekList').innerHTML,/4:50–4:55\/km/);assert.match(h.element('cloudState').textContent,/尚未接通/);assert.equal(h.api.hasUnsavedChanges(),false);
 assert.equal(h.element('weeklyKm').value,'');assert.equal(h.element('longRun').value,'');assert.equal(h.element('days').value,'');assert.equal(h.element('fitScore').textContent,'—');
 h.element('weeklyKm').value='44';h.api.saveProfileForm();assert.equal(h.api.client().getData('default').form.weeklyKm,'44');assert.equal(h.api.hasUnsavedChanges(),true);
 h.api.openLogin();assert.ok(h.element('loginDialog').open);assert.equal(h.element('loginUnavailable').hidden,false);assert.equal(h.element('sendCodeForm').hidden,true);
 await h.api.sendCode({preventDefault(){}});assert.equal(h.sends(),0);assert.doesNotMatch(h.element('cloudState').textContent,/已保存/);
});
test('email login retains trial and explicit import creates a new cloud profile including images',async()=>{
 const h=harness({configured:true});const original=await h.seed('user-a',{weeklyKm:'60',restingHr:'49'});await h.api.startPublicApp();
 h.element('weeklyKm').value='44';h.api.saveProfileForm();await h.api.client().commit('default',data=>{data.records=[record('result','default')];return data},{recordId:'result',blob:new Blob(['private-result']),filename:'race.png'});
 h.setUser({id:'user-a',email:'a@example.com'});await h.api.activateCloud({id:'user-a',email:'a@example.com'});
 assert.equal(h.api.mode(),'cloud');assert.equal(h.element('weeklyKm').value,'60');assert.equal(original.profiles().length,1);assert.equal(h.api.pending().getData('default').form.weeklyKm,'44');assert.equal(h.element('trialImport').hidden,false);
 await h.api.importTrial();const newId=h.api.active();assert.notEqual(newId,'default');assert.equal(original.profiles().length,2);assert.equal(original.getData('default').form.weeklyKm,'60');assert.equal(original.getData(newId).form.weeklyKm,'44');assert.equal(original.getData(newId).records[0].profileId,newId);assert.equal(await(await original.fetchImage(newId,'result')).text(),'private-result');assert.equal(h.element('trialImport').hidden,true);
});
test('account changes with matching profile ids clear previous account data; logout returns fresh trial',async()=>{
 const h=harness({configured:true});await h.seed('user-a',{weeklyKm:'61',restingHr:'49'});await h.seed('user-b',{weeklyKm:'22',restingHr:'72'});await h.api.startPublicApp();
 h.setUser({id:'user-a'});await h.api.activateCloud({id:'user-a'});assert.equal(h.element('restingHr').value,'49');
 h.setUser({id:'user-b'});await h.api.activateCloud({id:'user-b'});assert.equal(h.element('restingHr').value,'72');assert.equal(h.element('weeklyKm').value,'22');assert.deepEqual(h.boundOwners,['user-a','user-b']);
 await h.api.signOut();assert.equal(h.api.mode(),'guest');assert.equal(h.element('restingHr').value,'');assert.equal(h.element('weeklyKm').value,'');assert.equal(h.api.client().getData('default').records.length,0);assert.equal(h.api.pending(),null);
});

test('switching identities closes and clears an in-flight old result draft',async()=>{
 const h=harness({configured:true});await h.seed('a',{restingHr:'51'});await h.seed('b',{restingHr:'69'});await h.api.startPublicApp();h.setUser({id:'a'});await h.api.activateCloud({id:'a'});
 let aborted=false;h.api.setDraft({owner:'default',saving:true,dirty:true,controller:{abort(){aborted=true}},objectUrl:null});h.element('recordDialog').open=true;h.element('rawText').textContent='private old result';h.element('imageFilename').textContent='old.png';
 h.setUser({id:'b'});await h.api.activateCloud({id:'b'});assert.equal(h.api.draft(),null);assert.equal(aborted,true);assert.equal(h.element('recordDialog').open,false);assert.equal(h.element('rawText').textContent,'');assert.equal(h.element('imageFilename').textContent,'');assert.equal(h.element('restingHr').value,'69');
});

test('account changes during a pending OTP send are reconciled before the action finishes',async()=>{
 const h=harness({configured:true});await h.seed('a',{restingHr:'51'});await h.seed('b',{restingHr:'69'});await h.api.startPublicApp();h.setUser({id:'a'});await h.api.activateCloud({id:'a'});
 const release=h.blockSending();h.element('loginEmail').value='a@example.com';const sending=h.api.sendCode({preventDefault(){}});h.emitUser({id:'b'});release();await sending;
 assert.equal(h.element('restingHr').value,'69');assert.deepEqual(h.boundOwners,['a','b']);assert.equal(h.api.mode(),'cloud');
});
test('a deferred sign-out during OTP send clears the old account after the operation',async()=>{
 const h=harness({configured:true});await h.seed('a',{restingHr:'51'});await h.api.startPublicApp();h.setUser({id:'a'});await h.api.activateCloud({id:'a'});
 const release=h.blockSending();h.element('loginEmail').value='a@example.com';const sending=h.api.sendCode({preventDefault(){}});h.emitUser(null);release();await sending;
 assert.equal(h.api.mode(),'guest');assert.equal(h.element('restingHr').value,'');assert.equal(h.api.pending(),null);
});
test('a successful OTP and its deferred auth event activate the user only once',async()=>{
 const h=harness({configured:true});await h.seed('a',{restingHr:'51'});await h.api.startPublicApp();h.element('loginEmail').value='a@example.com';await h.api.sendCode({preventDefault(){}});
 h.setUser({id:'a'});h.element('loginCode').value='123456';await h.api.verifyCode({preventDefault(){}});
 assert.equal(h.api.mode(),'cloud');assert.equal(h.element('restingHr').value,'51');assert.deepEqual(h.boundOwners,['a']);
});

test('401 permits same-user OTP reauthentication and saves the existing draft without reloading',async()=>{
 const h=harness({configured:true});await h.seed('a',{weeklyKm:'60',restingHr:'51'});await h.api.startPublicApp();h.setUser({id:'a'});await h.api.activateCloud({id:'a'});
 h.element('weeklyKm').value='44';h.api.saveProfileForm();const status={status:'unauthorized',dirty:true,error:{message:'expired',code:'unauthorized',source:'autosave'}};h.setCloudStatus('a',status);h.api.updateCloudStatus(status);
 h.api.openLogin();assert.equal(h.element('loginDialog').open,true);assert.equal(h.element('sendCodeForm').hidden,false);
 h.element('loginEmail').value='a@example.com';await h.api.sendCode({preventDefault(){}});h.element('loginCode').value='123456';await h.api.verifyCode({preventDefault(){}});
 assert.deepEqual(h.boundOwners,['a']);assert.deepEqual(h.flushCalls,['a']);assert.equal(h.api.client().getData('default').form.weeklyKm,'44');assert.equal(h.element('weeklyKm').value,'44');assert.match(h.element('cloudState').textContent,/已保存/);
});
test('reauthentication never labels a failed explicit action as saved',async()=>{
 const h=harness({configured:true});await h.seed('a',{restingHr:'51'});await h.api.startPublicApp();h.setUser({id:'a'});await h.api.activateCloud({id:'a'});
 const status={status:'unauthorized',dirty:false,error:{message:'expired',code:'unauthorized',source:'action'}};h.setCloudStatus('a',status);h.api.updateCloudStatus(status);h.api.openLogin();h.element('loginEmail').value='a@example.com';await h.api.sendCode({preventDefault(){}});h.element('loginCode').value='123456';await h.api.verifyCode({preventDefault(){}});
 assert.equal(h.flushCalls.length,0);assert.deepEqual(h.boundOwners,['a']);assert.match(h.element('cloudState').textContent,/重新执行/);assert.doesNotMatch(h.element('cloudState').textContent,/已保存/);assert.equal(h.element('cloudRetry').hidden,true);
});
