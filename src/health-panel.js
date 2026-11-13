(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.XunxuHealthPanel = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const numeric = (value, min, max) => ['number','string'].includes(typeof value) && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max;
  function validDate(value) {if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(value+'T12:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;}
  const ranges = {weeklyKm:[0,160],longRun:[0,42],restingHr:[30,120],vo2max:[15,90]};

  // Only explicitly reviewed fields are copied. Nothing fabricates HRmax,
  // illness status, record effort or a missing week of exercise.
  function buildFormPatch(report, choices) {
    if (!report || report.source !== 'apple_health' || !report.summary || !report.personal) throw new Error('请先选择并读取有效的 Apple 健康文件。');
    choices = choices || {};
    const selected = new Set(choices.fields || []), patch = {};
    if ([...selected].some(field => !Object.hasOwn(ranges, field))) throw new Error('包含不支持的健康字段。');
    if ((selected.has('weeklyKm') || choices.runDays) && !choices.completeCoverage) throw new Error('应用周跑量和跑步天数前，请确认最近 28 天的跑步记录完整。');
    const values = {weeklyKm:report.summary.weeklyKm,longRun:report.summary.longestRunKm,restingHr:report.personal.restingHr?.value,vo2max:report.personal.vo2max?.value};
    for (const field of selected) {
      const [min,max] = ranges[field];
      if (!numeric(values[field], min, max)) throw new Error('选择的数据缺失或超出支持范围，请取消该项后手动核对。');
      patch[field] = String(Number(Number(values[field]).toFixed(field === 'restingHr' ? 0 : 1)));
    }
    if (selected.has('vo2max')) {
      const date = report.personal.vo2max?.date;
      if (!validDate(date) || !validDate(report.analyzedOn) || date > report.analyzedOn) throw new Error('VO₂max 缺少有效测量日期，暂不能应用。');
      patch.vo2maxSource = 'unknown'; patch.vo2maxDate = date;
    }
    if (choices.runDays) {
      if (!/^[1-7]$/.test(String(choices.runDays))) throw new Error('请选择平常每周跑步的天数。');
      patch.days = String(choices.runDays);
    }
    if (!Object.keys(patch).length) throw new Error('请至少选择一项数据，或先核对下方的历史成绩。');
    return patch;
  }

  function create({dialog, engine, getContext, onApply, onApplied, onReviewCandidate, onStatus}) {
    if (!dialog || !engine || !getContext) return null;
    const doc = dialog.ownerDocument;
    const reports = new Map();
    let current = null, report = null, controller = null, sequence = 0, busy = false, destroyed = false;
    const $ = id => dialog.querySelector('#' + id);
    const valid = () => !destroyed && current && getContext()?.key === current.key;
    const labelValue = (value, unit) => numeric(value,0,10000) ? Number(value).toFixed(Number.isInteger(Number(value)) ? 0 : 1) + ' ' + unit : '未读取到';
    const savedText = () => current?.mode === 'cloud' ? '确认后仅将所选摘要保存到当前云端档案；原始健康文件不上传。' : '确认后仅用于当前试用档案，刷新或关闭后会丢失；原始健康文件不上传。';

    function error(message) { $('healthError').textContent = message; $('healthError').hidden = !message; }
    function stop() { sequence++; controller?.abort(); controller = null; busy = false; }
    function close() { stop(); if (dialog.open) dialog.close(); current = null; report = null; $('healthFile').value = ''; }
    function row(field, title, value, unit, detail, checked) {
      const available = numeric(value, ...ranges[field]);
      const existing = current?.form?.[field];
      return `<label class="health-review-row${available ? '' : ' unavailable'}"><input type="checkbox" data-health-field="${field}" ${available ? checked ? 'checked' : '' : 'disabled'} /><span><strong>${esc(title)}</strong><small>${esc(detail)}${existing ? ` · 当前 ${esc(existing)} ${esc(unit)}` : ''}</small></span><b>${esc(available ? labelValue(value,unit) : '未读取到')}</b></label>`;
    }
    function renderReport() {
      if (!report || !valid()) return;
      const s = report.summary, resting = report.personal.restingHr, vo2 = report.personal.vo2max;
      $('healthReview').hidden = false; $('healthReadProgress').hidden = true;
      $('healthReviewPeriod').textContent = `${report.window.start} — ${report.window.end} · 最近 28 个完整日`;
      $('healthFileSummary').textContent = `读取到 ${s.workoutCount} 次跑步 · ${s.runningDays} 个跑步日；以下为已记录数据，需核对完整性。`;
      $('healthStatDistance').textContent = labelValue(s.weeklyKm,'km / 周');
      $('healthStatDays').textContent = labelValue(s.runDaysPerWeek,'天 / 周');
      $('healthStatLong').textContent = labelValue(s.longestRunKm,'km');
      $('healthFieldChoices').innerHTML =
        row('weeklyKm','近 4 周平均周跑量',s.weeklyKm,'km','应用前确认记录完整；有未记录训练时请手动修正',s.workoutCount > 0) +
        row('longRun','近 30 天最长跑',s.longestRunKm,'km','跑步训练中的最长一次，不包含步行',numeric(s.longestRunKm,0.1,42)) +
        row('restingHr','静息心率',resting?.value,'bpm',resting ? `${resting.date} · ${resting.source}${resting.stale ? ' · 数据较旧，请谨慎应用' : ''}` : '文件中没有近期有效记录',Boolean(resting && !resting.stale)) +
        row('vo2max','VO₂max',vo2?.value,'ml/kg/min',vo2 ? `${vo2.date} · ${vo2.source} · 测量方式待确认${vo2.stale ? ' · 数据较旧' : ''}` : '缺失时不影响目标课表',Boolean(vo2 && !vo2.stale));
      $('healthCoverage').checked = false;
      const days = Number(s.runDaysPerWeek);
      $('healthRunDays').value = Number.isInteger(days) && days >= 1 && days <= 7 ? String(days) : '';
      $('healthRunDaysHint').textContent = `记录周均 ${labelValue(s.runDaysPerWeek,'天')}。如有小数，请按真实常态选择，不自动四舍五入。`;
      const candidates = (report.candidates || []).slice(0,12);
      $('healthCandidates').innerHTML = candidates.length ? candidates.map((item,index) => `<article class="health-candidate"><div><strong>${esc(item.date)} · ${esc(labelValue(item.distanceKm,'km'))}</strong><small>${esc(item.sourceName || 'Apple 健康')} · 待确认比赛 / 测试性质与计时</small></div><button type="button" data-health-candidate="${index}">核对成绩</button></article>`).join('') : '<p class="health-muted">未找到近期可核对的 10 km / 半马记录。可继续上传成绩截图或手动添加。</p>';
      $('healthEvaluationHint').textContent = candidates.length
        ? `为什么仍显示“资料不足”？健康导入已经读取训练基础；目标评估还需要一条近 180 天已确认的 10 km / 半马比赛或全力测试成绩。下面有 ${candidates.length} 条候选记录，点击“核对成绩”，确认比赛性质与完整计时并保存后才会纳入。`
        : '为什么仍显示“资料不足”？这次导入可以补充跑量、最长距离和心率，但无法判断普通训练是否全力或属于比赛。目标评估还需要一条近 180 天已确认的 10 km / 半马比赛或全力测试成绩；请上传比赛截图或手动添加。';
      const warnings = [...(report.warnings || []),...(report.limitations || [])];
      $('healthWarnings').innerHTML = warnings.length ? '<ul>' + warnings.map(message => `<li>${esc(message)}</li>`).join('') + '</ul>' : '';
      $('healthApplyButton').disabled = false; $('healthApplyButton').textContent = '应用所选数据并生成课表';
      $('healthDataDestination').textContent = savedText();
      $('healthStatus').textContent = '读取完成，原始文件未上传。核对后再应用到本档案。';
    }

    function open() {
      if (destroyed) return;
      const context = getContext();
      if (!context?.ready) return;
      stop(); current = {...context}; report = reports.get(context.key)?.report || null;
      $('healthOwner').textContent = context.profileName || '当前档案';
      $('healthReview').hidden = !report; $('healthReadProgress').hidden = true; error('');
      $('healthFile').value = ''; $('healthChooseFile').disabled = false;
      $('healthStatus').textContent = context.healthImport?.appliedAt
        ? `当前档案已有健康数据导入记录（${context.healthImport.analyzedOn || '日期未记录'}）。重新选择文件可更新训练摘要。`
        : '支持中英文文件名；选择健康 ZIP，或解压后的导出.xml / export.xml。';
      $('healthDataDestination').textContent = savedText();
      if (report) renderReport();
      if (!dialog.open) dialog.showModal();
      (report ? $('healthReviewHeading') : $('healthChooseFile')).focus();
    }

    async function read(file) {
      if (!file || !valid() || busy) return;
      stop(); const job = sequence, ownerKey = current.key; controller = new AbortController(); busy = true; report = null;
      $('healthReview').hidden = true; error(''); $('healthReadProgress').hidden = false;
      $('healthStatus').textContent = '正在读取跑步记录与相关健康指标…'; $('healthChooseFile').disabled = true;
      try {
        const next = await engine.readFile(file,{now:current.today,signal:controller.signal,onProgress:progress=>{
          if (job !== sequence || !valid()) return;
          const value = typeof progress === 'number' ? progress : progress?.progress;
          if (Number.isFinite(value)) $('healthStatus').textContent = '正在读取健康文件… ' + Math.min(100,Math.round(value <= 1 ? value * 100 : value)) + '%';
        }});
        if (job !== sequence || !valid() || current.key !== ownerKey) return;
        report = next; reports.set(ownerKey,{report,applied:false}); renderReport();
        $('healthReviewHeading').focus();
      } catch (cause) {
        if (job !== sequence || !valid() || cause.name === 'AbortError') return;
        error(cause.message || '未能读取这个文件，请选择健康 App 导出的 ZIP / XML。');
        $('healthStatus').textContent = '未导入任何数据。'; $('healthReadProgress').hidden = true;
      } finally {
        if (job === sequence && valid()) {busy = false; $('healthChooseFile').disabled = false; $('healthFile').value = '';}
      }
    }

    async function apply() {
      if (!valid() || !report || busy) return;
      const context = {...current}, job = sequence, appliedReport = report;
      const live = () => job === sequence && valid() && current.key === context.key;
      error('');
      try {
        const fields = Array.from(dialog.querySelectorAll('[data-health-field]:checked')).map(input=>input.dataset.healthField);
        const runDays = $('healthRunDays').value;
        const patch = buildFormPatch(report,{fields,completeCoverage:$('healthCoverage').checked,runDays});
        patch.healthImport = {appliedAt:new Date().toISOString(),analyzedOn:report.analyzedOn || report.window?.end || '',fields:[...fields,...(runDays ? ['days'] : [])]};
        busy = true; $('healthApplyButton').disabled = true; $('healthApplyButton').textContent = '正在应用…'; $('healthChooseFile').disabled = true;
        await onApply(patch,context);
        if (!live()) return;
        reports.set(context.key,{report:appliedReport,applied:true,marker:patch.healthImport});
        close(); onStatus?.(); onApplied?.(context);
      } catch (cause) {
        if (live()) error(cause.message || '未能应用健康数据，请重试。');
      } finally {
        if (live()) {busy = false; $('healthApplyButton').disabled = false; $('healthApplyButton').textContent = '应用所选数据并生成课表'; $('healthChooseFile').disabled = false;}
      }
    }

    const listeners = [];
    const on = (element,type,handler) => {element.addEventListener(type,handler);listeners.push(()=>element.removeEventListener(type,handler));};
    on($('closeHealthDialog'),'click',close);
    on(dialog,'cancel',event=>{event.preventDefault();close();});
    on($('healthChooseFile'),'click',()=>$('healthFile').click());
    on($('healthFile'),'change',event=>read(event.target.files?.[0]));
    on($('healthApplyButton'),'click',apply);
    on($('healthCandidates'),'click',event=>{
      const button = event.target.closest('[data-health-candidate]');
      if (!button || !valid() || !report || busy) return;
      const candidate = report.candidates[Number(button.dataset.healthCandidate)], context = {...current};
      if (!candidate) return;
      close(); onReviewCandidate?.(candidate,context);
    });
    return {
      open,
      reset({clearReports=false}={}) {close();if(clearReports)reports.clear();},
      status(key, marker) {
        const entry=reports.get(key),saved=entry?.applied?entry.marker:marker;
        if(saved?.appliedAt){const date=saved.analyzedOn||saved.appliedAt.slice(0,10);return `已导入健康数据 · ${date} · 评估需另核对近期成绩`}
        return entry?'健康文件已读取 · 等待核对应用':'尚未导入 · 选择健康文件并应用后会标记';
      },
      destroy() {close();destroyed=true;reports.clear();listeners.forEach(remove=>remove());}
    };
  }
  return {create,buildFormPatch};
});
