const test = require('node:test');
const assert = require('node:assert/strict');
const {createProvider, validateConfig, mapError, imageMime} = require('../src/supabase-cloud.js');

const config = {supabaseUrl:'https://example.supabase.co',supabasePublishableKey:'sb_publishable_testpubliconly123',emailLoginEnabled:true};
const userA = {id:'user-a',email:'a@example.com',email_confirmed_at:'2026-11-11T00:00:00Z',is_anonymous:false};
const userB = {...userA,id:'user-b',email:'b@example.com'};
const data = {form:{halfGoalTime:'01:45:00'},records:[],plans:{},history:[]};
const profile = {id:'default',name:'我的档案',data,revision:0,updatedAt:'2026-11-11T00:00:00Z'};
function setup(options = {}) {
  const calls=[],listeners=[];
  let sessionUser=options.user === undefined ? userA : options.user;
  const main={auth:{
    onAuthStateChange(cb){listeners.push(cb);return {data:{subscription:{unsubscribe(){}}}};},
    async getSession(){return {data:{session:sessionUser ? {access_token:'token-'+sessionUser.id,user:sessionUser} : null},error:null};},
    async getUser(){if(options.getUser)return options.getUser();return {data:{user: options.verifiedUser === undefined ? sessionUser : options.verifiedUser},error:options.userError||null};},
    async signInWithOtp(input){calls.push({op:'sendCode',input});return {error:options.authError||null};},
    async verifyOtp(input){calls.push({op:'verifyCode',input});sessionUser=userA;listeners.forEach(fn=>fn('SIGNED_IN',{user:userA}));return {data:{user:userA},error:options.authError||null};},
    async signOut(input){calls.push({op:'signOut',input});sessionUser=null;listeners.forEach(fn=>fn('SIGNED_OUT',null));return {error:null};}
  }};
  const sdk={createClient(url,key,settings){
    if (!settings.accessToken) {calls.push({op:'authClient',settings});return main;}
    return {
      async rpc(name,args){
        const token=await settings.accessToken();calls.push({op:'rpc',name,args,token});
        if(options.rpc){const result=await options.rpc(name,args);if(result!==undefined)return result;}
        const result = name==='xunxu_list_profiles'?{profiles:[profile]}:name==='xunxu_claim_cleanup'?{items:[]}:name==='xunxu_prepare_image'?{uploadId:'upload-1',bucket:'xunxu-results',key:'user-a/default/r1/version.png'}:name==='xunxu_get_image_key'?{bucket:'xunxu-results',key:'user-a/default/r1/version.png'}:{profile:{...profile,revision:name==='xunxu_save_profile'?1:0}};
        return {data:result,error:null};
      },
      storage:{from(bucket){return {
        async upload(key,blob,settingsUpload){const token=await settings.accessToken();calls.push({op:'upload',bucket,key,settings:settingsUpload,token});if(options.upload)await options.upload();return {data:{path:key},error:options.uploadError||null};},
        async download(key){const token=await settings.accessToken();calls.push({op:'download',bucket,key,token});return {data:png(),error:null};},
        async remove(keys){const token=await settings.accessToken();calls.push({op:'remove',bucket,keys,token});return {data:keys.map(name=>({name})),error:null};}
      };}}
    };
  }};
  const provider=createProvider(options.config || config,{supabase:sdk});
  return {provider,calls,setUser(next){sessionUser=next;listeners.forEach(fn=>fn(next?'SIGNED_IN':'SIGNED_OUT',next?{user:next}:null));}};
}
function png(){return new Blob([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])],{type:'image/png'});}
function imageBody(){const body=new FormData();body.append('payload',JSON.stringify({revision:0,data:{...data,records:[{id:'r1',profileId:'default',date:'2026-11-01',distanceKm:10,elapsedSeconds:2900}]}}));body.append('imageRecordId','r1');body.append('image',png(),'result.png');return body;}

