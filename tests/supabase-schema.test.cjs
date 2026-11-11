'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {PGlite} = require('@electric-sql/pglite');

const SQL = fs.readFileSync(path.join(__dirname,'../supabase/migrations/202611110001_cloud_profiles.sql'),'utf8');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const UNCONFIRMED = '33333333-3333-4333-8333-333333333333';
const ANONYMOUS = '44444444-4444-4444-8444-444444444444';
const LIMITED = '55555555-5555-4555-8555-555555555555';
const blank = () => ({form:{},records:[],plans:{},history:[]});
const record = (id='r1',profileId='default',extra={}) => ({id,profileId,distanceKm:10,
  elapsedSeconds:3300,date:'2025-05-01',effort:'race',confirmed:true,include:true,
  durationType:'elapsed',course:'road_flat',source:'screenshot',hasImage:false,...extra});
const withRecords = (...records) => ({...blank(),records});

// Real PostgreSQL semantics in PGlite. Auth and Storage tables are deliberately
// minimal adapters; these tests do not emulate SMTP, JWT signature verification,
// Storage's HTTP/file service, or independent concurrent database connections.
test('Supabase migration executes with real PostgreSQL RLS, privileges, CAS and image state transitions', async t => {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create table storage.buckets(id text primary key,public boolean not null default false);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),
      name text not null,owner_id text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema public,auth,storage to anon,authenticated;
    grant select,insert,update,delete on storage.objects to anon,authenticated;
  `);
  for(const [id,email,confirmed,anonymous] of [
    [A,'a@example.test',true,false],[B,'b@example.test',true,false],
    [UNCONFIRMED,'pending@example.test',false,false],[ANONYMOUS,'anon@example.test',true,true],
    [LIMITED,'limit@example.test',true,false]
  ]) await db.query('insert into auth.users values($1,$2,$3,$4)',[id,email,confirmed?'2025-01-01T00:00:00Z':null,anonymous]);
  await db.exec(SQL);
  await db.query('insert into storage.buckets(id,public) values($1,false)',['xunxu-results']);

  async function run(user,sql,params=[],options={}) {
    await db.exec('reset role');
    await db.exec(`set role ${options.role || 'authenticated'}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [user||'',JSON.stringify({sub:user,is_anonymous:options.anonymous || user===ANONYMOUS})]);
    try {return await db.query(sql,params);} finally {await db.exec('reset role');}
  }
  async function rpc(user,name,params=[],options) {
    const slots = params.map((_,i)=>'$'+(i+1)).join(',');
    return (await run(user,`select public.${name}(${slots}) as result`,params,options)).rows[0].result;
  }
  async function expectError(promise,code,detailCode) {
    await assert.rejects(promise,error=> {
      assert.equal(error.code,code,error.message);
      if(detailCode)assert.equal(JSON.parse(error.detail).code,detailCode,error.message);
      return true;
    });
  }
  const create = (u,id,data=blank()) => rpc(u,'xunxu_create_profile',[id,'档案 '+id,data]);
  const get = (u,id='default') => rpc(u,'xunxu_get_profile',[id]);
  const save = (u,id,revision,data,upload=null,name=null) => rpc(u,'xunxu_save_profile',[id,revision,data,name,upload]);
  const prepare = (u,id,rid,revision,type='image/jpeg',size=100) => rpc(u,'xunxu_prepare_image',[id,rid,revision,type,size]);
  const upload = (u,ticket,metadata={mimetype:'image/jpeg',size:100}) => run(u,
    'insert into storage.objects(bucket_id,name,owner_id,metadata) values($1,$2,$3,$4)',
    [ticket.bucket,ticket.key,u,metadata]);
  const remove = (u,key) => run(u,'delete from storage.objects where bucket_id=$1 and name=$2',['xunxu-results',key]);
  let firstImage,secondImage;

  try {
    await t.test('two verified users can own the same profile ID without sharing data',async()=> {
      const a = await create(A,'default',withRecords(record('r1','default',{hasImage:true})));
      const b = await create(B,'default',withRecords(record('b1','default',{elapsedSeconds:3600})));
      await create(A,'second');
      assert.equal(a.profile.revision,1); assert.equal(b.profile.revision,1);
      assert.equal(a.profile.data.records[0].hasImage,false,'forged image flag is discarded on create');
      assert.equal((await get(A)).profile.data.records[0].id,'r1');
      assert.equal((await get(B)).profile.data.records[0].id,'b1');
      assert.deepEqual((await rpc(A,'xunxu_list_profiles')).profiles.map(p=>p.id),['default','second']);
      assert.deepEqual((await rpc(B,'xunxu_list_profiles')).profiles.map(p=>p.id),['default']);
      assert.equal('owner_id' in a.profile,false);
      assert.equal('data' in (await rpc(A,'xunxu_list_profiles')).profiles[0],false);
      assert.deepEqual((await run(B,'select id from public.xunxu_profiles order by id')).rows,[{id:'default'}]);
      await expectError(get(B,'second'),'PT404','PROFILE_NOT_FOUND');
      await expectError(save(B,'second',1,blank()),'PT404','PROFILE_NOT_FOUND');
    });
    await t.test('anonymous, unverified and client-claimed anonymous users cannot call cloud RPCs',async()=> {
      await expectError(rpc(null,'xunxu_list_profiles',[],{role:'anon'}),'42501');
      await expectError(rpc(null,'xunxu_list_profiles'),'PT401','AUTH_REQUIRED');
      await expectError(rpc(UNCONFIRMED,'xunxu_list_profiles'),'PT401','AUTH_REQUIRED');
      await expectError(rpc(ANONYMOUS,'xunxu_list_profiles'),'PT401','AUTH_REQUIRED');
      await expectError(rpc(A,'xunxu_list_profiles',[],{anonymous:true}),'PT401','AUTH_REQUIRED');
      assert.equal((await run(UNCONFIRMED,'select * from public.xunxu_profiles')).rows.length,0);
    });
    await t.test('direct table writes and private helper/table access are denied',async()=> {
      await expectError(run(A,"insert into public.xunxu_profiles(owner_id,id,name,data) values($1,'bypass','bad','{}')",[A]),'42501');
      await expectError(run(A,"update public.xunxu_profiles set revision=99 where id='default'"),'42501');
      await expectError(run(A,"delete from public.xunxu_profiles where id='default'"),'42501');
      await expectError(run(A,'select * from xunxu_private.image_uploads'),'42501');
      await expectError(run(A,"select xunxu_private.normalise_data('{}','default')"),'42501');
    });
    await t.test('CAS rejects stale writes and preserves the winner and current revision',async()=> {
      const a = await get(A);
      a.profile.data.form.weeklyKm='35';
      const winner = await save(A,'default',1,a.profile.data);
      assert.equal(winner.profile.revision,2);
      const losing=structuredClone(a.profile.data); losing.form.weeklyKm='90';
      await assert.rejects(save(A,'default',1,losing),error=> {
        assert.equal(error.code,'PT409');
        assert.deepEqual(JSON.parse(error.detail),{code:'REVISION_CONFLICT',currentRevision:2});
        return true;
      });
      assert.equal((await get(A)).profile.data.form.weeklyKm,'35');
      assert.equal((await get(B)).profile.revision,1);
    });
    await t.test('record validation rejects duplicates, cross-profile data, fake images and invalid dates',async()=> {
      await expectError(save(A,'default',2,withRecords(record(),record('duplicate'))),'PT409','DUPLICATE_RECORD');
      await expectError(save(A,'default',2,withRecords(record('wrong','second'))),'PT400','PROFILE_MISMATCH');
      await expectError(save(A,'default',2,withRecords(record('r1','default',{date:'2025-02-30'}))),'PT400','INVALID_DATE');
      await expectError(save(A,'default',2,withRecords(record('r1','default',{date:'2199-01-01'}))),'PT400','FUTURE_RECORD');
      await expectError(save(A,'default',2,withRecords(record('r1','default',{image:'data:image/png;base64,xxx'}))),'PT400','INVALID_RECORD');
      await expectError(save(A,'default',2,withRecords(record('r1','default',{imageUrl:'https://example.test/private.jpg'}))),'PT400','INVALID_RECORD');
      const fp='a'.repeat(64);
      await expectError(save(A,'default',2,withRecords(record('r1','default',{fingerprint:fp}),record('r2','default',{elapsedSeconds:3400,fingerprint:fp}))),'PT409','DUPLICATE_IMAGE');
      assert.equal((await get(A)).profile.revision,2,'failed validation does not mutate the revision');
    });
    await t.test('draft form strings are preserved and history dates normalized',async()=> {
      const data=withRecords(record());
      data.form={weeklyKm:'',halfGoalTime:'1:',restingHr:'-'};
      const key='xunxu-checkins-v1:half-target-v1:2025-05-01:6300';
      data.plans[key]={started:'2025-01-01',checkins:{'2025-05-01':true,'2025-05-02':false}};
      data.history=[{planKey:key,started:'2025-01-01',dates:['2025-05-02','2025-05-01','2025-05-01']}];
      const result=await save(A,'default',2,data);
      assert.deepEqual(result.profile.data.form,data.form);
      assert.deepEqual(result.profile.data.plans[key].checkins,{'2025-05-01':true});
      assert.deepEqual(result.profile.data.history[0].dates,['2025-05-01','2025-05-02']);
      data.plans[key].checkins={'2199-01-01':true};
      await expectError(save(A,'default',3,data),'PT400','FUTURE_CHECKIN');
    });
    await t.test('payload and record count limits reject the entire change',async()=> {
      await expectError(save(A,'default',3,{...blank(),form:{weeklyKm:'x'.repeat(1048576)}}),'PT413','DATA_TOO_LARGE');
      await expectError(save(A,'default',3,withRecords(...Array.from({length:101},(_,i)=>record('r'+i)))),'PT413','RECORD_LIMIT');
      assert.equal((await get(A)).profile.revision,3);
    });
    await t.test('image preparation requires a private bucket, valid size/type and current revision',async()=> {
      await expectError(prepare(A,'default','r1',2),'PT409','REVISION_CONFLICT');
      await expectError(prepare(A,'default','r1',3,'image/svg+xml'),'PT400','INVALID_IMAGE_TYPE');
      await expectError(prepare(A,'default','r1',3,'image/jpeg',12582913),'PT413','IMAGE_TOO_LARGE');
      await db.exec("update storage.buckets set public=true where id='xunxu-results'");
      await expectError(prepare(A,'default','r1',3),'PT503','STORAGE_NOT_READY');
      await db.exec("update storage.buckets set public=false where id='xunxu-results'");
      firstImage=await prepare(A,'default','r1',3);
      assert.match(firstImage.key,new RegExp('^'+A+'/default/r1/'));
      assert.equal(firstImage.bucket,'xunxu-results');
      assert.ok(Date.parse(firstImage.expiresAt)>Date.now());
    });
    await t.test('pending upload is private and cannot be stolen by another user or profile',async()=> {
      await expectError(upload(B,firstImage),'42501');
      await expectError(upload(A,{...firstImage,key:firstImage.key+'unreserved'}),'42501');
      await expectError(save(B,'default',1,(await get(B)).profile.data,firstImage.uploadId),'PT404','UPLOAD_NOT_FOUND');
      await expectError(save(A,'second',1,withRecords(record('r1','second')),firstImage.uploadId),'PT404','UPLOAD_NOT_FOUND');
      await expectError(save(A,'default',3,withRecords(record()),firstImage.uploadId),'PT409','IMAGE_NOT_UPLOADED');
      await upload(A,firstImage);
      assert.equal((await run(A,'select * from storage.objects where name=$1',[firstImage.key])).rows.length,0,'pending object cannot be downloaded');
      assert.equal((await run(B,'select * from storage.objects where name=$1',[firstImage.key])).rows.length,0);
    });
    await t.test('commit verifies actual object metadata and rolls back invalid image association',async()=> {
      await db.query('update storage.objects set metadata=$1 where name=$2',[{mimetype:'image/png',size:100},firstImage.key]);
      await expectError(save(A,'default',3,withRecords(record()),firstImage.uploadId),'PT400','IMAGE_METADATA_MISMATCH');
      await db.query('update storage.objects set metadata=$1 where name=$2',[{mimetype:'image/jpeg',size:99},firstImage.key]);
      await expectError(save(A,'default',3,withRecords(record()),firstImage.uploadId),'PT400','IMAGE_METADATA_MISMATCH');
      assert.equal((await get(A)).profile.revision,3);
      assert.equal((await db.query('select state from xunxu_private.image_uploads where id=$1',[firstImage.uploadId])).rows[0].state,'pending');
      await db.query('update storage.objects set metadata=$1 where name=$2',[{mimetype:'image/jpeg',size:100},firstImage.key]);
      const result=await save(A,'default',3,withRecords(record('r1','default',{hasImage:false})),firstImage.uploadId);
      assert.equal(result.profile.revision,4);
      assert.equal(result.profile.data.records[0].hasImage,true,'server derives the flag from committed association');
      assert.equal((await rpc(A,'xunxu_get_image_key',['default','r1'])).key,firstImage.key);
      assert.equal((await run(A,'select * from storage.objects where name=$1',[firstImage.key])).rows.length,1);
      assert.equal((await run(B,'select * from storage.objects where name=$1',[firstImage.key])).rows.length,0);
      await expectError(rpc(B,'xunxu_get_image_key',['default','r1']),'PT404','IMAGE_NOT_FOUND');
    });
    await t.test('attached tickets cannot be reused or their objects overwritten/deleted',async()=> {
      await expectError(save(A,'default',4,withRecords(record()),firstImage.uploadId),'PT409','UPLOAD_EXPIRED');
      const changed=await run(A,'update storage.objects set metadata=$1 where name=$2 returning id',[{mimetype:'image/png',size:1},firstImage.key]);
      assert.equal(changed.rows.length,0);
      assert.equal((await remove(A,firstImage.key)).affectedRows,0);
      const result=await save(A,'default',4,withRecords(record('r1','default',{hasImage:false})));
      assert.equal(result.profile.data.records[0].hasImage,true,'client cannot silently detach an existing image by flag');
      assert.equal(result.profile.revision,5);
    });
    await t.test('replacement attaches a unique key atomically and only retires its own old image',async()=> {
      secondImage=await prepare(A,'default','r1',5);
      assert.notEqual(secondImage.key,firstImage.key);
      await upload(A,secondImage);
      await save(A,'default',5,withRecords(record()),secondImage.uploadId);
      assert.equal((await rpc(A,'xunxu_get_image_key',['default','r1'])).key,secondImage.key);
      assert.equal((await run(A,'select * from storage.objects where name=$1',[firstImage.key])).rows.length,0);
      const cleanup=await rpc(A,'xunxu_claim_cleanup',[10]);
      assert.deepEqual(cleanup.items,[{uploadId:firstImage.uploadId,bucket:'xunxu-results',key:firstImage.key}]);
      assert.deepEqual((await rpc(B,'xunxu_claim_cleanup',[10])).items,[]);
      await expectError(rpc(A,'xunxu_ack_cleanup',[firstImage.uploadId]),'PT409','IMAGE_STILL_EXISTS');
      await expectError(rpc(B,'xunxu_ack_cleanup',[firstImage.uploadId]),'PT404','UPLOAD_NOT_FOUND');
      assert.equal((await remove(B,firstImage.key)).affectedRows,0);
      assert.equal((await remove(A,firstImage.key)).affectedRows,1,'test simulates Storage API SQL under the user role');
      assert.deepEqual(await rpc(A,'xunxu_ack_cleanup',[firstImage.uploadId]),{ok:true});
      await expectError(upload(A,firstImage),'42501','');
      await expectError(save(A,'default',6,withRecords(record()),firstImage.uploadId),'PT409','UPLOAD_EXPIRED');
    });
    await t.test('deleting a record retires the image and a forged flag cannot create an association',async()=> {
      const result=await save(A,'default',6,withRecords(record('r2','default',{hasImage:true,elapsedSeconds:3400})));
      assert.equal(result.profile.data.records[0].hasImage,false);
      await expectError(rpc(A,'xunxu_get_image_key',['default','r1']),'PT404','IMAGE_NOT_FOUND');
      const cleanup=await rpc(A,'xunxu_claim_cleanup',[10]);
      assert.equal(cleanup.items.some(i=>i.uploadId===secondImage.uploadId),true);
      await remove(A,secondImage.key);
      await rpc(A,'xunxu_ack_cleanup',[secondImage.uploadId]);
    });
    await t.test('CAS failure leaves a pending ticket; cleanup retires it before granting delete',async()=> {
      const pending=await prepare(A,'default','r2',7);
      await upload(A,pending);
      const data=(await get(A)).profile.data;
      await save(A,'default',7,data);
      await expectError(save(A,'default',7,data,pending.uploadId),'PT409','REVISION_CONFLICT');
      await rpc(A,'xunxu_claim_cleanup',[10]);
      const row=(await db.query('select state,cleanup_after from xunxu_private.image_uploads where id=$1',[pending.uploadId])).rows[0];
      assert.equal(row.state,'retired');
      assert.equal((await remove(A,pending.key)).affectedRows,0,'grace period is not a delete lease');
      await expectError(save(A,'default',8,data,pending.uploadId),'PT409','UPLOAD_EXPIRED');
      await db.query("update xunxu_private.image_uploads set cleanup_after=now()-interval '1 minute' where id=$1",[pending.uploadId]);
      assert.equal((await rpc(A,'xunxu_claim_cleanup',[10])).items.some(i=>i.uploadId===pending.uploadId),true);
      await remove(A,pending.key); await rpc(A,'xunxu_ack_cleanup',[pending.uploadId]);
    });
    await t.test('expired tickets cannot upload or attach and cleanup retries after its lease expires',async()=> {
      const expired=await prepare(A,'default','r2',8);
      await db.query("update xunxu_private.image_uploads set expires_at=now()-interval '1 minute' where id=$1",[expired.uploadId]);
      await expectError(upload(A,expired),'42501');
      await expectError(save(A,'default',8,(await get(A)).profile.data,expired.uploadId),'PT409','UPLOAD_EXPIRED');
      await rpc(A,'xunxu_claim_cleanup',[10]);
      await db.query("update xunxu_private.image_uploads set cleanup_after=now()-interval '1 minute' where id=$1",[expired.uploadId]);
      assert.equal((await rpc(A,'xunxu_claim_cleanup',[10])).items.some(i=>i.uploadId===expired.uploadId),true);
      assert.equal((await rpc(A,'xunxu_claim_cleanup',[10])).items.some(i=>i.uploadId===expired.uploadId),false,'active cleanup lease is not handed out twice');
      await db.query("update xunxu_private.image_uploads set cleanup_lease_until=now()-interval '1 minute' where id=$1",[expired.uploadId]);
      assert.equal((await rpc(A,'xunxu_claim_cleanup',[10])).items.some(i=>i.uploadId===expired.uploadId),true);
      await rpc(A,'xunxu_ack_cleanup',[expired.uploadId]);
    });
    await t.test('profile limit is enforced server-side and create takes an owner advisory lock',async()=> {
      for(let i=0;i<100;i++)await create(LIMITED,'p'+i);
      assert.equal((await rpc(LIMITED,'xunxu_list_profiles')).profiles.length,100);
      await expectError(create(LIMITED,'over_limit'),'PT413','PROFILE_LIMIT');
      const definition=(await db.query("select pg_get_functiondef('public.xunxu_create_profile(text,text,jsonb)'::regprocedure) as definition")).rows[0].definition;
      assert.match(definition,/pg_advisory_xact_lock/,'count check must remain serialized in multi-connection production PostgreSQL');
    });
    await t.test('restrictive bucket guards survive an unrelated permissive Storage policy',async()=> {
      await db.exec('create policy unrelated_allow_all on storage.objects for all to authenticated using(true) with check(true)');
      const ticket=await prepare(A,'default','r2',8); await upload(A,ticket);
      await expectError(upload(B,ticket),'42501');
      assert.equal((await run(B,'select * from storage.objects where name=$1',[ticket.key])).rows.length,0);
      assert.equal((await remove(B,ticket.key)).affectedRows,0);
      assert.equal((await remove(A,ticket.key)).affectedRows,0,'even owner cannot delete pending object before retirement');
      await db.exec('drop policy unrelated_allow_all on storage.objects');
    });
  } finally {await db.close();}
});
