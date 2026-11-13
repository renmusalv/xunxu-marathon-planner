const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const RealProfileStore=require('../src/profile-store.js');
const RunningAssessment=require('../src/assessment.js');
const TargetPlan=require('../src/target-plan.js');
const SessionAdvice=require('../src/session-advice.js');
const clone=v=>JSON.parse(JSON.stringify(v));
const FIXED_NOW=Date.UTC(2026,10,11,12);
const checkinKey=id=>'xunxu-checkins-v1:half-target-v1:2027-02-01:6300'+(id==='default'?'':':profile:'+id);
function makeElement(value=''){
 const attrs=new Map(),classes=new Set();return {value,textContent:'',innerHTML:'',hidden:false,open:false,dataset:{},style:{},disabled:false,
 classList:{add:n=>classes.add(n),remove:n=>classes.delete(n),contains:n=>classes.has(n),toggle(n,force){if(force??!classes.has(n))classes.add(n);else classes.delete(n)}},
 setAttribute:(n,v)=>attrs.set(n,v),getAttribute:n=>attrs.get(n)??null,removeAttribute:n=>attrs.delete(n),addEventListener(){},focus(){},scrollIntoView(){},parentElement:{setAttribute(){}}};
}
function harness(){
 let clockNow=FIXED_NOW;class FixedDate extends Date{constructor(...a){super(...(a.length?a:[clockNow]));}static now(){return clockNow}}
 const documents=new Map(),writes=[],elements=new Map();
 function data(id='default'){if(!documents.has(id))documents.set(id,{form:{},records:[],plans:{},history:[]});return documents.get(id)}
 function element(id){if(!elements.has(id))elements.set(id,makeElement());return elements.get(id)}
 let workoutDates=null;const document={getElementById:element,querySelector(){return null},querySelectorAll(selector){
 if(selector==='#weekList .checkin[data-workout="true"]'){
  if(workoutDates)return workoutDates.map(date=>({dataset:{date},getAttribute:()=> 'false'}));
  return [...element('weekList').innerHTML.matchAll(/<button\b([^>]*)>/g)].filter(m=>/data-workout="true"/.test(m[1])).map(m=>{const a=Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(x=>[x[1],x[2]]));return{dataset:{date:a['data-date']},getAttribute:key=>a[key]??null}});
 }return[];}};
 const client={getData:id=>clone(data(id)),getProfile:id=>({id,name:id,data:clone(data(id)),revision:1}),isLoaded:id=>documents.has(id),
 stage(id,fn){const before=JSON.stringify(data(id)),next=fn(clone(data(id)));if(before===JSON.stringify(next))return false;documents.set(id,clone(next));writes.push(id);return true},
 commit(id,fn){documents.set(id,clone(fn(clone(data(id)))));writes.push(id);return Promise.resolve({profile:this.getProfile(id)})},
 flush(){return Promise.resolve()},hasUnsaved(){return false},status(){return{status:'saved',dirty:false}},profiles(){return [...documents.keys()].map(id=>({id,name:id}))}};
 const ProfileStore={...RealProfileStore,createClient:()=>client};
 const defaults={distance:'21.0975',raceDate:'2027-02-01',halfGoalTime:'01:45:00',paceMin:'5',paceSec:'0',weeklyKm:'28',days:'4',longRun:'12',maxHrSource:'measured',thresholdHrSource:'measured',vo2maxSource:'watch'};
 for(const[id,value]of Object.entries(defaults))element(id).value=value;
 const context=vm.createContext({document,ProfileStore,RunningAssessment,TargetPlan,SessionAdvice,Date:FixedDate,setTimeout:()=>0,clearTimeout(){}});
 const source=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8'),marker='// Boot and explicit UI events.';assert.ok(source.includes(marker));
 vm.runInContext(source.slice(0,source.indexOf(marker))+`
 cloudReady=true;
 globalThis.__appTest={render,savePlanHistory,readAdherence,validatePersonal,saveProfileForm,loadProfileForm,updateCloudStatus,hasUnsavedChanges,personalValues,revealProfileField,applyRecognizedFields,updateRecordHeartSummary,recognitionTimingMessage,applyHealthPatch,healthContext,
 setState(state){if('profileId'in state)activeProfileId=state.profileId;if('checkinKey'in state)activeCheckinKey=state.checkinKey;if('startDate'in state)activePlanStartDate=state.startDate;if('records'in state)currentRecords=state.records;if('draft'in state)recordDraft=state.draft;}};
 `,context,{filename:'src/app.js'});
 element('raceDate').value=defaults.raceDate;
 return{api:context.__appTest,element,data,writes,client,history:id=>data(id).history.at(-1),setWorkouts:dates=>{workoutDates=dates},advanceDays:days=>{clockNow+=days*86400000}};
}
function divBlocks(html, matchesOpeningTag) {
  const result = [], tags = /<\/?div\b[^>]*>/g;
  let tag;
  while ((tag = tags.exec(html))) {
    if (tag[0].startsWith('</') || !matchesOpeningTag(tag[0])) continue;
    const start = tag.index;
    let depth = 1;
    while (depth && (tag = tags.exec(html))) depth += tag[0].startsWith('</') ? -1 : 1;
    assert.equal(depth, 0, 'Generated target/advice markup must have balanced div elements.');
    result.push(html.slice(start, tags.lastIndex));
  }
  return result;
}
const targetBlocks = h => divBlocks(h.element('weekList').innerHTML, tag => /data-target="true"/.test(tag));
const adviceBlocks = h => divBlocks(h.element('weekList').innerHTML, tag => /class="session-advice"/.test(tag));
const record = (overrides = {}) => ({
  id: 'race-result', profileId: 'default', distanceKm: 21.0975,
  elapsedSeconds: 6300, date: '2026-11-01', effort: 'race', confirmed: true,
  include: true, durationType: 'elapsed', course: 'road_flat', source: 'manual',
  ...overrides,
});

