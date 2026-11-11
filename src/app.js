const $ = id => document.getElementById(id);
    const weekdays = ['周一','周二','周三','周四','周五','周六','周日'];
    let activeCheckinKey='',activePlanStartDate='',checkins={},profiles=[],activeProfileId='default';
    const personalFieldIds=['age','restingHr','maxHr','maxHrSource','thresholdHr','thresholdHrSource','vo2max','vo2maxSource','vo2maxDate','experienceMonths','recentConsistency','discomfort'];
    const profileFieldIds=['distance','raceDate','halfGoalTime','paceMin','paceSec','weeklyKm','days','longRun','benchmarkDistance','benchmarkTime','benchmarkDate',...personalFieldIds];
    let currentRecords=[],recordDraft=null,recordJob=0,focusValidation=false,lastAssessment=null,lastAssessmentInput=null,toastTimer,formUpdateTimer;
    let cloudReady=false,cloudBooting=false,cloudSaveTimer,profileSwitching=false;
    function makeCloudClient(userId){const provider=typeof XunxuCloud==='undefined'?null:XunxuCloud,epoch=typeof accountEpoch==='undefined'?0:accountEpoch;return ProfileStore.createClient({fetch:userId&&provider?.createFetch?provider.createFetch(userId):provider?.fetch,onStatus:info=>{if(userId&&(userId!==currentUserId||epoch!==accountEpoch))return;updateCloudStatus(info)}})}
    let savedGuestClient=null,currentUserId=null,authBusy=false,importBusy=false,authActivationPromise=null,activationUserId=null,accountEpoch=0,authChangePending=false;
    let cloud=makeCloudClient(),recordsStore=ProfileStore.createStore(cloud),storageMode='cloud';
    let otpEmail='',otpResendAt=0,otpTimer=null;
    const trialImports=new Map();
    function providerUser(){return typeof XunxuCloud==='undefined'?null:XunxuCloud.getUser()}
    function cloudConfigured(){return typeof XunxuCloud!=='undefined'&&XunxuCloud.isConfigured()}
    function emailEnabled(){return cloudConfigured()&&XunxuCloud.isEmailLoginEnabled()}
    function savedMessage(cloudText,guestText){return storageMode==='cloud'?cloudText:guestText}

    const defaultDate = new Date(); defaultDate.setDate(defaultDate.getDate()+111); $('raceDate').value = dateKey(defaultDate);
    function paceSeconds(){return Math.max(180,Number($('paceMin').value||0)*60+Number($('paceSec').value||0))}
    function clock(sec){const total=Math.round(sec),h=Math.floor(total/3600),m=Math.floor(total%3600/60),s=total%60;return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`}
    function durationLabel(d){return `${d.getMonth()+1}/${d.getDate()}`}
    function dateKey(d){return `${String(d.getFullYear()).padStart(4,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
    function checkinStorageKey(values){const key=`xunxu-checkins-v1:${values.join(':')}`;return activeProfileId==='default'?key:`${key}:profile:${activeProfileId}`}
    function captureProfileForm(){return Object.fromEntries(profileFieldIds.map(id=>[id,$(id).value]))}
    const defaultProfileForm=captureProfileForm();
    function renderProfileOptions(){const select=$('profileSelect');select.replaceChildren();profiles.forEach(profile=>{const option=document.createElement('option');option.value=profile.id;option.textContent=profile.name;select.appendChild(option)});select.value=activeProfileId}
    function queueCloudSave(owner){
      clearTimeout(cloudSaveTimer);const client=cloud,epoch=accountEpoch;
      cloudSaveTimer=setTimeout(()=>{if(epoch===accountEpoch)client.flush(owner).catch(()=>{});},700);
    }
    function saveProfileForm(){
      if(!cloudReady)return false;
      const owner=activeProfileId,form=captureProfileForm();
      try{if(cloud.stage(owner,data=>{data.form=form;return data}))queueCloudSave(owner);return true}
      catch(error){storageError(error.message);return false}
    }
    function loadProfileForm(profileId){
      clearTimeout(formUpdateTimer);cancelRecordDraft();activeProfileId=profileId;checkins={};activeCheckinKey='';lastAssessment=null;lastAssessmentInput=null;
      const values={...defaultProfileForm,...cloud.getData(profileId).form};
      profileFieldIds.forEach(id=>{$(id).value=values[id]??''});$('profileSelect').value=profileId;
      loadRecords();renderRecords();updatePersonalSummary();
    }
    async function createProfile(){
      const input=$('profileName'),name=input.value.trim();input.setCustomValidity('');
      if(!name){input.setCustomValidity('请填写档案名称。');input.reportValidity();return}
      if(profiles.some(profile=>profile.name.trim().toLocaleLowerCase()===name.toLocaleLowerCase())){input.setCustomValidity('已有同名档案，请使用不同名称。');input.reportValidity();return}
      if(profiles.length>=100){input.setCustomValidity('已达到 100 个档案，请使用现有档案。');input.reportValidity();return}
      if(profileSwitching)return;const client=cloud,epoch=accountEpoch;profileSwitching=true;setEditingEnabled(false);$('createProfileSubmit').disabled=true;
      try{
        saveProfileForm();clearTimeout(cloudSaveTimer);await client.flush(activeProfileId);if(epoch!==accountEpoch)return;
        const id=uniqueId('profile');await client.create({id,name,data:{form:{...defaultProfileForm},records:[],plans:{},history:[]}});
        if(epoch!==accountEpoch)return;profiles=client.profiles();renderProfileOptions();loadProfileForm(id);selectSetupTab('race');updateDistanceMode();render();$('profileDialog').close();toast(savedMessage('新档案已保存到云端。','已建立试用档案，仅保留在当前页面。'));
      }catch(error){if(epoch===accountEpoch){input.setCustomValidity(error.message);input.reportValidity()}}
      finally{if(epoch===accountEpoch){profileSwitching=false;setEditingEnabled(cloudReady);$('createProfileSubmit').disabled=false}}
    }
    function parseTimeInput(value){const match=String(value||'').trim().match(/^(\d{1,2}):([0-5]\d):([0-5]\d)$/);if(!match)return null;const hours=Number(match[1]),minutes=Number(match[2]),seconds=Number(match[3]);if(hours>12)return null;const total=hours*3600+minutes*60+seconds;return total>0?total:null}
    function updateDistanceMode(){const half=Number($('distance').value)<30;$('halfGoalField').hidden=!half;$('paceFields').hidden=half;$('riskAssessment').hidden=true;$('halfGoalTime').required=half;$('paceMin').required=!half;$('paceSec').required=!half;$('benchmarkHelp').textContent=half?'半马能力评估请填 10 公里或半马成绩；格式 HH:MM:SS。':'全马能力评估请填近 12 个月全马成绩；格式 HH:MM:SS。';$('scheduleBasisHint').textContent=half?'半马专项固定 4 跑 + 1 次力量。跑量、最长跑和目前频率用于难度评估。':'全马按每周可跑天数和现有跑量安排距离，课表配速按目标；个人能力建议另列。'}
    function updateCheckinProgress(){const today=new Date();today.setHours(0,0,0,0);const todayKey=dateKey(today),workouts=Array.from(document.querySelectorAll('#weekList .checkin[data-workout="true"]')).filter(button=>button.dataset.date>=activePlanStartDate&&button.dataset.date<=todayKey),done=workouts.filter(button=>button.getAttribute('aria-pressed')==='true').length,total=workouts.length,percent=total?Math.round(done/total*100):0;$('planCompletionMetric').textContent=total?`${percent}%`:'—';$('planCompletionDetail').textContent=total?`${done}/${total} 次`:'尚未开始';$('planCompletionBar').style.width=`${percent}%`;$('planCompletionBar').parentElement.setAttribute('aria-valuenow',String(percent));$('progressSummary').textContent=total?`计划完成度 ${percent}% · 已完成 ${done}/${total} 次训练 · ${storageMode==='cloud'?'打卡保存于云端':'试用打卡仅在当前页面'}`:`等待计划中的首个训练日 · ${storageMode==='cloud'?'打卡保存于云端':'试用打卡仅在当前页面'}`;Array.from(document.querySelectorAll('#weekList .week')).forEach(week=>{const span=week.querySelector('.week-completion'),items=Array.from(week.querySelectorAll('.checkin[data-workout="true"]')).filter(button=>button.dataset.date>=activePlanStartDate&&button.dataset.date<=todayKey),weekDone=items.filter(button=>button.getAttribute('aria-pressed')==='true').length;span.textContent=items.length?`完成 ${weekDone}/${items.length} · ${Math.round(weekDone/items.length*100)}%`:(week.dataset.end<activePlanStartDate?'计划未开始':'待训练')})}
    function easyRange(goal,slower=105){return `${fmt(goal+65)}–${fmt(goal+slower)}/km`}
    function plannedPace(type,title,goal,isHalf=false){
      const easy=isHalf?`${fmt(goal+62)}–${fmt(goal+92)}/km`:easyRange(goal);
      if(type==='easy'&&title==='恢复轻松跑')return `建议 ${isHalf?easy:`${fmt(goal+85)}–${fmt(goal+120)}/km`} · 放松为先`;
      if(type==='easy')return `建议 ${easy} · 能完整交谈`;
      if(type==='long'&&title==='渐进长距离')return `前段 ${easy}；末段逐步接近 ${fmt(goal)}/km`;
      if(type==='long')return `建议 ${easy} · 全程轻松`;
      if(type==='quality'&&title==='渐速跑')return `前段 ${easy}；后段逐步接近 ${fmt(goal)}/km`;
      if(type==='quality'&&title.includes('配速段'))return `主训练段 ${fmt(goal-3)}–${fmt(goal+3)}/km`;
      if(type==='quality'&&title==='短节奏唤醒')return `短段约 ${fmt(goal)}/km · 前后慢跑热身`;
      if(type==='quality')return `轻松段 ${easyRange(goal)}；快段约 ${fmt(goal)}/km`;
      if(type==='race')return `目标 ${fmt(goal)}/km · 以体感控速`;
      if(type==='strength')return '不跑步 · 按动作完成力量练习';
      return '不跑步 · 休息与恢复';
    }
    function halfBlockWorkout(index,goal){const tempo=`${fmt(goal-8)}–${fmt(goal-3)}/km`,interval=`${fmt(goal-13)}–${fmt(goal-8)}/km`,easyA=fmt(goal+62),easyB=fmt(goal+92);return [
      {title:'节奏跑',km:8,pace:`连续 8K · ${tempo}`},
      {title:'2K 变速跑',km:8,pace:`2K×3 · ${interval}；组间 1K ${fmt(goal+42)}/km`},
      {title:'12K 渐加速跑',km:12,pace:`4K ${fmt(goal+37)} → 4K ${fmt(goal+17)} → 4K ${tempo}`},
      {title:'节奏跑',km:8,pace:`连续 8K · ${tempo}`},
      {title:'2K 变速跑',km:8,pace:`2K×3 · ${interval}；组间 1K ${fmt(goal+42)}/km`},
      {title:'9K 渐加速跑',km:9,pace:`3K ${fmt(goal+37)} → 3K ${fmt(goal+17)} → 3K ${tempo}`},
      {title:'半马配速唤醒',km:5.5,displayKm:'5–6 km',pace:`5–6K · ${fmt(goal)}/km，不顶`}
    ][Math.max(0,Math.min(6,index))]}
    function halfBlockLong(index,goal){const easy=`${fmt(goal+62)}–${fmt(goal+92)}/km`;return [
      {km:15,title:'LSD 长距离',pace:easy},
      {km:15,title:'分段加速长距离',pace:`5K ${fmt(goal+62)} → 5K ${fmt(goal+32)} → 5K ${fmt(goal-3)}–${fmt(goal+2)}`},
      {km:16,title:'LSD 长距离',pace:easy},
      {km:16,title:'16K 专项自测',pace:`前 10K ${fmt(goal+22)}–${fmt(goal+27)}；后 6K 约 ${fmt(goal-3)}`},
      {km:15,title:'分段加速长距离',pace:`5K ${fmt(goal+62)} → 5K ${fmt(goal+32)} → 5K ${fmt(goal-3)}–${fmt(goal+2)}`},
      {km:13,displayKm:'12–14 km',title:'减量有氧长距离',pace:easy},
      {km:21.0975,title:'半程比赛日',pace:`目标均速 ${fmt(goal)}/km`}
    ][Math.max(0,Math.min(6,index))]}
    function fmt(sec){const total=Math.round(sec);return `${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`}
    function showGenerationError(message,fieldId){
      $('templatePanel').hidden=true;
      $('notice').textContent=message;$('notice').classList.add('show');$('generationStatus').textContent='计划未更新：请先修正上方信息。';$('riskAssessment').hidden=true;$('abilityPanel').hidden=true;lastAssessment=null;$('phaseRow').innerHTML='';$('summaryTitle').textContent='等待生成训练计划';$('summaryCopy').textContent='请补全训练信息后重新生成计划。';$('finishTime').textContent='—';$('weeksMetric').textContent='—';$('daysMetric').textContent='—';$('peakMetric').textContent='—';$('longMetric').textContent='—';$('qualityMetric').textContent='—';$('planCompletionMetric').textContent='—';$('planCompletionDetail').textContent='—';$('planCompletionBar').style.width='0%';$('progressSummary').textContent='计划未生成';$('weekList').innerHTML='<div class="empty-state">信息未通过检查，修正后点击“生成训练计划”。</div>';if(fieldId&&focusValidation){if(personalFieldIds.includes(fieldId))selectSetupTab('personal');else if(fieldId.startsWith('benchmark')){selectSetupTab('records');$('legacyEntry').open=true}else selectSetupTab('race');$(fieldId).focus();}
    }
    function parseBenchmarkDate(value){const match=String(value||'').trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);if(!match)return null;const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]),date=new Date(0);date.setFullYear(year,month-1,day);date.setHours(0,0,0,0);if(date.getFullYear()!==year||date.getMonth()!==month-1||date.getDate()!==day)return null;return date}
    function recentSessionLimit(dayDate,history){const cutoff=new Date(dayDate);cutoff.setDate(cutoff.getDate()-30);const recent=history.filter(entry=>entry.date>=cutoff&&entry.date<=dayDate);return recent.length?Math.max(...recent.map(entry=>entry.km))*1.10:Infinity}
    function render(){
      if(!cloudReady)return;
      $('templatePanel').hidden=true;
      const dist=Number($('distance').value),isHalf=dist<30,current=Number($('weeklyKm').value),longBase=Number($('longRun').value),runDays=Number($('days').value);
      const race=parseBenchmarkDate($('raceDate').value),dateValue=race?dateKey(race):'',now=new Date();now.setHours(0,0,0,0);
      if(!race){showGenerationError('比赛日期请按 YYYY-MM-DD 输入，例如 2026-12-27，并确认日期真实有效。','raceDate');return}
      if(race<=now){showGenerationError('比赛日期必须是未来日期，请重新输入。','raceDate');return}
      const requestedHalfTime=isHalf?parseTimeInput($('halfGoalTime').value):null;
      if(isHalf&&!requestedHalfTime){showGenerationError('半马目标时间请按 HH:MM:SS 输入，例如 01:45:00。','halfGoalTime');return}
      const min=Number($('paceMin').value),sec=Number($('paceSec').value);
      if(!isHalf&&(!Number.isFinite(min)||min<3||min>12||!Number.isFinite(sec)||sec<0||sec>59)){showGenerationError('请填写有效的全马目标配速。','paceMin');return}
      if((race-now)/86400000>(isHalf?167:160)){showGenerationError(isHalf?'目前支持含比赛日在内最多 24 周的训练周期，请选择更近的比赛日期。':'全马目前支持未来 160 天内的训练周期，请选择更近的比赛日期。','raceDate');return}
      const goal=isHalf?requestedHalfTime/dist:paceSeconds(),target=isHalf?requestedHalfTime:dist*goal;
      if(!Number.isFinite(goal)||goal<120||goal>1200){showGenerationError('目标配速超出可支持范围，请核对目标用时；支持 2:00–20:00/km。',isHalf?'halfGoalTime':'paceMin');return}
      if(isHalf){renderHalfTargetPlan({race,now,dateValue,goal,target,current,longBase,runDays});return}
      if(!Number.isFinite(current)||current<5||current>160){showGenerationError('目前周跑量请填写 5–160 公里之间的数值。','weeklyKm');return}
      if(!Number.isFinite(longBase)||longBase<3||longBase>42){showGenerationError('近 30 天最长跑请填写 3–42 公里之间的数值。','longRun');return}
      const personalInvalid=validatePersonal();if(personalInvalid){showGenerationError(personalInvalid.message,personalInvalid.field);return}
      const currentWeekStart=new Date(now);currentWeekStart.setDate(now.getDate()-((now.getDay()+6)%7));const currentWeekStartKey=dateKey(currentWeekStart);activeCheckinKey=checkinStorageKey([dist,dateValue,goal,current,runDays,longBase]);const savedPlan=cloud.getData(activeProfileId).plans[activeCheckinKey];checkins={...(savedPlan?.checkins||{})};activePlanStartDate=savedPlan?.started||dateKey(now)
      const days=Math.ceil((race-now)/86400000),weeks=Math.max(1,Math.ceil(days/7));
      $('goalTimeHint').textContent=isHalf?`目标配速约 ${fmt(goal)}/km`:`预计完赛约 ${clock(target)}`;$('finishTime').textContent=clock(target);$('weeksMetric').textContent=`${weeks} 周`;$('daysMetric').textContent=`${days} 天`;
      const raceName=isHalf?'半程马拉松':'马拉松';$('summaryTitle').textContent=`${weeks} 周${raceName}训练周期`;$('summaryCopy').textContent=`${durationLabel(now)} – ${durationLabel(race)} · 逐步建立耐力、专项训练与赛前减量`;
      const goalFit=buildAssessment({distanceKm:dist,targetSeconds:target,raceDate:dateValue,weeklyKm:current,longestRun:longBase,runDays});
      renderGoalRisk(goalFit);renderAbility(goalFit,goal);
      const trainingPace=goal;
      if(['pain','illness'].includes($('discomfort').value)){
        $('notice').textContent='你记录了近期疼痛、疾病或明显疲劳。当前能力仅供回顾，强化课表暂不生成。请先恢复，再根据实际状态更新资料。';$('notice').classList.add('show');$('weekList').innerHTML='<div class="empty-state">优先恢复，暂不安排强化训练。身体状态稳定后，在个人资料中更新，再生成计划。</div>';$('phaseRow').innerHTML='';$('peakMetric').textContent='—';$('longMetric').textContent='—';$('qualityMetric').textContent='暂缓';$('planCompletionMetric').textContent='—';$('planCompletionDetail').textContent='暂停安排';$('planCompletionBar').style.width='0%';$('progressSummary').textContent='强化训练暂缓';$('generationStatus').textContent='资料已更新 · 等待恢复后再安排训练';return;
      }
      const baseline= Math.max(current,longBase*2.1); let peak=baseline;
      const usable=Math.max(1,weeks-2); peak=baseline*Math.pow(1.055,Math.min(usable,10)); peak=Math.min(peak,isHalf?current*1.55:current*1.65, isHalf?75:95);
      const maxLong=Math.min(isHalf?24:32,Math.max(longBase,Math.round((isHalf?dist*.88:dist*.72)/2)*2));
      $('peakMetric').textContent=`${Math.round(peak)} km`;
      let warnings=[...(goalFit.warnings||[])];
      if(days<=0)warnings.push('比赛日期已过，请选择未来日期。');
      if(!isHalf&&weeks<12)warnings.push(`当前只有 ${weeks} 周备赛时间，低于本计划的 12 周建议下限。不要通过加大单周训练量“补课”；请考虑调整比赛目标、延期或咨询教练。`);
      if(!isHalf && current<30)warnings.push('目前周跑量低于 30 km。全马目标与当前基础可能不匹配，建议先建立稳定跑量，或咨询教练后再执行专项计划。');
      if(longBase<10)warnings.push('最近最长跑低于 10 km。计划会从较低长跑距离起步；如这不代表近 3–4 周常态，请先修正基础数据。');
      if(current>0 && longBase>current*.7)warnings.push('最近单次长跑已占周跑量的较大比例，请先核对输入；长跑与总跑量需要一起渐进。');
      if(longBase<current/runDays*.65)warnings.push('周跑量与近 30 天最长单次跑距离差距较大，请核对数据。计划会限制单次跑距的递增，因此实际周公里数可能低于当前周跑量。');
      $('notice').innerHTML=[...new Set(warnings)].map(escapeHtml).join('<br>'); $('notice').classList.toggle('show',warnings.length>0);
      const phases=[]; if(weeks>=8){phases.push([`基础期 · ${Math.max(1,Math.round(weeks*.3))} 周`,'01']); phases.push([`强化期 · ${Math.max(2,Math.round(weeks*.45))} 周`,'02']); phases.push(['减量期 · 2–3 周','03'])}else phases.push([`短周期 · ${weeks} 周`,'01']);
      $('phaseRow').innerHTML=phases.map((p,i)=>`<span class="phase ${i===0?'active':''}"><span>${p[1]}</span>${p[0]}</span>`).join('');
      const startMonday=new Date(currentWeekStart);
      const count=Math.min(Math.max(1,Math.floor((race-startMonday)/86400000/7)+1),24), raceIndex=(race.getDay()+6)%7,raceBlockStart=Math.max(0,count-7);
      const sessionsPerWeek = runDays===3?['周三','周五','周日']:runDays===5?['周一','周三','周四','周五','周日']:['周一','周三','周四','周日'];
      const longIndex=6, qualityIndex=2, secondaryIndex=runDays===5?4:-1;
      let html='',maxScheduledLong=0,maxScheduledWeekKm=0;const recentSessions=[{date:new Date(now),km:longBase}];
      for(let w=0;w<count;w++){
        const weekStart=new Date(startMonday);weekStart.setDate(startMonday.getDate()+w*7);const weekEnd=new Date(weekStart);weekEnd.setDate(weekStart.getDate()+6);
        const weekLimitDate=weekStart<now?new Date(now):new Date(weekStart),sessionDistanceCap=recentSessionLimit(weekLimitDate,recentSessions);
        const halfBlockIndex=isHalf?w-raceBlockStart:-1,isFinalHalfBlock=isHalf&&halfBlockIndex>=0;
        const taperWeeks=isHalf?(weeks>=7?Math.min(3,Math.max(2,Math.floor(count*.16))):0):(weeks>=12?Math.min(3,Math.max(1,Math.floor(weeks*.16))):0); const taper=isHalf?w>=count-taperWeeks:w>=weeks-taperWeeks; const cutback=!taper&&!isFinalHalfBlock&&w>0&&(w+1)%4===0;
        let load=baseline*Math.pow(1.055,Math.min(w,10)); load=Math.min(load,peak); if(cutback)load*=.78; if(taper){const remaining=weeks-w;load*=remaining===1?.45:remaining===2?.65:.82}
        load=Math.max(runDays*3,Math.round(load));const raceWeek=w===count-1;let long=Math.min(maxLong,longBase+(w*1.45));if(cutback)long*=.82;if(taper)long=w===weeks-1?8:Math.min(long,maxLong*.58);const halfLong=isFinalHalfBlock?halfBlockLong(halfBlockIndex,trainingPace):null;if(isFinalHalfBlock&&halfBlockIndex<6)long=Math.min(halfLong.km,Math.max(3,longBase+w));long=Math.max(3,Math.round(long*10)/10);const longDate=new Date(weekStart);longDate.setDate(weekStart.getDate()+longIndex);const uncappedLong=long;long=Number(Math.min(long,sessionDistanceCap).toFixed(1));const longCapped=long<uncappedLong;if(!raceWeek){maxScheduledLong=Math.max(maxScheduledLong,long);if(longDate>=now)recentSessions.push({date:longDate,km:long})}
        const runs=Array(7).fill(null);const qDay=qualityIndex, lDay=longIndex;
        const easyKm=Math.max(4,Math.round((load-long)/(runDays-1)));
        sessionsPerWeek.forEach((dayName)=>{const ix=weekdays.indexOf(dayName);if(ix===lDay)return;if(raceWeek){const daysToRace=(raceIndex-ix+7)%7;if(daysToRace<2||daysToRace>5)return;}let kind='easy',title='轻松跑';let km=raceWeek?Math.max(3,Math.round(easyKm*.55)):easyKm,paceOverride='',displayKm='';
          if(ix===qDay){kind='quality';if(isHalf&&weeks<7){title='轻松渐进训练';km=Math.min(7,Math.max(5,easyKm));paceOverride=`${fmt(trainingPace+15)}–${fmt(trainingPace+30)}/km · 不冲刺`}else if(isFinalHalfBlock){const workout=halfBlockWorkout(halfBlockIndex,trainingPace);title=workout.title;km=workout.km;displayKm=workout.displayKm||'';paceOverride=workout.pace}else if(taper){title='短节奏唤醒';km=Math.max(4,Math.round(easyKm*.8))}else if(w%2===0){title='渐速跑';km=Math.max(6,Math.round(easyKm*1.15))}else{title=isHalf?'半马配速段':'马拉松配速段';km=Math.max(6,Math.round(easyKm*1.15))}}
          if(ix===secondaryIndex && !taper){title='恢复轻松跑';km=Math.max(4,Math.round(easyKm*.72))}
          const sessionDate=new Date(weekStart);sessionDate.setDate(weekStart.getDate()+ix);if(sessionDate>=now&&!raceWeek){if(km>sessionDistanceCap){kind='easy';title='轻松跑（按近期单次距离渐进）';km=Number(sessionDistanceCap.toFixed(1));displayKm='';paceOverride=''}recentSessions.push({date:sessionDate,km})}runs[ix]={kind,title,km,displayKm,pace:paceOverride||plannedPace(kind,title,trainingPace,isHalf)};
        });
        const longTitle=longCapped?'渐进长距离':(halfLong?.title||(taper?'赛前轻松跑':(cutback?'回撤长跑':(w%2===0?'LSD 长距离':'渐进长距离'))));
        runs[lDay]=raceWeek?null:{kind:'long',title:longTitle,km:long,displayKm:longCapped?'':halfLong?.displayKm,pace:longCapped?plannedPace('long','LSD 长距离',trainingPace,isHalf):(halfLong?.pace||plannedPace('long',longTitle,trainingPace,isHalf))};
        if(raceWeek)runs[raceIndex]={kind:'race',title:'比赛日',km:dist,pace:`${fmt(goal)}/km`};
        const strengthIndex=runDays===5?1:4,halfRaceWeekActivation=isHalf&&isFinalHalfBlock&&halfBlockIndex===6&&raceWeek&&strengthIndex<raceIndex;if(!runs[strengthIndex]&&strengthIndex!==5&&(!raceWeek||halfRaceWeekActivation)){const strengthTitle=isHalf&&isFinalHalfBlock&&halfBlockIndex===6?'身体唤醒':isHalf&&isFinalHalfBlock&&halfBlockIndex===5?'力量激活':taper?'灵活性与激活':'力量训练',strengthTime=isHalf&&isFinalHalfBlock&&halfBlockIndex===6?'10–15 分钟 · 轻量激活':isHalf&&isFinalHalfBlock&&halfBlockIndex===5?'15–20 分钟 · 不练到疲劳':taper?'15–20 分钟':'20–30 分钟 · 中低负荷';runs[strengthIndex]={kind:'strength',title:strengthTitle,km:null,pace:strengthTime};}else if(!raceWeek&&runDays===3&&runs[4]){runs[4].title+=' + 力量';runs[4].pace+=' · 跑后 20 分钟'}else if(raceWeek&&isHalf&&isFinalHalfBlock&&halfBlockIndex===6&&runDays===3&&runs[4]){runs[4].title+=' + 身体唤醒';runs[4].pace+=' · 10–15 分钟轻量激活'}
        if(raceWeek)runs.forEach((session,index)=>{const sessionDate=new Date(weekStart);sessionDate.setDate(weekStart.getDate()+index);if(sessionDate>race)runs[index]=null});
        runs.forEach(session=>annotateSession(session,goalFit));
        const total=Number(runs.reduce((a,s)=>a+(s?.km||0),0).toFixed(1));maxScheduledWeekKm=Math.max(maxScheduledWeekKm,total);const weekPhase=taper?'减量':cutback?'回撤':w<Math.ceil(weeks*.3)?'基础':w>=Math.ceil(weeks*.72)?'专项':'强化';
        const cells=runs.map((s,i)=>{const dayDate=new Date(weekStart);dayDate.setDate(weekStart.getDate()+i);const date=dateKey(dayDate),done=Boolean(s)&&date>=activePlanStartDate&&checkins[date]===true,eligible=dayDate<=now&&date>=activePlanStartDate,kind=s?.kind||'rest',title=s?.title||'休息 / 恢复';
          return `<div class="day ${kind}${done?' completed':''}" title="${weekdays[i]} ${durationLabel(dayDate)} · ${title}"><div class="dow"><span>${weekdays[i]} ${durationLabel(dayDate)}</span>${s?.kind==='long'?'<span>LONG</span>':''}</div>${s?`<div class="km">${s.km===null?'＋':s.displayKm||s.km+' km'}</div><div class="title">${s.title}</div><div class="pace">${s.pace}</div>${s.heart?`<div class="heart-rate">${s.heart}</div>`:''}`:`<div class="title">${title}</div><div class="pace">休息日 · 不安排跑步</div>`}${s?`<button type="button" class="checkin${done?' done':''}" data-date="${date}" data-workout="true" aria-pressed="${done}" aria-label="${date} 训练打卡" ${eligible?'':'disabled'}>${done?'已完成':'打卡'}</button>`:''}</div>`}).join('');
        html+=`<article class="week" data-start="${dateKey(weekStart)}" data-end="${dateKey(weekEnd)}"><div class="week-top"><div class="week-title"><b>第 ${String(w+1).padStart(2,'0')} 周</b><span>${durationLabel(weekStart)} — ${durationLabel(weekEnd)} · ${weekPhase}</span></div><div class="week-stats"><span><strong>${total}</strong> km</span><span>${runDays} 跑 + 力量</span><span class="week-completion">待训练</span></div></div><div class="day-grid">${cells}</div><div class="week-footer"><span>${cutback?'回撤周：总量与长跑下调，优先恢复。':taper?'赛前减量：减少总量，保留短暂配速唤醒。':`质量课：${runs[qDay]?.title||'轻松跑'}，其余跑量保持轻松。`}</span><strong>${weekPhase==='基础'?'先把频率跑稳':weekPhase==='减量'?'睡眠与恢复优先':'不追赶漏掉的训练'}</strong></div></article>`;
      }
      $('weekList').innerHTML=html||'<div class="empty-state">请设置未来的比赛日期后生成计划。</div>';if(maxScheduledLong>0)$('longMetric').textContent=`${maxScheduledLong} km`;if(maxScheduledWeekKm>0)$('peakMetric').textContent=`${maxScheduledWeekKm} km`;$('qualityMetric').textContent=document.querySelector('#weekList .day.quality')?'每周至多 1 次':'以轻松跑为主';updateCheckinProgress();savePlanHistory();$('generationStatus').textContent=`已更新：${weeks} 周 · 主课表配速按目标 · 当前能力建议另列`;
    }

