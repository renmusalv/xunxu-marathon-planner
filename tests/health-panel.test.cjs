const test = require('node:test');
const assert = require('node:assert/strict');
const {buildFormPatch, create} = require('../src/health-panel.js');

function fixture() {
  return {
    source: 'apple_health', analyzedOn: '2026-11-13',
    window: {start:'2026-10-16',end:'2026-11-12',days:28},
    summary: {weeklyKm:34.5,longestRunKm:16.2,runDaysPerWeek:3.5,workoutCount:16,runningDays:14},
    personal: {
      restingHr:{value:53,date:'2026-11-12',unit:'bpm',source:'Watch',stale:false},
      vo2max:{value:47.6,date:'2026-11-11',unit:'ml/kg/min',source:'Health import',stale:false}
    },
    candidates:[{date:'2026-11-01',distanceKm:10.08,standardDistanceKm:10,elapsedSeconds:3200,activeSeconds:3100,effort:'unknown',durationType:'unknown',confirmed:false,include:false,sourceName:'Watch'}],
    warnings:['记录完整性仍需核对。'], limitations:['日常训练不作为比赛能力成绩。']
  };
}
function deferred() { let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}; }
function harness(options={}) {
  const nodes=new Map(), calls=[], applied=[], after=[], statuses=[];
  let context={key:'account-a|profile-a',ready:true,profileName:'A 档案',mode:'guest',today:'2026-11-13',form:{}};
  const doc={activeElement:null};
  class Element {
    constructor(id){this.id=id;this.ownerDocument=doc;this.hidden=false;this.disabled=false;this.checked=false;this.value='';this.textContent='';this.open=false;this.dataset={};this.listeners=new Map();this._html='';nodes.set(id,this);}
    addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
    removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
    async emit(type,event={}){for(const fn of this.listeners.get(type)||[])await fn({target:this,preventDefault(){},...event});}
    focus(){doc.activeElement=this;}
    click(){return this.emit('click');}
    showModal(){this.open=true;}
    close(){this.open=false;}
    querySelector(selector){return nodes.get(selector.slice(1));}
    querySelectorAll(selector){return selector==='[data-health-field]:checked'?[...nodes.values()].filter(node=>node.dataset.healthField&&node.checked):[];}
    set innerHTML(value){this._html=value;if(this.id==='healthFieldChoices'){for(const [id,node]of nodes)if(node.dataset.healthField)nodes.delete(id);for(const match of value.matchAll(/<input\b([^>]*)>/g)){const name=match[1].match(/data-health-field="([^"]+)"/);if(!name)continue;const input=new Element('choice-'+name[1]);input.dataset.healthField=name[1];input.checked=/\bchecked\b/.test(match[1]);input.disabled=/\bdisabled\b/.test(match[1]);}}}
    get innerHTML(){return this._html;}
  }
  const dialog=new Element('healthDialog');
  for(const id of ['healthError','healthFile','healthReview','healthReadProgress','healthReviewPeriod','healthFileSummary','healthStatDistance','healthStatDays','healthStatLong','healthFieldChoices','healthCoverage','healthRunDays','healthRunDaysHint','healthCandidates','healthWarnings','healthApplyButton','healthDataDestination','healthStatus','healthOwner','healthChooseFile','healthReviewHeading','closeHealthDialog'])new Element(id);
  const engine={readFile(file,args){calls.push({file,...args});return options.readFile?options.readFile(file,args):Promise.resolve(fixture());}};
  const panel=create({dialog,engine,getContext:()=>context,onApply:async(patch,owner)=>{applied.push({patch,owner});return options.onApply?options.onApply(patch,owner):undefined;},onApplied:owner=>after.push(owner),onStatus:()=>statuses.push(true),onReviewCandidate:options.onReviewCandidate});
  const $=id=>nodes.get(id);
  function select(fields){for(const node of nodes.values())if(node.dataset.healthField)node.checked=fields.includes(node.dataset.healthField);}
  async function read(file={name:'export.xml'}){return $('healthFile').emit('change',{target:{files:[file]}});}
  return{panel,dialog,nodes,$,calls,applied,after,statuses,select,read,doc,setContext(value){context={...context,...value};},context:()=>context};
}

test('only selected health fields enter the form; unrelated physiology and health status are never inferred',()=>{
  const report=fixture();report.personal.maxHr={value:188};report.personal.thresholdHr={value:170};report.summary.recentConsistency='stable';report.personal.discomfort='none';
  assert.deepEqual(buildFormPatch(report,{fields:['longRun','restingHr']}),{longRun:'16.2',restingHr:'53'});
  assert.deepEqual(buildFormPatch(report,{fields:['weeklyKm'],completeCoverage:true}),{weeklyKm:'34.5'});
  assert.throws(()=>buildFormPatch(report,{fields:['maxHr']}),/不支持/);
  assert.throws(()=>buildFormPatch(report,{fields:['recentConsistency']}),/不支持/);
  assert.throws(()=>buildFormPatch(report,{fields:['discomfort']}),/不支持/);
  assert.throws(()=>buildFormPatch(report,{fields:[]}),/至少选择/);
});

test('weekly volume and frequency require explicit coverage review; physiology alone does not',()=>{
  const report=fixture();
  assert.throws(()=>buildFormPatch(report,{fields:['weeklyKm']}),/记录完整/);
  assert.throws(()=>buildFormPatch(report,{fields:['restingHr'],runDays:'3'}),/记录完整/);
  assert.deepEqual(buildFormPatch(report,{fields:['restingHr']}),{restingHr:'53'});
  assert.deepEqual(buildFormPatch(report,{fields:[],completeCoverage:true,runDays:'6'}),{days:'6'});
});

test('fractional observed running frequency is never rounded or copied without a reviewed integer',()=>{
  const report=fixture();
  assert.deepEqual(buildFormPatch(report,{fields:['longRun']}),{longRun:'16.2'});
  assert.throws(()=>buildFormPatch(report,{fields:['longRun'],completeCoverage:true,runDays:'3.5'}),/天数/);
  for(const invalid of ['0','8','03','3.0'])assert.throws(()=>buildFormPatch(report,{fields:[],completeCoverage:true,runDays:invalid}),/天数/);
  assert.deepEqual(buildFormPatch(report,{fields:[],completeCoverage:true,runDays:'2'}),{days:'2'});
});

test('missing, blank, non-numeric and out-of-range metrics do not become zero or get clamped',()=>{
  for(const value of [null,undefined,'','  ',false,true,[],{},NaN,Infinity,-1,160.1]){
    const report=fixture();report.summary.weeklyKm=value;
    assert.throws(()=>buildFormPatch(report,{fields:['weeklyKm'],completeCoverage:true}),/缺失|范围/,'value '+String(value));
  }
  const report=fixture();report.summary.weeklyKm=0;
  assert.deepEqual(buildFormPatch(report,{fields:['weeklyKm'],completeCoverage:true}),{weeklyKm:'0'});
  report.summary.weeklyKm='34.5';assert.deepEqual(buildFormPatch(report,{fields:['weeklyKm'],completeCoverage:true}),{weeklyKm:'34.5'});
  report.personal.restingHr.value=29;assert.throws(()=>buildFormPatch(report,{fields:['restingHr']}),/范围/);
  report.summary.longestRunKm=42.2;assert.throws(()=>buildFormPatch(report,{fields:['longRun']}),/范围/);
});

test('VO2 imports preserve the date but do not assume a watch or laboratory source',()=>{
  const report=fixture();report.personal.vo2max.source='Laboratory data imported through another app';
  assert.deepEqual(buildFormPatch(report,{fields:['vo2max']}),{vo2max:'47.6',vo2maxSource:'unknown',vo2maxDate:'2026-11-11'});
  assert.equal(buildFormPatch(report,{fields:['restingHr']}).vo2maxSource,undefined);
});

test('VO2 dates must be real past calendar dates relative to the reviewed report',()=>{
  for(const date of ['',null,'2026/11/11','2026-02-30','2026-13-01','2026-11-14']){
    const report=fixture();report.personal.vo2max.date=date;
    assert.throws(()=>buildFormPatch(report,{fields:['vo2max']}),/日期/,'date '+date);
  }
  const report=fixture();report.personal.vo2max.date='2024-02-29';
  assert.equal(buildFormPatch(report,{fields:['vo2max']}).vo2maxDate,'2024-02-29');
});

test('invalid report types cannot produce a form patch',()=>{
  for(const report of [null,{}, {source:'other',summary:{},personal:{}},{source:'apple_health',summary:{}}])assert.throws(()=>buildFormPatch(report,{fields:['weeklyKm']}),/有效/);
});

test('reading shows a review before applying, keeps fractional frequency blank, and submits the original owner',async()=>{
  const h=harness();h.panel.open();await h.read();
  assert.equal(h.applied.length,0);
  assert.equal(h.$('healthReview').hidden,false);
  assert.equal(h.$('healthRunDays').value,'');
  assert.match(h.$('healthDataDestination').textContent,/试用档案/);
  h.select(['weeklyKm','restingHr']);h.$('healthCoverage').checked=true;
  await h.$('healthApplyButton').emit('click');
  assert.deepEqual(h.applied[0].patch,{weeklyKm:'34.5',restingHr:'53'});
  assert.equal(h.applied[0].owner.key,'account-a|profile-a');
  assert.equal(h.after.length,1);assert.equal(h.dialog.open,false);
  assert.match(h.panel.status('account-a|profile-a'),/已应用/);
  assert.match(h.panel.status('account-b|profile-b'),/导入 Apple/);
});

test('reset aborts an in-flight read; late resolution or progress cannot appear in a new owner dialog',async()=>{
  const pending=deferred();const h=harness({readFile:()=>pending.promise});
  h.panel.open();const reading=h.read();
  assert.equal(h.calls.length,1);assert.equal(h.$('healthChooseFile').disabled,true);
  h.panel.reset({clearReports:true});assert.equal(h.calls[0].signal.aborted,true);
  h.setContext({key:'account-b|profile-b',profileName:'B 档案'});h.panel.open();
  const status=h.$('healthStatus').textContent;
  h.calls[0].onProgress(0.9);assert.equal(h.$('healthStatus').textContent,status);
  pending.resolve(fixture());await reading;
  assert.equal(h.$('healthReview').hidden,true);assert.equal(h.$('healthOwner').textContent,'B 档案');
  assert.equal(h.applied.length,0);assert.match(h.panel.status('account-a|profile-a'),/导入 Apple/);
});

test('owner changes without reset still prevent stale read results and errors from rendering',async()=>{
  const pending=deferred();const h=harness({readFile:()=>pending.promise});
  h.panel.open();const reading=h.read();
  h.setContext({key:'account-b|profile-b'});pending.reject(new Error('private failure from A'));await reading;
  assert.equal(h.$('healthError').textContent,'');assert.equal(h.applied.length,0);
  assert.match(h.panel.status('account-b|profile-b'),/导入 Apple/);
});

test('same-owner read errors restore controls and leave the report unapplied',async()=>{
  const h=harness({readFile:async()=>{throw new Error('文件校验失败');}});
  h.panel.open();await h.read();
  assert.equal(h.$('healthError').hidden,false);assert.match(h.$('healthError').textContent,/校验失败/);
  assert.equal(h.$('healthChooseFile').disabled,false);assert.equal(h.$('healthReadProgress').hidden,true);
  assert.equal(h.$('healthReview').hidden,true);assert.equal(h.applied.length,0);
});

test('late apply success cannot close a new profile dialog or invoke its completion navigation',async()=>{
  const pending=deferred();const h=harness({onApply:()=>pending.promise});
  h.panel.open();await h.read();h.select(['restingHr']);const applying=h.$('healthApplyButton').emit('click');
  assert.equal(h.applied[0].owner.key,'account-a|profile-a');
  h.panel.reset({clearReports:true});h.setContext({key:'account-b|profile-b',profileName:'B 档案'});h.panel.open();
  pending.resolve();await applying;
  assert.equal(h.dialog.open,true);assert.equal(h.$('healthOwner').textContent,'B 档案');
  assert.equal(h.after.length,0);assert.equal(h.statuses.length,0);
  assert.match(h.panel.status('account-a|profile-a'),/导入 Apple/);
});

test('late apply rejection cannot leak errors or unlock another profile in-progress read',async()=>{
  const applyingA=deferred(),readingB=deferred();let reads=0;
  const h=harness({onApply:()=>applyingA.promise,readFile:()=>++reads===1?Promise.resolve(fixture()):readingB.promise});
  h.panel.open();await h.read();h.select(['restingHr']);const applying=h.$('healthApplyButton').emit('click');
  h.panel.reset({clearReports:true});h.setContext({key:'account-b|profile-b',profileName:'B 档案'});h.panel.open();const reading=h.read();
  applyingA.reject(new Error('A account private failure'));await applying;
  assert.equal(h.$('healthError').hidden,true);assert.equal(h.$('healthError').textContent,'');
  assert.equal(h.$('healthChooseFile').disabled,true,'old finally must not clear current busy state');
  assert.equal(h.$('healthReadProgress').hidden,false);
  readingB.resolve(fixture());await reading;
  assert.equal(h.$('healthReview').hidden,false);assert.equal(h.$('healthOwner').textContent,'B 档案');
});

test('imported strings are escaped, stale physiology stays unselected, and explicit clear removes reports',async()=>{
  const report=fixture();report.personal.restingHr.stale=true;report.personal.restingHr.source='<img src=x onerror=alert(1)>';report.personal.vo2max.stale=true;report.warnings=['<script>steal()</script>'];
  const h=harness({readFile:async()=>report});h.panel.open();await h.read();
  assert.equal(h.$('choice-restingHr').checked,false);assert.equal(h.$('choice-vo2max').checked,false);
  assert.match(h.$('healthFieldChoices').innerHTML,/&lt;img/);assert.doesNotMatch(h.$('healthWarnings').innerHTML,/<script>/);
  assert.match(h.panel.status('account-a|profile-a'),/等待核对/);
  h.panel.reset({clearReports:true});assert.match(h.panel.status('account-a|profile-a'),/导入 Apple/);
});

test('destroy cancels pending work and removes all event handlers',async()=>{
  const pending=deferred();const h=harness({readFile:()=>pending.promise});h.panel.open();const reading=h.read();
  h.panel.destroy();assert.equal(h.calls[0].signal.aborted,true);pending.resolve(fixture());await reading;
  assert.equal(h.dialog.open,false);assert.equal(h.applied.length,0);
  for(const node of h.nodes.values())assert.ok([...node.listeners.values()].every(set=>set.size===0));
  h.panel.open();assert.equal(h.dialog.open,false);
});