function assertGeneratedPlan(h,profileId='default'){
 assert.match(h.element('weekList').innerHTML,/class="week(?:\s|")/);assert.match(h.element('generationStatus').textContent,/已更新/);
 const history=h.history(profileId);assert.ok(history);assert.ok(history.dates.length>0);assert.equal(h.data(profileId).plans[history.planKey].started,history.started);
 return{checkinKey:history.planKey,startDate:history.started,dates:history.dates};
}
function assertNoGeneratedPlan(h){assert.doesNotMatch(h.element('weekList').innerHTML,/class="week(?:\s|")/);assert.equal(h.writes.length,0);}

test('cloud history preserves past dates and updates future dates without write storms',()=>{
 const h=harness(),id='runner-a',key='xunxu-checkins-v1:half-target-v1:2027-02-01:6300:profile:runner-a';
 h.data(id).history=[{planKey:key,started:'2026-11-03',dates:['2026-11-05','2026-11-20']}];h.data(id).plans[key]={started:'2026-11-03',checkins:{'2026-11-05':true}};
 h.api.setState({profileId:id,checkinKey:key,startDate:'2026-11-03'});h.setWorkouts(['2026-11-11','2026-11-12']);h.api.savePlanHistory();
 assert.deepEqual(h.history(id).dates,['2026-11-05','2026-11-11','2026-11-12']);const writes=h.writes.length;h.api.savePlanHistory();assert.equal(h.writes.length,writes);
 assert.equal(h.data(id).plans[key].checkins['2026-11-05'],true);
});
test('adherence reads only the active cloud profile and active plan and counts past dates',()=>{
 const h=harness(),key='plan-a';h.data('a').history=[{planKey:key,started:'2026-11-03',dates:['2026-11-02','2026-11-05','2026-11-05','2026-11-10','2026-11-11']}];h.data('a').plans[key]={started:'2026-11-03',checkins:{'2026-11-05':true,'2026-11-10':'true','2026-11-11':true}};
 h.api.setState({profileId:'a',checkinKey:key});const a=h.api.readAdherence();assert.equal(a.due,2);assert.equal(a.completed,1);
 h.api.setState({profileId:'b',checkinKey:key});assert.equal(h.api.readAdherence(),null);
 h.api.setState({profileId:'a',checkinKey:'different-plan'});assert.equal(h.api.readAdherence(),null);
});
test('cloud form staging captures the active owner and never changes another profile',()=>{
 const h=harness();h.data('b').form={restingHr:'70'};h.api.setState({profileId:'a'});h.element('restingHr').value='52';h.api.saveProfileForm();assert.equal(h.data('a').form.restingHr,'52');assert.equal(h.data('b').form.restingHr,'70');
});
test('failed explicit mutations never show a generic retry-saved path',()=>{
 const h=harness();h.api.updateCloudStatus({status:'error',error:{message:'网络失败',source:'action'},dirty:false,retryable:false});assert.equal(h.element('cloudRetry').hidden,true);assert.match(h.element('cloudState').textContent,/重新执行/);
 h.api.updateCloudStatus({status:'conflict',error:{message:'版本冲突'},dirty:true});assert.equal(h.element('cloudRetry').hidden,true);assert.equal(h.element('cloudReload').hidden,false);
 h.api.updateCloudStatus({status:'unauthorized',error:{message:'登录过期'}});assert.equal(h.element('cloudSignIn').hidden,false);
});
test('a valid target generates and stores a plan without performance evidence', () => {
  const h = harness();
  h.api.render();
  const history = assertGeneratedPlan(h);
  assert.equal(history.checkinKey, checkinKey('default'));
  assert.equal(history.startDate, '2026-11-11');
  assert.match(h.element('notice').innerHTML, /目标课表已生成/);
  assert.equal(h.element('equivalentTime').textContent, '待确认');
  assert.equal(h.element('planDifficultyLabel').textContent, '资料不足');
  assert.ok(adviceBlocks(h).some(block => block.includes('待补充近期成绩')));
});