function targetCheckinState(dateValue,target,now){
  activeCheckinKey=checkinStorageKey(['half-target-v1',dateValue,target]);
  const saved=cloud.getData(activeProfileId).plans[activeCheckinKey];
  checkins={...(saved?.checkins||{})};
  activePlanStartDate=parseBenchmarkDate(saved?.started)&&saved.started<=dateKey(now)?saved.started:dateKey(now);
}
function kmRangeLabel(range){
  if(!range||!Number.isFinite(range[0]))return '—';
  const low=Math.round(range[0]*10)/10,high=Math.round(range[1]*10)/10;
  return low===high?String(low):`${low}–${high}`;
}
function renderAdvice(advice){
  if(!advice||advice.level==='rest')return '';
  const lines=advice.paceLines?.length?advice.paceLines:[advice.paceText].filter(Boolean);
  return `<div class="session-advice" data-level="${escapeHtml(advice.level)}"><div class="advice-heading"><span>当前能力建议</span><strong class="difficulty-badge">${escapeHtml(advice.label)}</strong></div>${lines.length?`<div class="advice-pace">${lines.map(escapeHtml).join('<br>')}</div>`:''}${advice.heartText?`<div class="heart-rate">${escapeHtml(advice.heartText)}</div>`:''}<details class="advice-details"><summary>查看难度依据</summary><p>${escapeHtml(advice.reason)}</p>${advice.notes?.length?`<p>${advice.notes.map(escapeHtml).join(' ')}</p>`:''}</details></div>`;
}
function renderHalfTargetPlan({race,now,dateValue,goal,target,current,longBase,runDays}){
  targetCheckinState(dateValue,target,now);
  const plan=TargetPlan.build({targetSeconds:target,raceDate:dateValue,fromDate:activePlanStartDate});
  if(!plan.valid){showGenerationError(plan.error,'raceDate');return}
  const currentValid=$('weeklyKm').value!==''&&Number.isFinite(current)&&current>=0&&current<=160;
  const longValid=$('longRun').value!==''&&Number.isFinite(longBase)&&longBase>=0&&longBase<=42;
  const context={weeklyKm:currentValid?current:null,longestRun:longValid?longBase:null,runDays:[3,4,5].includes(runDays)?runDays:null,personal:personalValues(),now:dateKey(now)};
  const result=buildAssessment({distanceKm:21.0975,targetSeconds:target,raceDate:dateValue,...context});
  renderGoalRisk(result);renderAbility(result,goal);
  const advice=SessionAdvice.forPlan(plan,result,context),days=Math.ceil((race-now)/86400000),remainingWeeks=Math.ceil((days+1)/7);
  $('goalTimeHint').textContent=`目标均速 ${fmt(goal)}/km · 课表按目标生成`;
  $('finishTime').textContent=clock(target);$('weeksMetric').textContent=`${remainingWeeks} 周`;$('daysMetric').textContent=`${days} 天`;
  $('summaryTitle').textContent=`半马 ${clock(target)} 目标训练计划`;
  $('summaryCopy').textContent=`${durationLabel(parseBenchmarkDate(activePlanStartDate))} – ${durationLabel(race)} · 七周专项结构 + 当前能力旁注`;
  $('peakMetric').textContent=`${kmRangeLabel(plan.summary.peakKm)} km`;
  $('longMetric').textContent=plan.summary.longestKm?`${plan.summary.longestKm} km`:'已进入比赛周';
  $('qualityMetric').textContent='周中专项 + 长跑';
  $('templatePanel').hidden=false;$('templateTitle').textContent=target===6300?'半马 1:45 · 参考图基准课表':`半马 ${clock(target)} · 目标换算课表`;
  $('templateCopy').textContent=target===6300?'按原图保留七周节奏、组数、距离与配速。每周 4 跑 + 1 次力量，个人资料更新后，目标课表保持一致。':'以 1:45 参考图为基准，所有训练配速统一加上目标配速差，保留七周结构、组数和时长。个人资料用于另列能力建议。';
  $('planDifficultyLabel').textContent=advice.label;$('planDifficultyLabel').dataset.level=advice.level;
  $('planDifficultyReason').textContent=advice.reason;
  $('difficultyMethod').textContent=advice.notes?.join(' ')||'难度是基于配速、训练量与近期基础的解释性规划规则，不是个人成功概率。';
  const extraNotes=['1:45 比赛均速为 4:58.6/km，整秒显示 4:59；原图 4:58 为近似值，训练基准不因此整体移动。','第 4 周专项自测：16K 的前 10K 配速 5:20–5:25、后 6K 约 4:55（1:45 基准）。自测完成只是专项准备的一项线索。','原图两格未单列数字配速：第 5 周首个有氧跑、第 7 周第二个有氧跑。页面明确标为沿用有氧参考。'];
  $('templateNotes').innerHTML=`<ul>${[...plan.notes,...extraNotes].map(note=>`<li>${escapeHtml(note)}</li>`).join('')}</ul>`;
  const warningMessages=[...result.warnings];
  const invalid=validatePersonal();if(invalid)warningMessages.push(`${invalid.message} 请核对个人建议所用资料；目标课表仍按目标展示。`);
  if(!currentValid&&$('weeklyKm').value!=='')warningMessages.push('目前周跑量请填 0–160 km，或留空；缺失时无法判断周负荷匹配程度。');
  if(!longValid&&$('longRun').value!=='')warningMessages.push('近 30 天最长跑请填 0–42 km，或留空；缺失时无法判断长跑距离难度。');
  if(result.fit.hold)warningMessages.push('近期身体状态提示需要恢复。目标课表保留为参考，当前建议为暂缓执行。');
  if(days<48)warningMessages.push('距离比赛不足完整七周，只显示剩余模板周次；已过课程不补做。');
  if(!result.equivalentPace)warningMessages.push('目标课表已生成。补充并确认近期 10 km 或半马实绩后，可查看个人建议配速与更完整的难度判断。');
  $('notice').innerHTML=[...new Set(warningMessages)].map(escapeHtml).join('<br>');$('notice').classList.toggle('show',warningMessages.length>0);
  const bridge=plan.weeks.filter(week=>week.templateWeek===null).length;
  const phaseLabels=[...(bridge?[`衔接期 · ${bridge} 周（非原图）`]:[]),'专项第 1–5 周','减量第 6 周','比赛第 7 周'];
  $('phaseRow').innerHTML=phaseLabels.map((label,index)=>`<span class="phase${index===0?' active':''}"><span>${String(index+1).padStart(2,'0')}</span>${escapeHtml(label)}</span>`).join('');
  const today=dateKey(now);
  $('weekList').innerHTML=plan.weeks.map(week=>{
    const runCount=week.sessions.filter(s=>['easy','quality','long','race'].includes(s.kind)).length;
    const cells=week.sessions.map(session=>{
      const date=session.date,day=parseBenchmarkDate(date),isWorkout=session.kind!=='rest',beforeStart=date<activePlanStartDate;
      const done=isWorkout&&!beforeStart&&checkins[date]===true,eligible=isWorkout&&!beforeStart&&date<=today;
      const personalAdvice=isWorkout?SessionAdvice.forSession(session,result,{...context,weekKm:week.totalKm,requiredRunDays:runCount}):null;
      return `<div class="day ${session.kind}${done?' completed':''}${beforeStart?' before-start':''}" data-template-week="${week.templateWeek??'bridge'}" data-date="${date}"><div class="dow"><span>${weekdays[(day.getDay()+6)%7]} ${durationLabel(day)}</span>${beforeStart?'<span>已过 · 不补训</span>':date===today?'<span>今天</span>':''}</div><div class="target-prescription" data-target="true">${isWorkout?'<span class="prescription-label">目标课表</span>':''}<div class="title">${escapeHtml(session.title)}</div>${isWorkout?`<div class="km">${escapeHtml(session.displayAmount)}</div>`:''}<div class="pace">${session.paceLines.map(line=>`<span>${escapeHtml(line)}</span>`).join('')||escapeHtml(session.kind==='rest'?'休息与恢复':session.notes[0]||'按动作完成力量练习')}</div>${isWorkout&&session.notes.length?`<details class="session-notes"><summary>课程说明</summary><p>${session.notes.map(escapeHtml).join(' ')}</p></details>`:''}</div>${!beforeStart?renderAdvice(personalAdvice):''}${isWorkout?`<button type="button" class="checkin${done?' done':''}" data-date="${date}" data-workout="true" aria-pressed="${done}" aria-label="${date} 训练打卡" ${eligible?'':'disabled'}>${done?'已完成':beforeStart?'已过 · 不补训':'打卡'}</button>`:''}</div>`;
    }).join('');
    return `<article class="week target-week" data-start="${week.startDate}" data-end="${week.endDate}"><div class="week-top"><div class="week-title"><b>${escapeHtml(week.templateWeek===null?week.label:`专项第 ${week.templateWeek} 周`)}</b><span>${durationLabel(parseBenchmarkDate(week.startDate))} — ${durationLabel(parseBenchmarkDate(week.endDate))} · ${escapeHtml(week.phase)}</span></div><div class="week-stats"><span>估算 <strong>${kmRangeLabel(week.totalKm)}</strong> km</span><span>${runCount} 跑 + 力量</span><span class="week-completion">待训练</span></div></div><div class="day-grid">${cells}</div><div class="week-footer"><span>${escapeHtml(week.templateWeek===null?'衔接期为额外安排；七周专项模板保持不变。':week.templateWeek>=6?'按原图逐步减量，保留短暂配速唤醒。':'时长课以分钟为准，周公里数为估算；未列出的热身放松另计。')}</span><strong>目标要求 / 能力建议分列</strong></div></article>`;
  }).join('');
  updateCheckinProgress();savePlanHistory();
  $('generationStatus').textContent=`已更新：目标 ${clock(target)} · 主课表仅按目标 · ${advice.label}`;
}

