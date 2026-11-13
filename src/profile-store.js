/* Cloud-only persistence. Drafts exist in memory until the server acknowledges them. */
(function (root) {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  function validProfile(id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('档案标识无效，请重新选择档案。');
    return id;
  }
  function blankData() { return {form:{}, records:[], plans:{}, history:[]}; }
  function normalizeData(data) {
    data = plain(data) ? data : {};
    return {form:plain(data.form)?copy(data.form):{},records:Array.isArray(data.records)?copy(data.records):[],plans:plain(data.plans)?copy(data.plans):{},history:Array.isArray(data.history)?copy(data.history):[]};
  }
  function mergeNewer(server, before, current) {
    if (equal(before,current)) return copy(server);
    if (!plain(before) || !plain(current) || !plain(server)) return copy(current);
    const result=copy(server);
    for(const key of new Set([...Object.keys(before),...Object.keys(current)])) {
      if(equal(before[key],current[key]))continue;
      if(!Object.prototype.hasOwnProperty.call(current,key))delete result[key];
      else result[key]=plain(before[key])&&plain(current[key])&&plain(server[key])?mergeNewer(server[key],before[key],current[key]):copy(current[key]);
    }
    return result;
  }
  function nextRecords(profileId, records, record) {
    validProfile(profileId); validProfile(record.id);
    if(record.profileId!==profileId)throw new Error('成绩归属与当前档案不一致。');
    if(records.some(r=>r.profileId!==profileId))throw new Error('成绩数据归属异常，请重新读取云端档案。');
    const duplicate=records.some(r=>r.id!==record.id&&((record.fingerprint&&r.fingerprint===record.fingerprint)||(r.date===record.date&&Number(r.distanceKm)===Number(record.distanceKm)&&Number(r.elapsedSeconds)===Number(record.elapsedSeconds))));
    if(duplicate)throw new Error('这个档案已有同一天、同距离和用时的成绩，请编辑原记录，避免重复计算。');
    if(!records.some(r=>r.id===record.id)&&records.length>=100)throw new Error('每个档案最多保存 100 条成绩，请先整理旧记录。');
    return records.filter(r=>r.id!==record.id).concat(copy(record)).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  }
  function createClient(options) {
    options=options||{};
    const requestFetch=options.fetch||((...args)=>root.fetch(...args)), onStatus=options.onStatus||(()=>{}), states=new Map();
    let registry=[],user=null;
    const path=id=>'/api/cloud/profiles/'+encodeURIComponent(validProfile(id));
    function state(id) { const value=states.get(validProfile(id));if(!value)throw new Error('云端档案尚未加载。');return value; }
    function notify(s,status,error,extra) {s.status=status;s.error=error||null;onStatus({profileId:s.id,status,error:s.error,dirty:s.dirty,retryable:s.dirty&&s.error?.source!=='action',revision:s.revision,updatedAt:s.updatedAt,...extra});}
    function metadata(s) {return {id:s.id,name:s.name,revision:s.revision,updatedAt:s.updatedAt};}
    function remember(s) {const item=metadata(s),index=registry.findIndex(p=>p.id===s.id);if(index<0)registry.push(item);else registry[index]=item;}
    function accept(profile) {
      if(!profile||!Number.isInteger(profile.revision))throw new Error('云端返回了无效的档案版本。');
      const id=validProfile(profile.id),s={id,name:profile.name,data:normalizeData(profile.data),revision:profile.revision,updatedAt:profile.updatedAt||'',version:0,dirty:false,status:'saved',error:null,tail:Promise.resolve(),flushPromise:null,busy:0};
      states.set(id,s);remember(s);return s;
    }
    async function responseError(response) {
      let details={};try{details=await response.json()}catch{}
      const error=new Error(details.error||(response.status===401?'登录已过期，请重新登录后继续保存。':response.status===409?'云端已有新版本。当前修改仍保留在页面中，请重新读取云端后核对。':'云端请求失败，请稍后重试。'));
      error.status=response.status;error.code=details.code||(response.status===409?'conflict':response.status===401?'unauthorized':'network');error.currentRevision=details.currentRevision;return error;
    }
    async function request(url, init, kind='json') {
      let response;
      try {response=await requestFetch(url,{credentials:'same-origin',cache:'no-store',...(init||{})});}
      catch(cause){const error=new Error('无法连接云端，修改尚未保存。请检查网络后重试。');error.code='network';error.cause=cause;throw error;}
      const contentType=(response.headers?.get('content-type')||'').toLowerCase();
      if(contentType.includes('text/html')||(response.redirected&&/signin|login|auth/i.test(response.url||''))){const error=new Error('登录已过期，请重新登录后继续读取和保存云端档案。');error.status=401;error.code='unauthorized';throw error;}
      if(!response.ok)throw await responseError(response);
      if(kind==='json'&&!contentType.includes('application/json')){const error=new Error('云端响应格式异常，请重新读取后重试。');error.code='invalid_response';throw error;}
      if(kind==='image'&&!contentType.startsWith('image/')){const error=new Error('云端截图响应无效，请重新读取档案。');error.code='invalid_response';throw error;}
      return response;
    }
    function enqueue(s, work) {
      s.busy++;const job=s.tail.catch(()=>{}).then(async()=>{try{return await work()}finally{s.busy--;}});
      s.tail=job.catch(()=>{});return job;
    }
    async function write(s, mutate, image) {
      if(['conflict','save_uncertain'].includes(s.error?.code))throw s.error;
      const before=copy(s.data),version=s.version,candidate=normalizeData(mutate?mutate(copy(before)):before);
      if(candidate.records.some(r=>r.profileId!==s.id))throw new Error('不能把其他档案的成绩保存到当前档案。');
      const payload={data:candidate,revision:s.revision},headers={'X-Xunxu-Request':'1'};
      let body;
      if(image){validProfile(image.recordId);if(!candidate.records.some(r=>r.id===image.recordId))throw new Error('截图必须属于本次保存的成绩。');body=new FormData();body.append('payload',JSON.stringify(payload));body.append('imageRecordId',image.recordId);body.append('image',image.blob,image.filename||'race-result.jpg');}
      else {headers['Content-Type']='application/json';body=JSON.stringify(payload);}
      notify(s,'saving');
      try {
        const result=await (await request(path(s.id),{method:'PUT',headers,body})).json();
        const saved=result.profile;if(!saved||saved.id!==s.id||!Number.isInteger(saved.revision))throw new Error('云端保存结果异常，当前修改仍保留。');
        const normalized=normalizeData(saved.data);
        s.data=normalizeData(mergeNewer(normalized,before,s.data));s.revision=saved.revision;s.name=saved.name;s.updatedAt=saved.updatedAt||'';
        s.dirty=s.version!==version&&!equal(s.data,normalized);remember(s);notify(s,s.dirty?'dirty':'saved',null,{persisted:true,saveKind:mutate?'action':'autosave'});
        return {profile:{...metadata(s),data:copy(normalized)}};
      }catch(error){error.source=mutate?'action':'autosave';notify(s,['conflict','save_uncertain'].includes(error.code)?'conflict':error.status===401?'unauthorized':'error',error);throw error;}
    }
    async function session() {
      const result=await (await request('/api/cloud/session')).json();
      if(!result.user||!Array.isArray(result.profiles))throw new Error('无法确认登录身份，请重新登录。');
      user=result.user;registry=result.profiles.map(item=>({...item}));return {user:{...user},profiles:registry.map(item=>({...item}))};
    }
    async function load(id, settings) {
      validProfile(id);const existing=states.get(id);settings=settings||{};
      if(existing){await existing.tail;if(existing.dirty&&!settings.discard)throw new Error('这个档案还有未保存修改，请先保存或明确重新读取云端。');}
      const loadingVersion=existing?.version;
      const result=await (await request(path(id))).json();if(result.profile?.id!==id)throw new Error('云端档案归属不一致。');
      if(existing&&existing.version!==loadingVersion&&!settings.discard)throw new Error('读取期间有新修改，已保留当前草稿，请先保存后重试。');
      const s=accept(result.profile);notify(s,'saved');return {profile:{...metadata(s),data:copy(s.data)}};
    }
    async function create({id,name,data}) {
      validProfile(id);
      const result=await (await request('/api/cloud/profiles',{method:'POST',headers:{'Content-Type':'application/json','X-Xunxu-Request':'1'},body:JSON.stringify({id,name,data:normalizeData(data)})})).json();
      const s=accept(result.profile);notify(s,'saved');return {profile:{...metadata(s),data:copy(s.data)}};
    }
    function stage(id, mutate) {
      const s=state(id),next=normalizeData(mutate(copy(s.data)));
      if(equal(next,s.data))return false;
      s.data=next;s.version++;s.dirty=true;
      if(!s.error)notify(s,s.busy?'saving':'dirty');else notify(s,s.status,s.error);
      return true;
    }
    function flush(id) {
      const s=state(id);
      if(['conflict','save_uncertain'].includes(s.error?.code))return Promise.reject(s.error);
      if(s.flushPromise)return s.flushPromise;
      if(!s.dirty)return s.tail.then(()=>({profile:{...metadata(s),data:copy(s.data)}}));
      const job=enqueue(s,async()=>{let result;while(s.dirty)result=await write(s);return result;});
      s.flushPromise=job.finally(()=>{s.flushPromise=null;});return s.flushPromise;
    }
    function commit(id, mutate, image) {const s=state(id);return enqueue(s,()=>write(s,mutate,image));}
    async function fetchImage(id,recordId,signal) {
      validProfile(recordId);const response=await request(path(id)+'/images/'+encodeURIComponent(recordId),{signal},'image');return response.blob();
    }
    return {session,load,create,stage,flush,commit,fetchImage,
      getData:id=>copy(state(id).data),getProfile:id=>({...metadata(state(id)),data:copy(state(id).data)}),
      profiles:()=>registry.map(item=>({...item})),status:id=>{const s=state(id);return {status:s.status,dirty:s.dirty,error:s.error,retryable:s.dirty&&s.error?.source!=='action',busy:s.busy>0,revision:s.revision};},
      hasUnsaved:()=>[...states.values()].some(s=>s.dirty||s.busy>0),
      isLoaded:id=>states.has(id),blankData};
  }
  function createStore(client) {
    function list(id) {validProfile(id);return client.getData(id).records.filter(r=>r&&r.profileId===id&&typeof r.id==='string');}
    function put(id,record,image) {return client.commit(id,data=>{data.records=nextRecords(id,data.records,record);return data;},image);}
    function remove(id,recordId) {validProfile(recordId);return client.commit(id,data=>{data.records=data.records.filter(r=>r.id!==recordId);return data;});}
    return {list,put,remove};
  }
  const api={createClient,createStore,validProfile,nextRecords,mergeNewer,blankData};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ProfileStore=api;
})(typeof window!=='undefined'?window:globalThis);