test('an impossible half-marathon target of ten minutes blocks plan generation', () => {
  const h = harness();
  h.element('halfGoalTime').value = '00:10:00';
  h.api.render();
  assertNoGeneratedPlan(h);
  assert.match(h.element('notice').textContent, /目标配速超出可支持范围/);
});

test('an impossible half-marathon result of ten minutes is not accepted as performance evidence', () => {
  const h = harness();
  h.element('benchmarkDistance').value = '21.0975';
  h.element('benchmarkTime').value = '00:10:00';
  h.element('benchmarkDate').value = '2026-10-18';
  h.api.render();
  assertGeneratedPlan(h);
  assert.equal(h.element('equivalentTime').textContent, '待确认');
  assert.equal(h.element('planDifficultyLabel').textContent, '资料不足');
  assert.match(h.element('evidenceDetails').innerHTML, /距离或用时无效/);
});

test('contradictory personal heart rates warn and suppress bpm advice while preserving the target plan', () => {
  const cases = [
    [{ restingHr: '120', maxHr: '110' }, /最大心率必须高于静息心率/],
    [{ thresholdHr: '181', maxHr: '180' }, /阈值心率应低于个人最大心率/],
    [{ restingHr: '14' }, /静息心率请填写/],
    [{ maxHr: '900' }, /最大心率请填写/],
  ];
  for (const [values, message] of cases) {
    const h = harness();
    for (const [id, value] of Object.entries(values)) h.element(id).value = value;
    h.api.render();
    assertGeneratedPlan(h);
    assert.match(h.element('notice').innerHTML, message);
    assert.match(h.element('hrMethod').textContent, /待核对/);
    assert.ok(adviceBlocks(h).every(block => !/\d+(?:–\d+)? bpm/.test(block)));
  }
});