test('configuration accepts only a public key and a clean HTTPS service origin',()=>{
  assert.equal(validateConfig(config).configured,true);
  for(const patch of [{supabasePublishableKey:'sb_secret_do-not-publish'},{supabasePublishableKey:'eyJservice_role'},{supabaseUrl:'https://user:secret@example.supabase.co'},{supabaseUrl:'http://example.supabase.co'},{supabaseUrl:'https://example.supabase.co/?key=bad'}]) assert.equal(validateConfig({...config,...patch}).configured,false);
  assert.equal(validateConfig({...config,emailLoginEnabled:'true'}).emailLoginEnabled,false);
});
test('unconfigured public trial never creates a cloud client or sends a pretend code',async()=>{
  const {provider,calls}=setup({config:{}});
  assert.equal(await provider.init(),null);
  await assert.rejects(provider.sendCode('a@example.com'),{code:'email_service_unavailable'});
  assert.equal(calls.length,0);
});
test('only the authentication session is persisted; login uses a verified email OTP',async()=>{
  const {provider,calls}=setup({user:null});await provider.init();
  await provider.sendCode(' A@EXAMPLE.COM ');
  const user=await provider.verifyCode('a@example.com','123456');
  assert.equal(user.id,'user-a');
  assert.deepEqual(calls.find(c=>c.op==='sendCode').input,{email:'a@example.com',options:{shouldCreateUser:true}});
  assert.deepEqual(calls.find(c=>c.op==='verifyCode').input,{email:'a@example.com',token:'123456',type:'email'});
  const settings=calls.find(c=>c.op==='authClient').settings.auth;
  assert.equal(settings.persistSession,true);assert.equal(settings.detectSessionInUrl,false);
  assert.equal(settings.storageKey,'xunxu-auth-v3-example.supabase.co');
});
test('an unconfirmed or anonymous user never enters the private cloud transport',async()=>{
  for(const user of [{...userA,email_confirmed_at:null},{...userA,is_anonymous:true}]){
    const {provider,calls}=setup({verifiedUser:user});assert.equal(await provider.init(),null);
    const response=await provider.createFetch(user.id)('/api/cloud/session');
    assert.equal(response.status,401);assert.equal(calls.filter(c=>c.op==='rpc').length,0);
  }
});
test('a client created for one account cannot send queued writes as another account',async()=>{
  const {provider,calls,setUser}=setup();await provider.init();const fetchA=provider.createFetch('user-a');setUser(userB);
  const response=await fetchA('/api/cloud/profiles/default',{method:'PUT',body:JSON.stringify({revision:0,data})});
  assert.equal(response.status,401);assert.equal(calls.filter(c=>c.op==='rpc').length,0);
});
test('a late initialization result cannot restore an earlier account over a newer sign-in',async()=>{
  let finish,started;const beginning=new Promise(resolve=>{started=resolve;});
  const fake=setup({getUser(){started();return new Promise(resolve=>{finish=resolve;});}});
  const pending=fake.provider.init();await beginning;fake.setUser(userB);finish({data:{user:userA},error:null});
  assert.equal((await pending).id,'user-b');assert.equal(fake.provider.getUser().id,'user-b');
});
test('session and profile reads preserve the existing cloud API response contract',async()=>{
  const {provider,calls}=setup();await provider.init();const fetch=provider.createFetch('user-a');
  const response=await fetch('/api/cloud/session'),session=await response.json();
  assert.equal(session.user.id,'user-a');assert.equal(session.profiles[0].id,'default');assert.equal(response.headers.get('cache-control'),'private, no-store');
  const loaded=await (await fetch('/api/cloud/profiles/default')).json();assert.equal(loaded.profile.revision,0);
  assert.ok(calls.filter(c=>c.op==='rpc').every(c=>c.token==='token-user-a'));
});
test('private image upload uses a ticket and an immutable object before CAS attachment',async()=>{
  const {provider,calls}=setup();await provider.init();
  const response=await provider.createFetch('user-a')('/api/cloud/profiles/default',{method:'PUT',body:imageBody()});
  assert.equal(response.status,200);
  const prepare=calls.findIndex(c=>c.name==='xunxu_prepare_image'),upload=calls.findIndex(c=>c.op==='upload'),save=calls.findIndex(c=>c.name==='xunxu_save_profile');
  assert.ok(prepare<upload&&upload<save);assert.equal(calls[upload].settings.upsert,false);
  assert.equal(calls[save].args.p_upload_id,'upload-1');assert.equal(calls[save].args.p_revision,0);
  assert.ok(!('owner_id' in calls[save].args));
});
test('an account change between upload and save stops attachment to any other account',async()=>{
  let fake;fake=setup({upload:async()=>fake.setUser(userB)});await fake.provider.init();
  const response=await fake.provider.createFetch('user-a')('/api/cloud/profiles/default',{method:'PUT',body:imageBody()});
  assert.equal(response.status,401);assert.equal(fake.calls.filter(c=>c.name==='xunxu_save_profile').length,0);
  assert.equal(fake.calls.find(c=>c.op==='upload').token,'token-user-a');
});
test('ambiguous save failure stops automatic retries and never deletes an unconfirmed image',async()=>{
  const {provider,calls}=setup({rpc(name){if(name==='xunxu_save_profile')return {data:null,error:{status:503,message:'network failed'}};}});await provider.init();
  const response=await provider.createFetch('user-a')('/api/cloud/profiles/default',{method:'PUT',body:imageBody()});
  assert.equal(response.status,409);assert.equal((await response.json()).code,'save_uncertain');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.filter(c=>c.op==='remove').length,0);
});
test('CAS conflicts remain distinct from uncertain writes and retain the current revision',async()=>{
  const {provider}=setup({rpc(name){if(name==='xunxu_save_profile')return {data:null,error:{code:'PT409',message:'档案已有新版本',details:JSON.stringify({code:'REVISION_CONFLICT',currentRevision:8})}};}});await provider.init();
  const response=await provider.createFetch('user-a')('/api/cloud/profiles/default',{method:'PUT',body:JSON.stringify({revision:0,data})});
  const error=await response.json();assert.equal(response.status,409);assert.equal(error.code,'conflict');assert.equal(error.currentRevision,8);
});
test('only server-claimed retired image objects are removed and acknowledged',async()=>{
  const {provider,calls}=setup({rpc(name){if(name==='xunxu_claim_cleanup')return {data:{items:[{uploadId:'retired-1',bucket:'xunxu-results',key:'user-a/default/old.png'}]},error:null};}});await provider.init();
  await provider.createFetch('user-a')('/api/cloud/session');await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls.find(c=>c.op==='remove').keys,['user-a/default/old.png']);
  assert.equal(calls.find(c=>c.name==='xunxu_ack_cleanup').args.p_upload_id,'retired-1');
});
test('image validation rejects MIME spoofing and active document formats',async()=>{
  assert.equal(await imageMime(png()),'image/png');
  await assert.rejects(imageMime(new Blob(['<svg onload="alert(1)"></svg>'],{type:'image/png'})),{code:'invalid_image'});
  await assert.rejects(imageMime(new Blob([await png().arrayBuffer()],{type:'image/jpeg'})),{code:'invalid_image'});
});
test('provider restrictions and rate limits give actionable errors',()=>{
  assert.equal(mapError({code:'email_address_not_authorized'}).code,'email_service_unavailable');
  assert.equal(mapError({code:'over_email_send_rate_limit'}).status,429);
  assert.equal(mapError({code:'PGRST202'}).code,'cloud_not_ready');
  assert.equal(mapError({code:'PT409',details:'{"code":"PROFILE_EXISTS"}'}).code,'profile_exists');
  assert.equal(mapError({code:'PT429',message:'待处理截图过多',details:'{"code":"UPLOAD_LIMIT"}'}).message,'待处理截图过多');
});
test('real Supabase AuthApiError instances are normalized, not passed through as app errors',()=>{
  const {AuthApiError}=require('@supabase/auth-js');
  const unavailable=mapError(new AuthApiError('Email address not authorized',403,'email_address_not_authorized'));
  assert.equal(unavailable.code,'email_service_unavailable');assert.equal(unavailable.status,503);assert.match(unavailable.message,/邮箱/);
  assert.equal(mapError(new AuthApiError('Token has expired',403,'otp_expired')).code,'invalid_otp');
  assert.equal(mapError(new AuthApiError('Rate limit',429,'over_email_send_rate_limit')).code,'rate_limited');
});