// All asynchronous image work captures the owning profile before it starts.
function uniqueId(prefix){return prefix+'_'+(crypto.randomUUID?crypto.randomUUID().replaceAll('-',''):Date.now()+'_'+Math.random().toString(36).slice(2,10))}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function storageError(message){$('storageStatus').textContent=message;$('storageStatus').hidden=false}
function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>{$('toast').hidden=true},4200)}
function selectSetupTab(name){
  document.querySelectorAll('[data-tab]').forEach(button=>{const selected=button.dataset.tab===name;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1});
  ['race','records','personal'].forEach(key=>$('panel-'+key).hidden=key!==name);
}
function loadRecords(){try{currentRecords=recordsStore.list(activeProfileId)}catch(error){currentRecords=[];storageError(error.message)}}
function recordName(distance){return Number(distance)===10?'10 公里':Number(distance)===21.0975?'半程马拉松':'全程马拉松'}
function recordUsable(record){return record.include!==false&&record.confirmed&&['race','time_trial'].includes(record.effort)&&record.durationType==='elapsed'&&!['hilly','trail','treadmill'].includes(record.course)}
function renderRecords(){
  $('recordCount').textContent=String(currentRecords.length);$('recordsCaption').textContent=currentRecords.length+' 条';
  const included=currentRecords.filter(recordUsable).length;
  $('recordNudgeText').textContent=currentRecords.length?`${currentRecords.length} 条成绩 · ${included} 条候选依据，按日期与距离筛选`:'上传 10 km / 半马截图，或手动添加成绩';
  $('recordList').innerHTML=currentRecords.length?currentRecords.map(record=>`<article class="record-card"><div class="record-card-top"><strong>${recordName(record.distanceKm)}</strong><small>${escapeHtml(record.date)}</small></div><div class="record-card-time">${clock(record.elapsedSeconds)}<small>${fmt(record.elapsedSeconds/record.distanceKm)}/km</small></div><p>${record.source==='screenshot'?'截图已核对':'手动录入'}${record.averageHr?` · 平均 ${record.averageHr} bpm`:''}${record.peakHr?` · 本次最高 ${record.peakHr}`:''}</p><div class="record-card-bottom"><span class="record-tag${recordUsable(record)?'':' muted'}">${recordUsable(record)?'参与评估筛选':'仅留档'}</span><div class="record-card-actions"><button type="button" data-record-edit="${escapeHtml(record.id)}">查看 / 编辑</button><button type="button" data-record-delete="${escapeHtml(record.id)}">删除</button></div></div></article>`).join(''):'<div class="record-empty">还没有成绩记录<br>上传一张截图，开始了解当前能力。</div>';
}
function personalValues(){return Object.fromEntries(personalFieldIds.map(id=>[id,$(id).value]))}
function validatePersonal(){
  const ranges={age:[18,90,'年龄'],restingHr:[30,120,'静息心率'],maxHr:[100,230,'最大心率'],thresholdHr:[80,220,'阈值心率'],vo2max:[15,90,'VO₂max'],experienceMonths:[0,720,'持续跑龄']};
  for(const [field,[min,max,label]] of Object.entries(ranges)){const raw=$(field).value;if(raw!==''&&(!Number.isFinite(Number(raw))||Number(raw)<min||Number(raw)>max))return{field,message:`${label}请填写 ${min}–${max} 范围内的数值，或留空。`}}
  if($('maxHr').value&&$('restingHr').value&&Number($('maxHr').value)<=Number($('restingHr').value))return{field:'maxHr',message:'个人最大心率必须高于静息心率，请核对。'};
  if($('maxHr').value&&$('thresholdHr').value&&Number($('thresholdHr').value)>=Number($('maxHr').value))return{field:'thresholdHr',message:'阈值心率应低于个人最大心率，请核对测试来源。'};
  const vo2date=$('vo2maxDate').value;if(vo2date&&(!parseBenchmarkDate(vo2date)||vo2date>dateKey(new Date())))return{field:'vo2maxDate',message:'VO₂max 测量日期应为真实的过去日期。'};
  return null;
}
function updatePersonalSummary(){
  const invalid=validatePersonal();if(invalid){$('personalSummary').textContent=invalid.message;return}
  const hr=RunningAssessment.heartRate(personalValues(),currentRecords);
  $('personalSummary').textContent=hr.method==='effort'?'目前使用体感与交谈测试。补填最大心率和静息心率，或可靠的跑步阈值心率，可显示 bpm 参考。':hr.label+'。数据随当前档案保存；不会自动使用比赛平均心率代替最大心率。';
}
function effectiveRecords(){
  const records=currentRecords.map(record=>({...record}));
  const seconds=parseTimeInput($('benchmarkTime').value),distance=Number($('benchmarkDistance').value),date=$('benchmarkDate').value;
  if(seconds&&distance&&date)records.push({id:'legacy_'+activeProfileId,profileId:activeProfileId,distanceKm:distance,elapsedSeconds:seconds,date,effort:'race',confirmed:true,include:true,durationType:'elapsed',course:'unknown',source:'manual'});
  return records;
}
function readAdherence(){
  try{
    const data=cloud.getData(activeProfileId),prior=data.history.find(item=>item.planKey===activeCheckinKey),plan=data.plans[activeCheckinKey];
    if(!prior||!plan||!Array.isArray(prior.dates))return null;
    const today=dateKey(new Date()),due=[...new Set(prior.dates)].filter(date=>date>=prior.started&&date<today);
    return {due:due.length,completed:due.filter(date=>plan.checkins?.[date]===true).length};
  }catch{return null}
}
function savePlanHistory(){
  if(!cloudReady||!activeCheckinKey)return;
  const owner=activeProfileId,key=activeCheckinKey,started=activePlanStartDate,dates=[...document.querySelectorAll('#weekList .checkin[data-workout="true"]')].map(button=>button.dataset.date),today=dateKey(new Date());
  try{
    const changed=cloud.stage(owner,data=>{
      const previous=data.history.find(item=>item.planKey===key),past=previous?.dates?.filter(date=>date<today)||[];
      if(!data.plans[key])data.plans[key]={started,checkins:{}};
      const item={planKey:key,started:data.plans[key].started,dates:[...new Set([...past,...dates])].sort()},index=data.history.findIndex(entry=>entry.planKey===key);
      if(index>=0)data.history[index]=item;else data.history.push(item);
      return data;
    });
    if(changed)queueCloudSave(owner);
  }catch(error){storageError(error.message)}
}