test('editing results, weekly distance, longest run and available days changes no target blocks or goal key', () => {
  const h = harness();
  h.api.setState({ records: [record({ elapsedSeconds: 6000 })] });
  h.element('weeklyKm').value = '50';
  h.element('longRun').value = '20';
  h.api.render();
  const original = targetBlocks(h), history = assertGeneratedPlan(h);
  const cases = [
    () => h.api.setState({ records: [record({ elapsedSeconds: 7800 })] }),
    () => { h.element('weeklyKm').value = '5'; },
    () => { h.element('longRun').value = '3'; },
    () => { h.element('days').value = '3'; },
    () => { h.element('restingHr').value = '50'; h.element('maxHr').value = '190'; },
  ];
  for (const edit of cases) {
    edit(); h.api.render();
    assert.deepEqual(targetBlocks(h), original);
    const changed = assertGeneratedPlan(h);
    assert.equal(changed.checkinKey, history.checkinKey);
    assert.equal(changed.startDate, history.startDate);
    assert.deepEqual(changed.dates, history.dates);
  }
});

test('changing the target shifts the main paces and creates its own check-in key', () => {
  const h = harness();
  h.api.setState({ records: [record()] });
  h.api.render();
  const original = targetBlocks(h), oldKey = assertGeneratedPlan(h).checkinKey;
  assert.match(original.join(' '), /4:50–4:55\/km/);
  h.element('halfGoalTime').value = '02:00:00';
  h.api.render();
  const changed = targetBlocks(h), changedHistory = assertGeneratedPlan(h);
  assert.notDeepEqual(changed, original);
  assert.equal(changed.length, original.length);
  assert.match(changed.join(' '), /5:33–5:38\/km/);
  assert.notEqual(changedHistory.checkinKey, oldKey);
  assert.match(changedHistory.checkinKey, /:7200$/);
  assert.equal(h.element('finishTime').textContent, '2:00:00');
  assert.equal(h.element('equivalentTime').textContent, '1:45:00');
});

test('weaker capability changes actual difficulty and personal pace advice without rewriting the target', () => {
  const h = harness();
  h.element('weeklyKm').value = '55'; h.element('longRun').value = '20';
  h.api.setState({ records: [record({ elapsedSeconds: 5700 })] });
  h.api.render();
  const original = targetBlocks(h), strongAdvice = adviceBlocks(h), strongLevel = h.element('planDifficultyLabel').dataset.level;
  h.api.setState({ records: [record({ elapsedSeconds: 7800 })] });
  h.element('weeklyKm').value = '12'; h.element('longRun').value = '6';
  h.api.render();
  assert.deepEqual(targetBlocks(h), original);
  assert.notDeepEqual(adviceBlocks(h), strongAdvice);
  assert.notEqual(h.element('planDifficultyLabel').dataset.level, strongLevel);
  assert.equal(h.element('planDifficultyLabel').textContent, '难度较高');
  assert.match(adviceBlocks(h).join(' '), /当前能力建议/);
  assert.match(adviceBlocks(h).join(' '), /目标主段比当前能力建议|高于近 30 天最长跑/);
  assert.equal(h.element('equivalentTime').textContent, '2:10:00');
});

