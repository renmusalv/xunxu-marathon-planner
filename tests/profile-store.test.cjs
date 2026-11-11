const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createClient,createStore,validProfile,mergeNewer}=require('../src/profile-store.js');
const clone=v=>JSON.parse(JSON.stringify(v));
const data=()=>({form:{restingHr:'55'},records:[],plans:{},history:[]});
const record=(profileId='a',extra={})=>({id:'race1',profileId,date:'2026-10-18',distanceKm:10,elapsedSeconds:3000,effort:'race',confirmed:true,include:true,durationType:'elapsed',course:'road_flat',source:'manual',...extra});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject};}
function fixture(){
 const rows=new Map(['a','b'].map(id=>[id,{id,name:id,data:data(),revision:1,updatedAt:'2026-11-11T00:00:00Z'}])),calls=[],statuses=[];
 let nextFailure=null,gate=null;
 const fetch=async(url,init={})=>{
  calls.push({url,init});
  if(gate&&init.method==='PUT'){const old=gate;gate=null;await old.promise;}
  if(nextFailure&&init.method==='PUT'){const failure=nextFailure;nextFailure=null;return new Response(JSON.stringify({error:failure.message||'云端拒绝',code:failure.code||'conflict'}),{status:failure.status||409});}
  if(url==='/api/cloud/session')return Response.json({user:{displayName:'测试用户',email:'test@example.test'},profiles:[...rows.values()].map(({data,...p})=>p)});
  const id=url.split('/')[4],row=rows.get(id);
  if(url.endsWith('/images/race1'))return new Response(new Blob(['private'],{type:'image/jpeg'}));
  if(init.method==='POST'){const body=JSON.parse(init.body);const p={...body,revision:1,updatedAt:'now'};rows.set(body.id,p);return Response.json({profile:p});}
  if(!row)return Response.json({error:'not found'},{status:404});
  if(init.method==='PUT'){
   const payload=init.body instanceof FormData?JSON.parse(init.body.get('payload')):JSON.parse(init.body);
   if(payload.revision!==row.revision)return Response.json({error:'版本冲突',code:'conflict'},{status:409});
   const updated={...row,data:clone(payload.data),revision:row.revision+1,updatedAt:'now'};
   if(init.body instanceof FormData){const imageRecordId=init.body.get('imageRecordId');updated.data.records.find(r=>r.id===imageRecordId).hasImage=true;}
   rows.set(id,updated);return Response.json({profile:updated});
  }
  return Response.json({profile:row});
 };
 const client=createClient({fetch,onStatus:s=>statuses.push(s)});
 return {client,rows,calls,statuses,fail(f){nextFailure=f;},pause(){gate=deferred();return gate;}};
}
async function loaded(){const f=fixture();await f.client.session();await f.client.load('a');await f.client.load('b');return f;}