function buildAssessment(settings){
  lastAssessmentInput={...settings,records:effectiveRecords(),personal:personalValues(),now:dateKey(new Date()),adherence:readAdherence()};
  lastAssessment=RunningAssessment.evaluate(lastAssessmentInput);return lastAssessment;
}
function paceRange(range){return range&&Number.isFinite(range[0])?`${fmt(range[0])}–${fmt(range[1])}`:'待确认'}
function heartLabel(target,includeNote=true){
  if(!target)return '按交谈与体感控制';
  if(Number.isFinite(target.min)&&Number.isFinite(target.max))return `${target.min}–${target.max} bpm`;
  if(Number.isFinite(target.max))return `< ${target.max+1} bpm`;
  if(Number.isFinite(target.min))return `≥ ${target.min} bpm`;
  return includeNote?(target.note||'按交谈与体感控制'):'暂不设 bpm';
}
function renderGoalRisk(result){
  lastAssessment=result;const fit=result.fit;
  $('riskAssessment').hidden=false;$('riskAssessment').dataset.level=fit.level;
  $('fitScore').textContent=fit.score===null?'—':String(fit.score);$('fitBar').style.width=(fit.score??0)+'%';$('riskBadge').textContent=fit.label;
  $('riskSummary').textContent=fit.summary;
  $('riskReasons').textContent=fit.reasons.length?fit.reasons.slice(0,3).join(' '):'持续记录实际成绩与训练情况，评估会随本档案的数据更新。';
  $('riskFactors').innerHTML=fit.factors.map(factor=>`<div><span>${escapeHtml(factor.label)}</span><strong>${escapeHtml(factor.value)}${factor.points?` · −${factor.points}`:''}</strong></div>`).join('');
  $('assessmentMethod').innerHTML=`<p>${escapeHtml(fit.rules)}</p><p>数据充分程度独立展示。静息心率、最大心率用于计算强度参考；VO₂max 不直接加减准备度分数。近期不适时暂停评分并提示暂缓执行，目标课表可保留作参考。打卡只计算过去已到期的课程。适配度和个人建议不会改写目标课表。</p><p>${escapeHtml(result.heartRate.formula||'缺少可靠心率资料时，使用交谈测试与主观强度。')}</p><ul>${result.sources.map(source=>`<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.title)}</a>：${escapeHtml(source.supports)}</li>`).join('')}</ul>`;
}
function renderAbility(result,targetPace){
  $('abilityPanel').hidden=false;$('equivalentLabel').textContent=result.distanceKm<30?'当前半马等效':'当前全马等效';
  $('equivalentTime').textContent=result.equivalentSeconds?clock(result.equivalentSeconds):'待确认';
  $('equivalentRange').textContent=result.range?`${clock(result.range[0])}–${clock(result.range[1])} · 情景参考范围`:'需要近期比赛或全力测试成绩';
  $('targetPace').textContent=Number.isFinite(targetPace)?fmt(targetPace)+'/km':'—';
  const gap=result.fit.gapPct;$('goalGap').textContent=gap===null?'先确认当前能力':gap>0?`需比当前等效成绩快 ${gap.toFixed(1)}%`:`当前等效成绩已接近或覆盖目标`;
  $('evidenceBadge').textContent='成绩证据 '+result.evidence.label;
  $('hrMethod').textContent=result.heartRate.label;$('hrConfidence').textContent=result.heartRate.method==='effort'?'补充个人心率资料后更新':'心率依据 '+({high:'较充分',medium:'一般',low:'有限'}[result.heartRate.confidence]||'待确认');
  $('evidenceCopy').textContent=result.evidence.count?`综合 ${result.evidence.count} 次已确认成绩；最近一次 ${result.evidence.newestAgeDays} 天前。以下为当前能力建议，目标课表另列。参考范围包含经验余量，不是个人预测的置信区间。`:'上传截图或手填实绩并核对后，可生成当前能力建议配速。目标课表已可独立查看。';
  const prescriptions=[['easy','轻松跑','RPE 2–4 / 10 · 可完整交谈'],['long','长距离轻松跑','保持交谈 · 以耐力积累为主'],['tempo','节奏训练段','RPE 6–7 / 10 · 前后热身放松'],['recovery','恢复跑','RPE 2–3 / 10 · 放松优先']];
  $('prescriptionGrid').innerHTML=prescriptions.map(([key,label,note])=>`<div class="prescription-card"><h4>${label}</h4><strong>${paceRange(result.paces[key])}<span class="unit">${result.paces[key]?' /km':''}</span></strong><div class="hr">${escapeHtml(heartLabel(result.heartRate.targets[key],false))}</div><p>${note}</p></div>`).join('');
  $('heartNotes').textContent=result.heartRate.notes.join(' ');
  const gaps=[...result.fit.missing];if(result.heartRate.method==='effort')gaps.push('可靠最大心率与静息心率，或跑步阈值心率');
  $('dataGaps').innerHTML=gaps.length?`继续补充：${escapeHtml([...new Set(gaps)].join('；'))}。<button type="button" id="fillPersonalData">完善资料 →</button>`:'';
  $('fillPersonalData')?.addEventListener('click',()=>{selectSetupTab(result.equivalentSeconds?'personal':'records');$('plannerForm').scrollIntoView({behavior:'smooth',block:'start'})});
  $('evidenceDetails').innerHTML=result.evidence.usedRecords.map(record=>`<div class="evidence-row"><strong>${escapeHtml(record.date)} · ${recordName(record.distanceKm)} ${clock(record.elapsedSeconds)}</strong><br>等效 ${clock(record.equivalentSeconds)} · 综合权重 ${Math.round(record.weight*100)}%${record.averageHr?` · 平均心率 ${record.averageHr} bpm`:''}${record.peakHr?` · 本次最高 ${record.peakHr} bpm`:''}</div>`).join('')+`<ul>${result.evidence.notes.map(note=>`<li>${escapeHtml(note)}</li>`).join('')}</ul>`+(result.evidence.excludedRecords.length?'<p>未用于当前能力：</p><ul>'+result.evidence.excludedRecords.map(record=>`<li>${escapeHtml(currentRecords.find(item=>item.id===record.id)?.date||'原有手填成绩')}：${escapeHtml(record.reason)}</li>`).join('')+'</ul>':'');
  const personal=personalValues();$('physiologyDetails').innerHTML=`<p>${personal.age?`年龄 ${escapeHtml(personal.age)} 岁；`:''}${personal.experienceMonths?`持续跑龄 ${escapeHtml(personal.experienceMonths)} 个月；`:''}${result.heartRate.restingHr?`静息 ${result.heartRate.restingHr} bpm；`:''}${result.heartRate.maxHr?`个人最大 ${result.heartRate.maxHr} bpm；`:''}${result.heartRate.thresholdHr?`阈值 ${result.heartRate.thresholdHr} bpm。`:''}</p><p>VO₂max：${result.vo2.value===null?'未填写':`${result.vo2.value} ml/kg/min · ${escapeHtml(result.vo2.label)}${result.vo2.date?' · '+escapeHtml(result.vo2.date):''}`}。${escapeHtml(result.vo2.note)}</p><p>${result.paces.notes.map(escapeHtml).join(' ')}</p>`;
}
function annotateSession(session,assessment){
  if(!session||['strength','rest'].includes(session.kind))return;
  // The main prescription is immutable here; ability is an annotation only.
  const key=session.kind==='long'?'long':session.kind==='race'?'race':session.kind==='quality'?'tempo':session.title.includes('恢复')?'recovery':'easy';
  const advice=SessionAdvice.forSession({...session,paceType:key,distanceKm:session.km,totalKm:[session.km,session.km]},assessment,{weeklyKm:Number($('weeklyKm').value),longestRun:Number($('longRun').value),runDays:Number($('days').value),personal:personalValues()});
  session.advice=advice;
  session.heart=`当前能力建议：${advice.paceText||'待补充成绩'} · ${advice.label}${advice.heartText?' · '+advice.heartText:''}`;
}
function cancelRecordDraft(force=false){
  if(recordDraft?.saving&&force!==true){toast(savedMessage('正在保存到云端，请稍候。','正在确认成绩，请稍候。'));return}
  recordJob++;
  if(recordDraft){recordDraft.controller?.abort();if(recordDraft.objectUrl)URL.revokeObjectURL(recordDraft.objectUrl)}
  recordDraft=null;if($('recordDialog').open)$('recordDialog').close();$('screenshotInput').value='';$('recordPreview').removeAttribute('src');$('recordPreview').hidden=true;$('rawText').textContent='';$('imageFilename').textContent='';
}
function freshRecordDraft(record){
  cancelRecordDraft();const id=record?.id||uniqueId('race');
  recordDraft={dirty:false,saving:false,owner:activeProfileId,id,existing:Boolean(record),record:record||null,controller:new AbortController(),job:recordJob,blob:null,objectUrl:null,rawText:record?.rawText||'',fingerprint:record?.fingerprint||null,source:record?.source||'manual'};
  $('recordForm').reset();$('recordOwner').textContent=profiles.find(profile=>profile.id===activeProfileId)?.name||'当前档案';
  $('recordDate').max=dateKey(new Date());$('recordPreview').hidden=true;$('recordPreview').removeAttribute('src');$('imagePlaceholder').hidden=false;$('imageFilename').textContent='';
  $('recordError').hidden=true;$('recognitionWarnings').hidden=true;$('rawTextDetails').hidden=true;$('saveRecordButton').disabled=false;$('ocrProgress').hidden=true;
  $('recognitionStatus').dataset.state='ready';$('recognitionMessage').textContent=record?'请核对已保存的数据，修改只影响本档案。':'请填写实际成绩；选填数据可以留空。';
  if(record){
    $('recordDistance').value=String(record.distanceKm);$('recordTime').value=clock(record.elapsedSeconds).padStart(8,'0');$('recordDate').value=record.date;
    $('recordAverageHr').value=record.averageHr??'';$('recordPeakHr').value=record.peakHr??'';$('recordEffort').value=record.effort||'';$('recordDurationType').value=record.durationType||'unknown';$('recordCourse').value=record.course||'unknown';$('recordInclude').checked=record.include!==false;
    $('imageFilename').textContent=record.filename||'';if(record.rawText){$('rawTextDetails').hidden=false;$('rawText').textContent=record.rawText}
  }
  updateRecordDerived();$('recordDialog').showModal();return recordDraft;
}
function updateRecordDerived(){const distance=Number($('recordDistance').value),seconds=parseTimeInput($('recordTime').value);$('recordDerived').textContent=distance&&seconds?`核算配速 ${fmt(seconds/distance)}/km · ${recordName(distance)} 使用标准比赛距离`:'配速会根据距离与用时自动计算'}
function showDraftImage(blob,draft){if(!blob||recordDraft!==draft||activeProfileId!==draft.owner)return;if(draft.objectUrl)URL.revokeObjectURL(draft.objectUrl);draft.objectUrl=URL.createObjectURL(blob);$('recordPreview').src=draft.objectUrl;$('recordPreview').hidden=false;$('imagePlaceholder').hidden=true}
async function editRecord(id){
  const record=currentRecords.find(item=>item.id===id);if(!record)return;const draft=freshRecordDraft(record);
  if(record.hasImage){try{const image=await cloud.fetchImage(draft.owner,id,draft.controller.signal);if(recordDraft!==draft)return;if(image)showDraftImage(image,draft);else{$('imageFilename').textContent='原截图暂不可用，成绩数据仍保留。'}}catch(error){if(recordDraft===draft)$('imageFilename').textContent=error.message}}
}
async function handleUpload(file){
  if(!file||!cloudReady||recordDraft?.saving)return;const draft=freshRecordDraft();draft.dirty=true;draft.source='screenshot';draft.filename=String(file.name||'成绩截图').slice(0,160);
  $('saveRecordButton').disabled=true;$('recognitionMessage').textContent='正在检查图片…';$('imageFilename').textContent=draft.filename;$('ocrProgress').hidden=false;$('ocrProgress').value=0;
  const live=()=>recordDraft===draft&&draft.owner===activeProfileId&&!draft.controller.signal.aborted;
  try{
    await RaceOCR.validateFile(file);if(!live())return;
    const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());if(!live())return;
    draft.fingerprint=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
    if(recordsStore.list(draft.owner).some(record=>record.fingerprint===draft.fingerprint))throw new Error('本档案已保存这张截图，请取消后编辑已有记录。');
    showDraftImage(file,draft);
    const result=await RaceOCR.recognize(file,{signal:draft.controller.signal,onProgress:({progress,status})=>{if(live()){$('recognitionMessage').textContent=status;$('ocrProgress').value=Math.round(progress*100)}}});
    if(!live())return;
    draft.blob=result.previewBlob;draft.rawText=(result.rawText||'').slice(0,20000);draft.confidence=result.confidence;
    if(result.previewBlob)showDraftImage(result.previewBlob,draft);
    const fields=result.fields||{};
    if(fields.distanceKm!==null&&fields.distanceKm!==undefined){const d=Number(fields.distanceKm),standard=Math.abs(d-10)<0.16?10:Math.abs(d-21.0975)<0.45?21.0975:Math.abs(d-42.195)<0.8?42.195:null;if(standard)$('recordDistance').value=String(standard)}
    if(fields.elapsedSeconds)$('recordTime').value=clock(fields.elapsedSeconds).padStart(8,'0');
    if(fields.date)$('recordDate').value=fields.date;
    if(fields.averageHr)$('recordAverageHr').value=fields.averageHr;if(fields.peakHr)$('recordPeakHr').value=fields.peakHr;
    $('recordDurationType').value='unknown';
    const warnings=[...(result.warnings||[]),'请确认这是完整计时还是移动时间，并选择比赛 / 测试 / 日常训练。'];
    if(fields.paceSeconds&&fields.elapsedSeconds&&Number($('recordDistance').value)&&Math.abs(fields.paceSeconds-fields.elapsedSeconds/Number($('recordDistance').value))>8)warnings.unshift('截图配速与距离、用时不一致，请检查移动时间、单位或 GPS 距离。');
    $('recognitionWarnings').textContent=warnings.join(' ');$('recognitionWarnings').hidden=false;
    const found=Object.values(fields).filter(value=>value!==null&&value!==undefined).length;
    $('recognitionMessage').textContent=`识别完成 · 提取 ${found} 项。请逐项核对，缺失信息可手动补充。`;
    $('ocrProgress').value=100;$('rawText').textContent=draft.rawText;$('rawTextDetails').hidden=!draft.rawText;updateRecordDerived();
  }catch(error){
    if(!live())return;if(!draft.objectUrl)draft.source='manual';$('recognitionStatus').dataset.state='error';$('recognitionMessage').textContent=error.message||'这张截图暂未识别成功，可手动填写后保存。';
    if(draft.objectUrl&&!draft.blob){try{const prepared=await RaceOCR.prepareImage(file,draft.controller.signal);if(live())draft.blob=prepared.previewBlob}catch{}}
  }finally{if(live()){$('saveRecordButton').disabled=false;$('ocrProgress').hidden=true}}
}
async function saveRecord(event){
  event.preventDefault();const draft=recordDraft,epoch=accountEpoch,store=recordsStore;if(!draft||draft.owner!==activeProfileId)return;
  $('recordError').hidden=true;
  const fail=message=>{throw new Error(message)};
  if(draft.saving)return;
  try{
    const distance=Number($('recordDistance').value),seconds=parseTimeInput($('recordTime').value),date=$('recordDate').value,effort=$('recordEffort').value;
    if(![10,21.0975,42.195].includes(distance))fail('请选择 10 公里、半马或全马成绩。');
    if(!seconds||seconds/distance<120||seconds/distance>1200)fail('请按 HH:MM:SS 核对实际用时；不接受明显异常的配速。');
    if(!parseBenchmarkDate(date)||date>dateKey(new Date()))fail('请填写真实的成绩日期，不能在未来。');
    if(!['race','time_trial','training'].includes(effort))fail('请确认这次是比赛、全力测试还是日常训练。');
    const numberOrNull=id=>$(id).value===''?null:Number($(id).value),average=numberOrNull('recordAverageHr'),peak=numberOrNull('recordPeakHr');
    if(average!==null&&(!Number.isFinite(average)||average<50||average>230))fail('平均心率请填写 50–230 bpm，或留空。');
    if(peak!==null&&(!Number.isFinite(peak)||peak<50||peak>240))fail('本次最高心率请填写 50–240 bpm，或留空。');
    if(average!==null&&peak!==null&&average>peak)fail('平均心率不能高于本次最高心率，请核对截图。');
    const record={...(draft.record||{}),id:draft.id,profileId:draft.owner,distanceKm:distance,elapsedSeconds:seconds,date,averageHr:average,peakHr:peak,effort,confirmed:true,include:$('recordInclude').checked,durationType:$('recordDurationType').value,course:$('recordCourse').value,source:draft.source,filename:draft.filename||draft.record?.filename||'',fingerprint:draft.fingerprint,rawText:draft.rawText,recognitionConfidence:draft.confidence??draft.record?.recognitionConfidence??null,hasImage:Boolean(draft.blob||draft.record?.hasImage),updatedAt:new Date().toISOString()};
    const existing=recordsStore.list(draft.owner),duplicate=existing.find(item=>item.id!==draft.id&&((record.fingerprint&&item.fingerprint===record.fingerprint)||(item.date===date&&Number(item.distanceKm)===distance&&Number(item.elapsedSeconds)===seconds)));
    if(duplicate)fail('这个档案已经有同一张截图或同一次成绩，请编辑原记录，避免重复计算。');
    $('saveRecordButton').disabled=true;draft.saving=true;setRecordSaving(true);
    saveProfileForm();clearTimeout(cloudSaveTimer);
    await store.put(draft.owner,record,draft.blob?{recordId:draft.id,blob:draft.blob,filename:'race-result.jpg'}:undefined);
    if(epoch!==accountEpoch||recordDraft!==draft||activeProfileId!==draft.owner)return;
    draft.saving=false;cancelRecordDraft();loadRecords();renderRecords();updatePersonalSummary();render();toast(storageMode==='guest'?'试用成绩已用于评估，仅保留在当前页面。':recordUsable(record)?'成绩与截图已保存到云端，当前能力建议已更新。':'成绩已保存到云端；可比的比赛 / 全力测试记录才用于能力评估。');
  }catch(error){
    if(epoch===accountEpoch&&recordDraft===draft){$('recordError').textContent=error.message;$('recordError').hidden=false}
  }finally{draft.saving=false;if(epoch===accountEpoch){setRecordSaving(false);if(recordDraft===draft)$('saveRecordButton').disabled=false}}
}
async function deleteRecord(id){
  const owner=activeProfileId,epoch=accountEpoch,store=recordsStore,record=currentRecords.find(item=>item.id===id);if(!record)return;
  if(!confirm(`删除本档案 ${record.date} 的${recordName(record.distanceKm)}成绩及截图？`))return;
  try{await store.remove(owner,id);if(epoch===accountEpoch&&owner===activeProfileId){loadRecords();renderRecords();updatePersonalSummary();render();toast(savedMessage('已从当前云端档案移除成绩及截图。','已从当前试用档案移除成绩及截图。'))}}catch(error){if(epoch===accountEpoch)storageError(error.message)}
}