test('switching cloud profiles loads only their own data and preserves identical target prescriptions',()=>{
  const h=harness(),a='runner-a',b='runner-b',form={raceDate:'2027-02-01',halfGoalTime:'01:45:00',weeklyKm:'45',longRun:'18',days:'4'};
  h.data(a).form={...form,restingHr:'50',maxHr:'190'};h.data(b).form={...form,restingHr:'65',maxHr:'180'};
  h.data(a).records=[record({id:'a-result',profileId:a,elapsedSeconds:6000})];h.data(b).records=[record({id:'b-result',profileId:b,elapsedSeconds:7800,date:'2026-10-15'})];
  h.api.loadProfileForm(a);h.api.render();const targets=targetBlocks(h),advice=adviceBlocks(h),historyA=assertGeneratedPlan(h,a),before=JSON.stringify(h.data(a));
  h.api.loadProfileForm(b);h.api.render();assert.notEqual(assertGeneratedPlan(h,b).checkinKey,historyA.checkinKey);assert.equal(h.element('restingHr').value,'65');assert.equal(h.element('equivalentTime').textContent,'2:10:00');
  assert.deepEqual(targetBlocks(h),targets);assert.notDeepEqual(adviceBlocks(h),advice);assert.equal(JSON.stringify(h.data(a)),before);
  h.api.loadProfileForm(a);h.api.render();assert.equal(h.element('restingHr').value,'50');assert.equal(h.element('equivalentTime').textContent,'1:40:00');assert.deepEqual(adviceBlocks(h),advice);
});

test('145 fourth-week 10K tempo and three 2K repetitions survive weak capability rendering', () => {
  const h = harness();
  h.api.setState({ records: [record({ elapsedSeconds: 7800 })] });
  h.element('weeklyKm').value = '5'; h.element('longRun').value = '3'; h.element('days').value = '3';
  h.api.render();
  const days = divBlocks(h.element('weekList').innerHTML, tag => /data-template-week=/.test(tag));
  const week4Quality = days.find(block => /class="day quality/.test(block) && /data-template-week="4"/.test(block));
  const week4Target = divBlocks(week4Quality, tag => /data-target="true"/.test(tag))[0];
  assert.match(week4Target, /连续 10 km/);
  assert.match(week4Target, /4:50–4:55\/km/);
  for (const number of [2, 5]) {
    const cell = days.find(block => /class="day quality/.test(block) && block.includes('data-template-week="' + number + '"'));
    const target = divBlocks(cell, tag => /data-target="true"/.test(tag))[0];
    assert.match(target, /2 km × 3/);
    assert.match(target, /4:45–4:50\/km/);
    assert.match(target, /组间 1 km × 2 @ 5:40\/km/);
    assert.doesNotMatch(target, /2 km×2|轻松渐进跑/);
  }
});

test('regeneration on a later day retains the original plan start and all target prescriptions', () => {
  const h = harness();
  h.api.render();
  const original = targetBlocks(h), firstHistory = assertGeneratedPlan(h);
  h.advanceDays(10);
  h.api.setState({ records: [record({ date: '2026-11-19', elapsedSeconds: 7000 })] });
  h.api.render();
  const laterHistory = assertGeneratedPlan(h);
  assert.equal(laterHistory.startDate, '2026-11-11');
  assert.equal(laterHistory.checkinKey, firstHistory.checkinKey);
  assert.deepEqual(targetBlocks(h), original);
  assert.deepEqual(laterHistory.dates, firstHistory.dates);
});

function renderFullMarathon(raceDate) {
  const h = harness();
  const settings = { distance: '42.195', paceMin: '5', paceSec: '30', weeklyKm: '40', longRun: '20', raceDate };
  for (const [id, value] of Object.entries(settings)) h.element(id).value = value;
  h.api.render();
  return h;
}

test('the legacy full-marathon branch removes all training after a Monday race', () => {
  const h = renderFullMarathon('2027-02-01');
  const html = h.element('weekList').innerHTML;
  const raceCells = divBlocks(html, tag => /class="day race(?: |")/.test(tag));
  assert.equal(raceCells.length, 1);
  assert.match(raceCells[0], /data-date="2027-02-01"/);
  const workoutDates = [...html.matchAll(/data-date="([^"]+)" data-workout="true"/g)].map(match => match[1]);
  assert.ok(workoutDates.length > 0);
  assert.ok(workoutDates.every(date => date <= '2027-02-01'));
  assert.ok(h.history('default').dates.every(date => date <= '2027-02-01'));
});

test('full-marathon limits prevent a truncated wrong race date while half-marathon keeps its 24-week horizon', () => {
  const fullBoundary = renderFullMarathon('2027-04-20'); // 160 days after the fixed current date.
  const raceCells = divBlocks(fullBoundary.element('weekList').innerHTML, tag => /class="day race(?: |")/.test(tag));
  assert.equal(raceCells.length, 1);
  assert.match(raceCells[0], /data-date="2027-04-20"/);
  const fullTooFar = renderFullMarathon('2027-04-27'); // Previously silently scheduled the race seven days early.
  assertNoGeneratedPlan(fullTooFar);
  assert.match(fullTooFar.element('notice').textContent, /全马.*160 天/);
  const halfBoundary = harness();
  halfBoundary.element('raceDate').value = '2027-04-27';
  halfBoundary.api.render();
  assertGeneratedPlan(halfBoundary);
  const halfRace = divBlocks(halfBoundary.element('weekList').innerHTML, tag => /class="day race(?: |")/.test(tag));
  assert.equal(halfRace.length, 1);
  assert.match(halfRace[0], /data-date="2027-04-27"/);
});