test('cloud requests use same-origin identity, no-store and protected write header',async()=>{
 const f=await loaded();f.client.stage('a',d=>{d.form.restingHr='56';return d});await f.client.flush('a');
 for(const {init}of f.calls){assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');}
 const write=f.calls.find(x=>x.init.method==='PUT');assert.equal(write.init.headers['X-Xunxu-Request'],'1');assert.equal(f.rows.get('a').data.form.restingHr,'56');assert.equal(f.client.hasUnsaved(),false);
});
test('data remains isolated for equal record IDs in two cloud profiles',async()=>{
 const f=await loaded(),store=createStore(f.client);await store.put('a',record());await store.put('b',record('b',{elapsedSeconds:4200}));
 assert.equal(store.list('a')[0].elapsedSeconds,3000);assert.equal(store.list('b')[0].elapsedSeconds,4200);
 await assert.rejects(()=>store.put('b',record()),/归属/);await store.remove('a','race1');assert.equal(store.list('a').length,0);assert.equal(store.list('b').length,1);
});
test('duplicate events and screenshots are rejected inside the owning profile',async()=>{
 const f=await loaded(),store=createStore(f.client);await store.put('a',record('a',{fingerprint:'x'.repeat(64)}));
 await assert.rejects(()=>store.put('a',record('a',{id:'race2'})),/已有/);
 await assert.rejects(()=>store.put('a',record('a',{id:'race2',date:'2026-11-01',fingerprint:'x'.repeat(64)})),/已有/);
 await store.put('b',record('b',{fingerprint:'x'.repeat(64)}));assert.equal(store.list('b').length,1);
});
test('form edits during a slow save are preserved and saved in revision order',async()=>{
 const f=await loaded(),gate=f.pause();f.client.stage('a',d=>{d.form.restingHr='56';return d});const save=f.client.flush('a');await new Promise(setImmediate);
 f.client.stage('a',d=>{d.form.restingHr='58';d.form.vo2max='48';return d});gate.resolve();await save;
 assert.equal(f.rows.get('a').data.form.restingHr,'58');assert.equal(f.rows.get('a').data.form.vo2max,'48');assert.equal(f.client.getData('a').form.restingHr,'58');
 const revisions=f.calls.filter(x=>x.init.method==='PUT').map(x=>JSON.parse(x.init.body).revision);assert.deepEqual(revisions,[1,2]);assert.equal(f.client.hasUnsaved(),false);
});
test('record commits merge new form edits without dropping acknowledged records',async()=>{
 const f=await loaded(),store=createStore(f.client),gate=f.pause();const save=store.put('a',record());await new Promise(setImmediate);
 f.client.stage('a',d=>{d.form.restingHr='61';return d});gate.resolve();await save;
 assert.equal(f.client.getData('a').records.length,1);assert.equal(f.client.getData('a').form.restingHr,'61');assert.equal(f.client.status('a').dirty,true);await f.client.flush('a');assert.equal(f.rows.get('a').data.records.length,1);
});
test('409 preserves in-memory drafts and never silently overwrites or retries',async()=>{
 const f=await loaded();f.client.stage('a',d=>{d.form.restingHr='60';return d});f.fail({status:409,code:'conflict'});
 await assert.rejects(()=>f.client.flush('a'));assert.equal(f.client.getData('a').form.restingHr,'60');assert.equal(f.rows.get('a').data.form.restingHr,'55');assert.equal(f.client.status('a').status,'conflict');
 const writes=f.calls.length;await assert.rejects(()=>f.client.flush('a'));assert.equal(f.calls.length,writes);
 await assert.rejects(()=>f.client.load('a'),/未保存/);await f.client.load('a',{discard:true});assert.equal(f.client.getData('a').form.restingHr,'55');
});
test('network failures preserve drafts and explicit retry can save them',async()=>{
 const f=await loaded();f.client.stage('a',d=>{d.form.restingHr='59';return d});f.fail({status:503,code:'storage_unavailable'});await assert.rejects(()=>f.client.flush('a'));
 assert.equal(f.client.status('a').dirty,true);assert.equal(f.statuses.at(-1).status,'error');await f.client.flush('a');assert.equal(f.rows.get('a').data.form.restingHr,'59');
});
test('failed record save does not appear as a saved result',async()=>{
 const f=await loaded(),store=createStore(f.client);f.fail({status:503,code:'storage_unavailable'});await assert.rejects(()=>store.put('a',record()));assert.deepEqual(store.list('a'),[]);assert.deepEqual(f.rows.get('a').data.records,[]);
});
test('image and record travel in one atomic profile PUT; image reads are authenticated',async()=>{
 const f=await loaded(),store=createStore(f.client);await store.put('a',record('a',{hasImage:true}),{recordId:'race1',blob:new Blob(['jpeg'],{type:'image/jpeg'}),filename:'result.jpg'});
 const write=f.calls.find(x=>x.init.method==='PUT');assert.ok(write.init.body instanceof FormData);assert.equal(write.init.body.get('imageRecordId'),'race1');assert.equal(JSON.parse(write.init.body.get('payload')).data.records[0].id,'race1');
 assert.equal(store.list('a')[0].hasImage,true);const image=await f.client.fetchImage('a','race1');assert.equal(await image.text(),'private');
});
test('identical staged snapshots create no extra cloud writes',async()=>{
 const f=await loaded();const before=f.calls.length;assert.equal(f.client.stage('a',d=>d),false);await f.client.flush('a');assert.equal(f.calls.length,before);
});
test('record validation and three-way merge avoid foreign data and stale array writes',()=>{
 for(const id of ['',null,'../a','x:y','x/y'])assert.throws(()=>validProfile(id));
 const before={form:{x:'a'},records:[],plans:{}},server={form:{x:'a'},records:[{id:'new'}],plans:{}},current={form:{x:'b'},records:[],plans:{}};
 assert.deepEqual(mergeNewer(server,before,current),{form:{x:'b'},records:[{id:'new'}],plans:{}});
});
test('production application contains no browser persistence API or local fallback',()=>{
 for(const name of ['profile-store.js','app.js','ocr.js']){const source=fs.readFileSync(path.join(__dirname,'../src',name),'utf8');assert.doesNotMatch(source,/\b(?:localStorage|sessionStorage|indexedDB)\b/);}
 assert.match(fs.readFileSync(path.join(__dirname,'../src/ocr.js'),'utf8'),/cacheMethod:\s*'none'/);
});

test('a 200 HTML sign-in redirect is treated as expired identity rather than JSON failure',async()=>{
 const client=createClient({fetch:async()=>new Response('<html>Sign in</html>',{headers:{'Content-Type':'text/html'}})});
 await assert.rejects(()=>client.session(),error=>error.code==='unauthorized'&&error.status===401);
});
test('uncertain server commits block retries until an explicit fresh read',async()=>{
 const f=await loaded();f.client.stage('a',d=>{d.form.restingHr='57';return d});f.fail({status:503,code:'save_uncertain'});
 await assert.rejects(()=>f.client.flush('a'));assert.equal(f.client.status('a').status,'conflict');const count=f.calls.length;
 await assert.rejects(()=>f.client.flush('a'));assert.equal(f.calls.length,count);assert.equal(f.client.getData('a').form.restingHr,'57');
});
test('failed explicit actions require repeating the action and do not pretend a no-op flush retried it',async()=>{
 const f=await loaded(),store=createStore(f.client);f.fail({status:503,code:'storage_unavailable'});await assert.rejects(()=>store.put('a',record()));
 assert.equal(f.client.status('a').error.source,'action');assert.equal(f.client.status('a').retryable,false);const count=f.calls.length;await f.client.flush('a');assert.equal(f.calls.length,count);assert.equal(f.client.status('a').status,'error');
});