function hasUnsavedChanges(){return cloud.hasUnsaved()||Boolean(savedGuestClient?.hasUnsaved()||recordDraft?.dirty||recordDraft?.saving||importBusy)}
function setEditingEnabled(enabled){
  document.querySelectorAll('#plannerForm input, #plannerForm select, #plannerForm button').forEach(element=>{element.disabled=!enabled});
}
function setRecordSaving(saving){
  ['closeRecordDialog','cancelRecordButton','saveRecordButton'].forEach(id=>$(id).disabled=saving);
  document.querySelectorAll('#recordForm input, #recordForm select').forEach(element=>{element.disabled=saving});
  $('profileSelect').disabled=saving||profileSwitching||!cloudReady;$('addProfileButton').disabled=saving||profileSwitching||!cloudReady;
}
function updateStorageCopy(){
  const guest=storageMode==='guest';
  $('profileStorageHint').textContent=guest?'各试用档案相互独立，仅在当前页面暂存。登录邮箱后可另存到云端。':'各档案独立保存到云端，登录同一邮箱可跨设备使用。';
  $('recordStorageHint').textContent=guest?'截图在当前设备识别，不发送给第三方识别服务。试用成绩仅在当前页面，登录后可保存到云端。':'截图在当前设备识别；确认后将截图与成绩保存到当前云端档案，不发送给第三方识别服务。';
  $('saveRecordButton').textContent=guest?'确认数据并用于评估':'确认数据并保存';
  $('cloudStorageHint').textContent=guest?' · 刷新或关闭后会丢失':' · 比赛、成绩、截图和打卡自动保存到云端';
  $('cloudSignOut').hidden=!providerUser();
}
function updateCloudStatus(info){
  if(info.profileId&&info.profileId!==activeProfileId)return;
  updateStorageCopy();
  if(storageMode==='guest'){
    $('cloudBanner').dataset.state='guest';$('cloudState').textContent=emailEnabled()?'公开试用 · 登录邮箱后可保存到云端':'公开试用 · 邮箱云服务尚未接通';
    $('cloudIdentity').textContent='试用资料仅在当前页面';$('cloudRetry').hidden=true;$('cloudReload').hidden=true;$('cloudSignIn').hidden=false;
    $('cloudSignIn').textContent=providerUser()?'重新连接云端':emailEnabled()?'邮箱登录保存':'了解云端保存';
    if(info.error)storageError(info.error.message);
    return;
  }
  const status=info.status||'loading',labels={loading:'正在读取云端档案…',dirty:'有修改尚未保存，正在等待同步…',saving:'正在保存到云端…',saved:'已保存到云端',error:'云端保存失败，修改仍保留在当前页面',conflict:'云端已有更新，当前草稿未覆盖云端',unauthorized:'请登录邮箱后读取和保存档案'};
  const message=info.error?.message||labels[status]||labels.loading;
  $('cloudBanner').dataset.state=status;$('cloudState').textContent=message+(status==='error'&&info.error?.source==='action'?' 请重新执行刚才的操作以重试。':'');
  $('cloudRetry').hidden=!(status==='dirty'||(status==='error'&&(!cloudReady||info.retryable)));$('cloudRetry').textContent=cloudReady?'重试保存':'重新连接';$('cloudReload').hidden=!cloudReady;$('cloudReload').disabled=status==='saving';$('cloudSignIn').hidden=status!=='unauthorized';$('cloudSignIn').textContent='邮箱登录保存';
  if(status==='saved'){$('storageStatus').hidden=true}else if(info.error)storageError(info.error.message);
}
function clearAccountView(){
  if($('profileDialog').open)$('profileDialog').close();$('profileName').value='';profileSwitching=false;importBusy=false;$('createProfileSubmit').disabled=false;$('trialImportError').hidden=true;
  clearTimeout(cloudSaveTimer);clearTimeout(formUpdateTimer);cancelRecordDraft(true);$('recordForm').reset?.();profiles=[];activeProfileId='default';currentRecords=[];checkins={};activeCheckinKey='';activePlanStartDate='';lastAssessment=null;lastAssessmentInput=null;
  profileFieldIds.forEach(id=>{$(id).value=defaultProfileForm[id]??''});
  $('profileSelect').replaceChildren();$('recordList').replaceChildren();$('recordCount').textContent='0';$('abilityPanel').hidden=true;$('riskAssessment').hidden=true;$('templatePanel').hidden=true;$('phaseRow').innerHTML='';
  $('weekList').innerHTML='<div class="empty-state">正在准备训练档案…</div>';$('summaryTitle').textContent='正在准备训练档案';$('summaryCopy').textContent='';$('storageStatus').hidden=true;
  ['finishTime','weeksMetric','daysMetric','peakMetric','longMetric','qualityMetric','planCompletionMetric','planCompletionDetail'].forEach(id=>$(id).textContent='—');$('planCompletionBar').style.width='0%';
}
async function startGuest(options={}){
  cloudReady=false;cloudBooting=false;setEditingEnabled(false);clearAccountView();storageMode='guest';
  cloud=options.client||GuestStore.createClient({onStatus:updateCloudStatus});recordsStore=ProfileStore.createStore(cloud);profiles=cloud.profiles();
  if(!profiles.length){await cloud.create({id:'default',name:'我的试用档案',data:{form:{...defaultProfileForm},records:[],plans:{},history:[]}});profiles=cloud.profiles()}
  activeProfileId=profiles.some(p=>p.id===options.profileId)?options.profileId:profiles[0].id;
  cloudReady=true;renderProfileOptions();loadProfileForm(activeProfileId);setEditingEnabled(true);updateDistanceMode();render();if(!options.client)cloud.markBaseline();
  updateCloudStatus({status:'guest'});updateTrialImport();
}
async function startCloud(epoch=accountEpoch){
  if(cloudBooting)return;cloudBooting=true;cloudReady=false;setEditingEnabled(false);updateDistanceMode();updateCloudStatus({status:'loading'});
  const accountClient=cloud;
  try{
    const session=await accountClient.session();if(epoch!==accountEpoch)return false;
    if(!session.user||session.user.id!==currentUserId)throw new Error('登录身份已变化，请重新连接云端。');
    let loadedProfiles=session.profiles;
    if(!loadedProfiles.length){
      try{await accountClient.create({id:'default',name:'我的档案',data:{form:{...defaultProfileForm},records:[],plans:{},history:[]}});loadedProfiles=accountClient.profiles()}
      catch(error){if(error.code!=='profile_exists')throw error;loadedProfiles=(await accountClient.session()).profiles}
    }
    if(epoch!==accountEpoch)return false;
    const chosen=loadedProfiles[0].id;if(!accountClient.isLoaded(chosen))await accountClient.load(chosen);if(epoch!==accountEpoch)return false;
    profiles=loadedProfiles;$('cloudIdentity').textContent=session.user.email||session.user.displayName||'已登录';
    cloudReady=true;renderProfileOptions();loadProfileForm(chosen);setEditingEnabled(true);updateDistanceMode();render();updateCloudStatus({profileId:chosen,...accountClient.status(chosen)});updateTrialImport();return true;
  }finally{if(epoch===accountEpoch)cloudBooting=false}
}
async function activateCloud(user){
  if(!user?.id)return;
  if(storageMode==='guest'&&recordDraft?.dirty){storageError('邮箱已登录。请先确认或取消当前成绩，再点击“重新连接云端”。试用资料仍保留。');updateCloudStatus({status:'guest'});return}
  if(storageMode==='cloud'&&currentUserId===user.id&&cloudReady)return;
  if(authActivationPromise&&activationUserId===user.id)return authActivationPromise;
  const priorGuest=storageMode==='guest'?cloud:null,priorProfile=activeProfileId;
  if(priorGuest){saveProfileForm();savedGuestClient=priorGuest}
  else if(currentUserId&&currentUserId!==user.id){savedGuestClient?.clear();savedGuestClient=null;trialImports.clear()}
  const epoch=++accountEpoch;currentUserId=user.id;activationUserId=user.id;cloudBooting=false;cloudReady=false;clearAccountView();storageMode='cloud';cloud=makeCloudClient(user.id);recordsStore=ProfileStore.createStore(cloud);setEditingEnabled(false);
  authActivationPromise=(async()=>{
    try{await startCloud(epoch)}
    catch(error){
      if(epoch!==accountEpoch)return;
      const guest=priorGuest||savedGuestClient;savedGuestClient=null;
      await startGuest({client:guest,profileId:priorProfile});
      storageError('邮箱已登录，但云端资料暂时无法读取：'+error.message+' 试用资料仍在当前页面。');
      toast('云端连接未完成，可以继续试用或重试连接。');
    }finally{if(epoch===accountEpoch){authActivationPromise=null;activationUserId=null;updateTrialImport()}}
  })();return authActivationPromise;
}
function updateTrialImport(){
  const available=savedGuestClient?.profiles()||[];
  $('trialImport').hidden=storageMode!=='cloud'||!available.length||!savedGuestClient?.hasUnsaved();
  const previous=$('trialProfileSelect').value;$('trialProfileSelect').replaceChildren();
  available.forEach(profile=>{const option=document.createElement('option');option.value=profile.id;option.textContent=profile.name;$('trialProfileSelect').appendChild(option)});
  if(available.some(p=>p.id===previous))$('trialProfileSelect').value=previous;
  $('importTrialButton').disabled=importBusy||!cloudReady;$('trialProfileSelect').disabled=importBusy;
}
async function importTrial(){
  if(importBusy||storageMode!=='cloud'||!cloudReady||!savedGuestClient)return;
  const sourceId=$('trialProfileSelect').value;if(!sourceId)return;
  const accountClient=cloud,epoch=accountEpoch,snapshot=savedGuestClient.exportProfile(sourceId),id=trialImports.get(sourceId)||uniqueId('profile');trialImports.set(sourceId,id);
  importBusy=true;profileSwitching=true;setEditingEnabled(false);$('cloudSignOut').disabled=true;$('trialImportError').hidden=true;updateTrialImport();
  try{
    saveProfileForm();clearTimeout(cloudSaveTimer);await accountClient.flush(activeProfileId);if(epoch!==accountEpoch)throw new Error('登录身份已变化，上传已停止。');
    const data=GuestStore.remapProfile(snapshot,id),name=(snapshot.profile.name+' · 试用导入').slice(0,80);
    try{await accountClient.create({id,name,data})}catch(error){if(error.code!=='profile_exists')throw error;await accountClient.load(id,{discard:true})}
    if(epoch!==accountEpoch)throw new Error('登录身份已变化，上传已停止。');
    for(const image of snapshot.images){
      if(accountClient.getData(id).records.some(r=>r.id===image.recordId&&r.hasImage))continue;
      await accountClient.commit(id,value=>{const record=value.records.find(r=>r.id===image.recordId);if(!record)throw new Error('导入档案的成绩已变化，请重新读取后核对。');record.hasImage=true;return value},image);
      if(epoch!==accountEpoch)throw new Error('登录身份已变化，上传已停止。');
    }
    savedGuestClient.dropProfile(sourceId);trialImports.delete(sourceId);profiles=cloud.profiles();renderProfileOptions();loadProfileForm(id);updateDistanceMode();render();updateCloudStatus({profileId:id,...cloud.status(id)});
    toast('试用资料已另存为新的云端档案。');
  }catch(error){if(epoch===accountEpoch){$('trialImportError').textContent='尚未全部保存：'+error.message+' 试用原稿仍保留，可重试。';$('trialImportError').hidden=false;profiles=cloud.profiles();renderProfileOptions()}}
  finally{if(epoch===accountEpoch){importBusy=false;profileSwitching=false;$('cloudSignOut').disabled=false;setEditingEnabled(cloudReady);updateTrialImport()}}
}
function loginMessage(message,isError=false){$('loginMessage').textContent=message;$('loginMessage').dataset.error=String(isError);$('loginMessage').hidden=!message}
function updateCodeButton(){
  clearTimeout(otpTimer);const seconds=Math.max(0,Math.ceil((otpResendAt-Date.now())/1000));
  $('sendCodeButton').disabled=authBusy||seconds>0;$('sendCodeButton').textContent=authBusy?'正在发送…':seconds?`${seconds} 秒后可重发`:otpEmail?'重新发送验证码':'发送验证码';
  if(seconds&&$('loginDialog').open)otpTimer=setTimeout(updateCodeButton,1000);
}
function setAuthBusy(busy){
  authBusy=busy;$('loginEmail').disabled=busy;$('loginCode').disabled=busy;$('verifyCodeButton').disabled=busy;$('closeLoginDialog').disabled=busy;$('continueTrialButton').disabled=busy;$('verifyCodeButton').textContent=busy?'正在验证…':'验证并登录';updateCodeButton();
  if(!busy&&(authChangePending||(providerUser()?.id||null)!==currentUserId))return reconcileAuthState();
}
function reconcileAuthState(){
  if(authBusy){authChangePending=true;return Promise.resolve()}
  authChangePending=false;const user=providerUser();
  if((user?.id||null)===currentUserId)return Promise.resolve();
  clearTimeout(otpTimer);otpEmail='';otpResendAt=0;$('loginCode').value='';$('loginEmail').value='';if($('loginDialog').open)$('loginDialog').close();
  if(user)return activateCloud(user);
  ++accountEpoch;currentUserId=null;activationUserId=null;authActivationPromise=null;savedGuestClient?.clear();savedGuestClient=null;trialImports.clear();
  return startGuest().then(()=>toast('邮箱登录已结束，当前页面已切换为新的试用档案。'));
}
function openLogin(){
  if(providerUser()&&!(storageMode==='cloud'&&$('cloudBanner').dataset.state==='unauthorized')){activateCloud(providerUser());return}
  const enabled=emailEnabled();$('loginUnavailable').hidden=enabled;$('sendCodeForm').hidden=!enabled;$('verifyCodeForm').hidden=!enabled||!otpEmail;loginMessage('');
  $('loginDialog').showModal();updateCodeButton();if(enabled)$('loginEmail').focus();else $('continueTrialButton').focus();
}
function closeLogin(){if(authBusy)return;clearTimeout(otpTimer);$('loginDialog').close()}
async function sendCode(event){
  event.preventDefault();if(authBusy||!emailEnabled()||Date.now()<otpResendAt)return;
  const field=$('loginEmail');if(!field.reportValidity())return;const email=field.value.trim();setAuthBusy(true);loginMessage('正在发送验证码…');
  try{await XunxuCloud.sendCode(email);otpEmail=email;otpResendAt=Date.now()+60000;$('verifyCodeForm').hidden=false;$('loginCode').value='';$('codeEmailHint').textContent='验证码已发送至 '+email+'，也请检查垃圾邮件。';loginMessage('验证码已发送。请在邮件有效期内输入。')}
  catch(error){loginMessage(error.message||'验证码发送失败，请稍后重试。',true)}
  finally{await setAuthBusy(false);if(otpEmail)$('loginCode').focus()}
}
async function resumeCloudAfterReauth(){
  const client=cloud,owner=activeProfileId,epoch=accountEpoch,state=client.status(owner),pendingAction=state.error?.source==='action'||Boolean(recordDraft?.dirty);
  if(state.dirty){
    try{await client.flush(owner)}
    catch(error){if(epoch===accountEpoch)updateCloudStatus({profileId:owner,...client.status(owner)});return '邮箱已重新验证，修改仍未保存。请按页面提示重试。'}
  }
  if(epoch!==accountEpoch)return '登录身份已变化，正在重新读取档案。';
  if(pendingAction){
    const error=Object.assign(new Error('邮箱已重新验证。刚才未完成的操作仍需重新执行，请重新确认成绩或再次打卡。'),{source:'action'});
    updateCloudStatus({profileId:owner,status:'error',error,retryable:false});return '邮箱已重新验证，请重新执行刚才未完成的操作。';
  }
  updateCloudStatus({profileId:owner,...client.status(owner)});return state.dirty?'邮箱已重新验证，待保存的资料已同步到云端。':'邮箱已重新验证，当前档案和修改已保留。';
}
async function verifyCode(event){
  event.preventDefault();if(authBusy||!emailEnabled()||!otpEmail)return;if(!$('loginCode').reportValidity())return;
  setAuthBusy(true);loginMessage('正在验证邮箱…');
  try{
    const user=await XunxuCloud.verifyCode(otpEmail,$('loginCode').value.trim());let message;
    if(storageMode==='cloud'&&cloudReady&&currentUserId===user.id)message=await resumeCloudAfterReauth();
    else{await activateCloud(user);message=storageMode==='cloud'?'邮箱登录成功，已读取你的云端档案。':'邮箱已验证，可继续试用并重试连接云端。'}
    $('loginCode').value='';$('loginDialog').close();clearTimeout(otpTimer);toast(message);
  }catch(error){loginMessage(error.message||'验证码无效或已过期，请重新发送。',true)}
  finally{await setAuthBusy(false)}
}
async function signOut(){
  if(authBusy||importBusy)return;
  if(hasUnsavedChanges()&&!confirm('退出将清除当前页面尚未保存的资料和试用草稿。已经保存到云端的资料仍然保留。确定退出？'))return;
  authBusy=true;$('cloudSignOut').disabled=true;setEditingEnabled(false);
  try{
    await XunxuCloud.signOut();++accountEpoch;currentUserId=null;activationUserId=null;authActivationPromise=null;savedGuestClient?.clear();savedGuestClient=null;trialImports.clear();otpEmail='';otpResendAt=0;$('loginEmail').value='';$('loginCode').value='';
    if(storageMode==='guest')cloud.clear();await startGuest();toast('已退出账号，云端资料已从当前页面清除。');
  }catch(error){storageError(error.message);setEditingEnabled(cloudReady)}
  finally{authBusy=false;$('cloudSignOut').disabled=false;await reconcileAuthState();updateStorageCopy()}
}
async function startPublicApp(){
  await startGuest();
  if(!cloudConfigured())return;
  try{const user=await XunxuCloud.init();if(user)await activateCloud(user)}catch(error){storageError('暂时无法恢复邮箱登录：'+error.message+' 你可以继续试用。')}
  XunxuCloud.onAuthChange(()=>{reconcileAuthState().catch(error=>storageError(error.message))});
}
async function switchProfile(next){
  if(!cloudReady||profileSwitching||next===activeProfileId)return;
  const previous=activeProfileId,client=cloud,epoch=accountEpoch;profileSwitching=true;setEditingEnabled(false);
  try{
    saveProfileForm();clearTimeout(cloudSaveTimer);await client.flush(previous);if(epoch!==accountEpoch)return;cancelRecordDraft();await client.load(next);if(epoch!==accountEpoch)return;
    loadProfileForm(next);updateDistanceMode();render();updateCloudStatus({profileId:next,...client.status(next)});
  }catch(error){if(epoch===accountEpoch){$('profileSelect').value=previous;storageError(error.message);updateCloudStatus({status:error.code==='conflict'?'conflict':error.status===401?'unauthorized':'error',error})}}
  finally{if(epoch===accountEpoch){profileSwitching=false;setEditingEnabled(cloudReady)}}
}
async function reloadCloud(){
  if(storageMode==='guest')return;if(!cloudReady)return activateCloud(providerUser());if(profileSwitching)return;
  if((cloud.hasUnsaved()||recordDraft?.dirty)&&!confirm('重新读取将放弃当前页面尚未保存的修改，使用云端最新版本。是否继续？'))return;
  const client=cloud,owner=activeProfileId,epoch=accountEpoch;clearTimeout(cloudSaveTimer);clearTimeout(formUpdateTimer);profileSwitching=true;setEditingEnabled(false);
  try{await client.load(owner,{discard:true});if(epoch!==accountEpoch)return;cancelRecordDraft();loadProfileForm(owner);updateDistanceMode();render();updateCloudStatus({profileId:owner,...client.status(owner)});toast('已读取云端最新资料。')}
  catch(error){if(epoch===accountEpoch){storageError(error.message);updateCloudStatus({status:'error',error})}}
  finally{if(epoch===accountEpoch){profileSwitching=false;setEditingEnabled(cloudReady)}}
}