test('leaving a pending or unsaved record warns, while viewing an unchanged record does not',()=>{
 const h=harness();assert.equal(h.api.hasUnsavedChanges(),false);h.api.setState({draft:{dirty:false,saving:false}});assert.equal(h.api.hasUnsavedChanges(),false);h.api.setState({draft:{dirty:true,saving:false}});assert.equal(h.api.hasUnsavedChanges(),true);h.api.setState({draft:{dirty:false,saving:true}});assert.equal(h.api.hasUnsavedChanges(),true);
});


test('simplifying the form preserves retired personal fields and legacy results in their own profile',()=>{
  const h=harness();
  h.data('old').form={age:'37',experienceMonths:'81',benchmarkDistance:'10',benchmarkTime:'00:49:30',benchmarkDate:'2026-10-10',restingHr:'52',weeklyKm:'42',longRun:'18',days:'4'};
  h.api.loadProfileForm('old');assert.equal(h.element('legacyEntry').hidden,false);
  assert.equal(h.element('weeklyKm').value,'42');assert.equal(h.element('heartDetails').open,false);
  h.element('weeklyKm').value='44';h.api.saveProfileForm();
  assert.equal(h.data('old').form.age,'37');assert.equal(h.data('old').form.experienceMonths,'81');
  assert.equal(h.data('old').form.benchmarkTime,'00:49:30');assert.equal(h.data('old').form.restingHr,'52');
  assert.equal(h.api.personalValues().age,undefined);assert.equal(h.api.personalValues().experienceMonths,undefined);
  h.api.render();assert.doesNotMatch(h.element('physiologyDetails').innerHTML,/年龄|持续跑龄/);
  assert.notEqual(h.element('equivalentTime').textContent,'待确认');
  h.api.loadProfileForm('new');assert.equal(h.element('legacyEntry').hidden,true);assert.equal(h.element('benchmarkTime').value,'');
  h.api.saveProfileForm();assert.equal(h.data('new').form.age,undefined);assert.equal(h.data('old').form.weeklyKm,'44');
});

test('blank training basis preserves the target plan but never treats samples as user evidence',()=>{
  const h=harness();h.api.setState({records:[record()]});
  for(const id of ['weeklyKm','longRun','days'])h.element(id).value='';
  h.api.render();assertGeneratedPlan(h);const before=targetBlocks(h);
  assert.equal(h.element('fitScore').textContent,'—');assert.equal(h.element('planDifficultyLabel').dataset.level,'unknown');
  assert.match(h.element('dataGaps').innerHTML,/平均周跑量|最长跑|跑步天数/);
  for(const[id,value]of Object.entries({weeklyKm:'42',longRun:'18',days:'4',recentConsistency:'stable',discomfort:'none'}))h.element(id).value=value;
  h.api.render();assert.notEqual(h.element('fitScore').textContent,'—');assert.deepEqual(targetBlocks(h),before);
});

