/* A trial exists only in this page's memory. Nothing here is persistent storage. */
(function(root){
  'use strict';
  const Store=typeof module!=='undefined'&&module.exports?require('./profile-store.js'):root.ProfileStore;
  const copy=value=>JSON.parse(JSON.stringify(value));
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function normalize(value){value=value||{};return{form:copy(value.form||{}),records:copy(value.records||[]),plans:copy(value.plans||{}),history:copy(value.history||[])}}
  function createClient(options){
    const onStatus=options?.onStatus||(()=>{}),states=new Map();
    function state(id){Store.validProfile(id);const s=states.get(id);if(!s)throw new Error('试用档案不存在，请重新选择。');return s}
    function metadata(s){return{id:s.id,name:s.name,revision:s.revision,updatedAt:s.updatedAt}}
    function profile(s){return{...metadata(s),data:copy(s.data)}}
    function notify(s){onStatus({profileId:s.id,status:'guest',dirty:false,revision:s.revision,updatedAt:s.updatedAt})}
    function validate(id,data){
      if(!Array.isArray(data.records)||data.records.some(r=>!r||r.profileId!==id))throw new Error('不能把其他档案的成绩加入当前试用档案。');
      if(data.records.length>100)throw new Error('每个档案最多保留 100 条成绩。');
      const ids=new Set();for(const r of data.records){Store.validProfile(r.id);if(ids.has(r.id))throw new Error('成绩标识重复。');ids.add(r.id)}
    }
    function change(s,mutate,image){
      const next=normalize(mutate?mutate(copy(s.data)):s.data);validate(s.id,next);
      if(image){Store.validProfile(image.recordId);if(!next.records.some(r=>r.id===image.recordId))throw new Error('截图必须对应当前档案的一条成绩。');if(!image.blob||typeof image.blob.arrayBuffer!=='function')throw new Error('截图文件无效。');s.images.set(image.recordId,{blob:image.blob,filename:image.filename||'race-result.jpg'});}
      for(const key of s.images.keys())if(!next.records.some(r=>r.id===key))s.images.delete(key);
      next.records.forEach(r=>{r.hasImage=s.images.has(r.id)});
      if(!equal(s.data,next)||image){s.data=next;s.revision++;s.edited=true;s.updatedAt=new Date().toISOString();notify(s);return true}return false;
    }
    return{
      async session(){return{user:{id:null,displayName:'公开试用'},profiles:[...states.values()].map(metadata)}},
      async create({id,name,data}){Store.validProfile(id);if(states.has(id)){const e=new Error('试用档案已存在。');e.code='profile_exists';throw e}if(states.size>=100)throw new Error('最多建立 100 个试用档案。');const normalized=normalize(data);validate(id,normalized);normalized.records.forEach(r=>r.hasImage=false);const s={id,name:String(name||'试用档案').slice(0,80),data:normalized,revision:0,updatedAt:new Date().toISOString(),images:new Map(),edited:true};states.set(id,s);notify(s);return{profile:profile(s)}},
      async load(id){const s=state(id);notify(s);return{profile:profile(s)}},
      stage(id,mutate){return change(state(id),mutate)},
      async flush(id){const s=state(id);notify(s);return{profile:profile(s)}},
      async commit(id,mutate,image){const s=state(id);change(s,mutate,image);return{profile:profile(s)}},
      async fetchImage(id,recordId,signal){if(signal?.aborted)throw new DOMException('已取消','AbortError');Store.validProfile(recordId);const image=state(id).images.get(recordId);if(!image)throw new Error('这条试用成绩没有截图。');return image.blob},
      getData:id=>copy(state(id).data),getProfile:id=>profile(state(id)),
      profiles:()=>[...states.values()].map(metadata),isLoaded:id=>states.has(id),
      status:id=>({status:'guest',dirty:false,error:null,retryable:false,busy:false,revision:state(id).revision}),
      hasUnsaved:()=>[...states.values()].some(s=>s.edited),
      markBaseline(){for(const s of states.values())s.edited=false},
      exportProfile(id){const s=state(id);return{profile:profile(s),images:[...s.images].map(([recordId,value])=>({recordId,...value}))}},
      dropProfile(id){const s=state(id);s.images.clear();states.delete(id)},
      clear(){for(const s of states.values())s.images.clear();states.clear()},
      blankData:Store.blankData
    };
  }
  function remapProfile(snapshot,targetId){
    Store.validProfile(targetId);const source=snapshot.profile.id,data=normalize(snapshot.profile.data);
    function remapKey(key){const suffix=source==='default'?'':':profile:'+source;const base=suffix&&key.endsWith(suffix)?key.slice(0,-suffix.length):key;return targetId==='default'?base:base+':profile:'+targetId}
    data.records=data.records.map(record=>({...record,profileId:targetId,hasImage:false}));
    data.plans=Object.fromEntries(Object.entries(data.plans).map(([key,value])=>[remapKey(key),value]));
    data.history=data.history.map(item=>({...item,planKey:remapKey(item.planKey)}));
    return data;
  }
  const api={createClient,remapProfile};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.GuestStore=api;
})(typeof window!=='undefined'?window:globalThis);