// Boot and explicit UI events. Changing profiles cancels any unconfirmed upload.
$('profileSelect').addEventListener('change',()=>switchProfile($('profileSelect').value));
$('addProfileButton').addEventListener('click',()=>{if(!cloudReady)return;$('profileName').value='';$('profileName').setCustomValidity('');$('profileDialog').showModal();$('profileName').focus()});
$('cancelProfileButton').addEventListener('click',()=>$('profileDialog').close());$('profileName').addEventListener('input',()=>$('profileName').setCustomValidity(''));
$('profileForm').addEventListener('submit',event=>{event.preventDefault();createProfile()});
$('plannerForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!cloudReady)return;focusValidation=true;clearTimeout(formUpdateTimer);saveProfileForm();updatePersonalSummary();render();focusValidation=false;
  clearTimeout(cloudSaveTimer);try{await cloud.flush(activeProfileId);if($('generationStatus').textContent.startsWith('已更新'))$('summaryTitle').scrollIntoView({behavior:'smooth',block:'start'})}catch{}
});
profileFieldIds.forEach(id=>{
  const update=()=>{if(!cloudReady)return;clearTimeout(formUpdateTimer);saveProfileForm();if(id==='distance')updateDistanceMode();updatePersonalSummary();render()};
  $(id).addEventListener('change',update);
  if($(id).tagName==='INPUT')$(id).addEventListener('input',()=>{if(!cloudReady)return;saveProfileForm();const owner=activeProfileId,epoch=accountEpoch;clearTimeout(formUpdateTimer);formUpdateTimer=setTimeout(()=>{if(epoch===accountEpoch&&owner===activeProfileId){updatePersonalSummary();render()}},350)});
});
document.querySelectorAll('[data-tab]').forEach(button=>{button.addEventListener('click',()=>selectSetupTab(button.dataset.tab));button.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const keys=['race','records','personal'],current=keys.indexOf(button.dataset.tab),next=event.key==='Home'?0:event.key==='End'?2:(current+(event.key==='ArrowRight'?1:2))%3;selectSetupTab(keys[next]);$('tab-'+keys[next]).focus()})});
$('openRecords').addEventListener('click',()=>selectSetupTab('records'));
$('uploadButton').addEventListener('click',()=>$('screenshotInput').click());$('screenshotInput').addEventListener('change',event=>handleUpload(event.target.files?.[0]));
$('uploadZone').addEventListener('dragover',event=>{event.preventDefault();$('uploadZone').classList.add('dragging')});$('uploadZone').addEventListener('dragleave',()=>$('uploadZone').classList.remove('dragging'));
$('uploadZone').addEventListener('drop',event=>{event.preventDefault();$('uploadZone').classList.remove('dragging');if(event.dataTransfer.files.length>1){toast('请逐张上传，以便核对每次成绩。');return}handleUpload(event.dataTransfer.files[0])});
$('manualRecordButton').addEventListener('click',()=>{if(cloudReady)freshRecordDraft()});$('cancelRecordButton').addEventListener('click',cancelRecordDraft);$('closeRecordDialog').addEventListener('click',cancelRecordDraft);
$('recordDialog').addEventListener('cancel',event=>{event.preventDefault();cancelRecordDraft()});$('recordForm').addEventListener('submit',saveRecord);$('recordForm').addEventListener('input',()=>{if(recordDraft)recordDraft.dirty=true});$('recordForm').addEventListener('change',()=>{if(recordDraft)recordDraft.dirty=true});
['recordDistance','recordTime'].forEach(id=>$(id).addEventListener('input',updateRecordDerived));
$('recordList').addEventListener('click',event=>{const edit=event.target.closest('[data-record-edit]'),remove=event.target.closest('[data-record-delete]');if(edit)editRecord(edit.dataset.recordEdit);if(remove)deleteRecord(remove.dataset.recordDelete)});
$('weekList').addEventListener('click',async event=>{
  const button=event.target.closest('.checkin');if(!button||button.disabled||!cloudReady||profileSwitching)return;
  const owner=activeProfileId,client=cloud,epoch=accountEpoch,planKey=activeCheckinKey,date=button.dataset.date,completed=button.getAttribute('aria-pressed')!=='true';button.disabled=true;
  try{
    await client.commit(owner,data=>{const plan=data.plans[planKey];if(!plan)throw new Error('请先保存训练计划后再打卡。');if(completed)plan.checkins[date]=true;else delete plan.checkins[date];return data;});
    if(epoch!==accountEpoch||owner!==activeProfileId||planKey!==activeCheckinKey)return;
    checkins={...cloud.getData(owner).plans[planKey].checkins};button.setAttribute('aria-pressed',String(completed));button.classList.toggle('done',completed);button.closest('.day')?.classList.toggle('completed',completed);button.textContent=completed?'已完成':'打卡';updateCheckinProgress();
    if(lastAssessmentInput){lastAssessmentInput.adherence=readAdherence();lastAssessment=RunningAssessment.evaluate(lastAssessmentInput);renderGoalRisk(lastAssessment)}
  }catch(error){if(epoch===accountEpoch)storageError(error.message)}finally{button.disabled=false}
});
$('cloudRetry').addEventListener('click',async()=>{if(!cloudReady)return activateCloud(providerUser());clearTimeout(cloudSaveTimer);try{await cloud.flush(activeProfileId);updateCloudStatus({profileId:activeProfileId,...cloud.status(activeProfileId)})}catch{}});
$('cloudReload').addEventListener('click',reloadCloud);
$('cloudSignIn').addEventListener('click',openLogin);$('cloudSignOut').addEventListener('click',signOut);
$('closeLoginDialog').addEventListener('click',closeLogin);$('continueTrialButton').addEventListener('click',closeLogin);
$('loginDialog').addEventListener('cancel',event=>{event.preventDefault();closeLogin()});
$('sendCodeForm').addEventListener('submit',sendCode);$('verifyCodeForm').addEventListener('submit',verifyCode);
$('importTrialButton').addEventListener('click',importTrial);

window.addEventListener('beforeunload',event=>{if(hasUnsavedChanges()){event.preventDefault();event.returnValue='';}});
startPublicApp();