test('optional personal sections preserve values and reveal the right section for a correction',()=>{
  const h=harness();h.data('runner').form={maxHr:'187',restingHr:'51',vo2max:'49',vo2maxSource:'watch',vo2maxDate:'2026-11-01'};
  h.api.loadProfileForm('runner');assert.equal(h.element('heartDetails').open,false);assert.equal(h.element('vo2Details').open,false);
  assert.equal(h.element('heartDetailsCount').textContent,'已填 2 项');assert.equal(h.element('vo2DetailsCount').textContent,'已填写');
  h.api.revealProfileField('thresholdHr');assert.equal(h.element('panel-personal').hidden,false);assert.equal(h.element('heartDetails').open,true);
  h.api.revealProfileField('vo2maxDate');assert.equal(h.element('vo2Details').open,true);
  h.api.saveProfileForm();assert.equal(h.data('runner').form.maxHr,'187');assert.equal(h.data('runner').form.vo2max,'49');
});

test('recognized average and peak heart rate fill the review without changing personal maximum',()=>{
  const h=harness();h.element('maxHr').value='190';h.element('restingHr').value='53';
  const fields=h.api.applyRecognizedFields({distanceKm:10,elapsedSeconds:3000,date:'2026-11-01',averageHr:154,peakHr:179,paceSeconds:300});
  assert.equal(h.element('recordAverageHr').value,154);assert.equal(h.element('recordPeakHr').value,179);
  assert.equal(h.element('recordTime').value,'00:50:00');assert.equal(h.element('recordDistance').value,'10');
  assert.equal(h.element('recordHeartDetails').open,true);assert.match(h.element('recordHeartSummary').textContent,/平均 154.*最高 179/);
  assert.match(h.element('recognitionFields').textContent,/平均心率、本次最高心率/);assert.equal(fields.length,5);
  assert.equal(h.element('maxHr').value,'190');assert.equal(h.element('restingHr').value,'53');
  h.element('recordPeakHr').value='181';h.api.updateRecordHeartSummary();assert.match(h.element('recordHeartSummary').textContent,/最高 181/);
});

test('1:50 UI describes its own reference and interpolated targets describe the inference',()=>{
  const h=harness();h.element('halfGoalTime').value='01:50:00';h.api.render();assertGeneratedPlan(h);
  assert.match(h.element('templateTitle').textContent,/1:50:00.*参考图/);assert.match(h.element('templateCopy').textContent,/1:50/);
  assert.match(targetBlocks(h).join(' '),/6:10–6:40\/km/);assert.match(targetBlocks(h).join(' '),/5:05–5:10\/km/);
  h.element('halfGoalTime').value='01:47:30';h.api.render();assert.match(h.element('templateTitle').textContent,/逐课插值/);assert.match(h.element('templateCopy').textContent,/插值/);
});

test('new page does not prefill training history or require unused demographic fields',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  for(const id of ['weeklyKm','longRun']){const tag=html.match(new RegExp('<input[^>]*id="'+id+'"[^>]*>'))?.[0];assert.ok(tag);assert.doesNotMatch(tag,/\bvalue=/);}
  assert.match(html,/<select id="days"><option value="" selected>/);
  assert.doesNotMatch(html,/<input[^>]*id="(?:age|experienceMonths)"/);
  assert.match(html,/<details class="personal-details" id="heartDetails">/);assert.match(html,/<details class="personal-details" id="vo2Details">/);
});

test('full-marathon planning cannot silently assume a running frequency after empty defaults',()=>{
  const h=harness();h.element('distance').value='42.195';h.element('days').value='';h.api.render();
  assertNoGeneratedPlan(h);assert.match(h.element('notice').textContent,/选择每周 3、4 或 5 天/);
});


test('explicit elapsed metadata prefills timing while leaving effort and course for the user',()=>{
  const h=harness();h.element('recordEffort').value='';h.element('recordCourse').value='unknown';
  const filled=h.api.applyRecognizedFields({elapsedSeconds:3000},'elapsed');
  assert.equal(h.element('recordDurationType').value,'elapsed');assert.ok(filled.includes('计时类型'));
  assert.match(h.element('recognitionFields').textContent,/计时类型/);
  assert.match(h.api.recognitionTimingMessage(h.element('recordDurationType').value),/已识别为完整计时.*请核对.*比赛 \/ 测试 \/ 日常训练/);
  assert.equal(h.element('recordEffort').value,'');assert.equal(h.element('recordCourse').value,'unknown');
});

test('moving-time metadata prefills its actual type and explicitly stays archive-only',()=>{
  const h=harness();h.api.applyRecognizedFields({elapsedSeconds:2910},'moving');
  assert.equal(h.element('recordDurationType').value,'moving');assert.equal(h.element('recordTime').value,'00:48:30');
  assert.match(h.api.recognitionTimingMessage(h.element('recordDurationType').value),/移动时间，仅留档，不用于推算比赛能力/);
});

test('absent or unsupported timing metadata resets to unknown and asks for confirmation',()=>{
  for(const value of [undefined,null,'unknown','','elapsed_time',{},true]){
    const h=harness();h.element('recordDurationType').value='elapsed';
    const filled=h.api.applyRecognizedFields({elapsedSeconds:3000},value);
    assert.equal(h.element('recordDurationType').value,'unknown');assert.equal(filled.includes('计时类型'),false);
    assert.match(h.api.recognitionTimingMessage(h.element('recordDurationType').value),/请确认这是完整计时还是移动时间/);
  }
});


test('reviewed health summary updates only its profile and preserves goal course paces',async()=>{
 const h=harness();h.api.render();const before=targetBlocks(h);
 h.data('other').form={weeklyKm:'61',restingHr:'67'};
 await h.api.applyHealthPatch({weeklyKm:'33.5',longRun:'16',days:'2',restingHr:'52',vo2max:'48',vo2maxSource:'unknown',vo2maxDate:'2026-11-01'},h.api.healthContext());
 assert.equal(h.data('default').form.weeklyKm,'33.5');assert.equal(h.element('weeklyKm').value,'33.5');
 assert.equal(h.data('default').form.days,'2');assert.equal(h.element('vo2maxSource').value,'unknown');
 assert.equal(h.data('other').form.weeklyKm,'61');assert.equal(h.data('other').form.restingHr,'67');
 assert.equal(h.data('default').form.halfGoalTime,'01:45:00');assert.deepEqual(targetBlocks(h),before);
 assert.equal(h.element('maxHr').value,'');assert.equal(h.element('recentConsistency').value,'');
 assert.match(h.element('riskFactors').innerHTML,/2 天\/周/);
 assert.equal(h.element('fitScore').textContent,'—','training totals alone cannot create a race ability score');
});

test('health summary cannot write after its target profile has changed',async()=>{
 const h=harness(),context=h.api.healthContext();h.api.setState({profileId:'other'});
 await assert.rejects(h.api.applyHealthPatch({weeklyKm:'37'},context),/档案已变化/);
 assert.equal(h.writes.length,0);assert.equal(h.data('other').form.weeklyKm,undefined);
});

test('an acknowledged old-profile health save cannot overwrite the new profile form',async()=>{
 const h=harness();let release;const commit=h.client.commit.bind(h.client);
 h.client.commit=(...args)=>new Promise(resolve=>{release=()=>commit(...args).then(resolve)});
 const pending=h.api.applyHealthPatch({weeklyKm:'37'},h.api.healthContext());
 h.api.setState({profileId:'other'});h.data('other').form.weeklyKm='61';h.element('weeklyKm').value='61';release();await pending;
 assert.equal(h.data('default').form.weeklyKm,'37');assert.equal(h.data('other').form.weeklyKm,'61');assert.equal(h.element('weeklyKm').value,'61');
});
