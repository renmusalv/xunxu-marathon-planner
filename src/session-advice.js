/*
 * SessionAdvice — read-only annotations beside the target-based main plan.
 * Difficulty labels are transparent product rules, not calibrated probabilities.
 * This module has no storage or implicit access to any other runner's data.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SessionAdvice = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RUN_KINDS = ['easy', 'quality', 'long', 'race'];
  const LABELS = { unknown: '资料不足', matched: '当前较匹配', challenge: '有挑战', high: '难度较高', hold: '暂缓执行', rest: '恢复日' };
  const RULES = '难度是产品规则参考，不是完成概率：主段比能力建议快约 3% / 7%、单次距离高于近期最长跑约 15% / 35%、周量高于目前约 20% / 50% 时分级提示；它们不是医学安全阈值。';
  const positive = value => value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
  const unique = items => Array.from(new Set(items));
  const validRange = value => Array.isArray(value) && value.length >= 2 && value.every(item => Number.isFinite(item) && item > 0);
  const pace = seconds => { const rounded = Math.round(seconds); return Math.floor(rounded / 60) + ':' + String(rounded % 60).padStart(2, '0'); };
  const paceRange = range => { const a = pace(range[0]), b = pace(range[1]); return (a === b ? a : a + '–' + b) + '/km'; };
  const mid = range => (range[0] + range[1]) / 2;
  const roundKm = km => Math.round(km * 10) / 10;
  const levelFor = severity => severity >= 2 ? 'high' : severity >= 1 ? 'challenge' : 'matched';
  function known(assessment) {
    return positive(assessment.equivalentPace) !== null && assessment.evidence?.count !== 0 && !(assessment.evidence?.newestAgeDays > 180);
  }
  function hasImportedTrainingBase(context) {
    const marker = context.healthImport;
    const fields = ['weeklyKm', 'longRun', 'longestRun', 'days', 'runDays'];
    const imported = marker?.appliedAt && (!Array.isArray(marker.fields) || marker.fields.some(field => fields.includes(field)));
    return Boolean(imported) && ['weeklyKm', 'longestRun', 'runDays'].some(field => {
      const value = context[field];
      return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
    });
  }
  function hold(assessment, context) { return assessment.fit?.hold === true || ['pain', 'illness'].includes(context.personal?.discomfort); }
  function kmRange(session) {
    if (validRange(session.totalKm)) return session.totalKm.slice();
    if (validRange(session.distanceRange)) return session.distanceRange.slice();
    const distance = positive(session.distanceKm ?? session.km);
    return distance === null ? null : [distance, distance];
  }
  function inferredRole(session) {
    if (session.kind === 'race') return 'race';
    if (session.kind === 'long') return 'long';
    if (session.kind === 'easy') return 'easy';
    return session.paceType || 'tempo';
  }
  function segmentsFor(session) {
    return Array.isArray(session.segments) && session.segments.length
      ? session.segments
      : [{ label: session.title || '本课', role: inferredRole(session), distanceKm: positive(session.distanceKm ?? session.km), pace: null }];
  }
  function adviceRole(segment, session) {
    const role = segment.role || inferredRole(session);
    // A 2 km repetition is not a short VO2max interval. Do not apply a 5 km
    // intensity suggestion to these approximately 10-minute repetitions.
    return role === 'interval' && positive(segment.distanceKm) >= 1.5 ? 'tempo' : role;
  }
  function suggestedRange(segment, session, assessment, allSegments) {
    const paces = assessment.paces || {}, role = adviceRole(segment, session);
    if (role === 'race') return positive(assessment.equivalentPace) === null ? null : [assessment.equivalentPace, assessment.equivalentPace];
    if (role === 'steady') {
      if (!validRange(paces.tempo) || !validRange(paces.easy)) return null;
      // An explicitly labelled transition between established advice ranges,
      // not a newly asserted physiological zone. Split repeated steady stages
      // so progressive workouts retain their slower-to-faster ordering.
      const low = Math.min(paces.tempo[1], paces.easy[0]), high = Math.max(paces.tempo[1], paces.easy[0]);
      const values = unique(allSegments.filter(s => adviceRole(s, session) === 'steady' && validRange(s.pace)).map(s => mid(s.pace))).sort((a, b) => a - b);
      const rank = validRange(segment.pace) ? values.indexOf(mid(segment.pace)) : -1;
      if (values.length > 1 && rank >= 0) return [low + (high - low) * rank / values.length, low + (high - low) * (rank + 1) / values.length];
      return [low, high];
    }
    const range = paces[role === 'long' ? 'long' : role];
    return validRange(range) ? range.slice() : null;
  }
  function heartText(session, assessment) {
    const segments = segmentsFor(session), targets = assessment.heartRate?.targets || {};
    const roles = unique(segments.map(segment => adviceRole(segment, session)));
    const format = target => {
      if (!target) return '按交谈与体感控制';
      if (Number.isFinite(target.min) && Number.isFinite(target.max)) return target.min + '–' + target.max + ' bpm';
      if (Number.isFinite(target.max)) return '≤ ' + target.max + ' bpm';
      if (Number.isFinite(target.min)) return '≥ ' + target.min + ' bpm';
      return target.note || '按交谈与体感控制';
    };
    const roleLabel = { easy: '有氧段', long: '有氧段', recovery: '恢复段', steady: '稳定段', tempo: '快段', interval: '间歇段', race: '目标段' };
    const parts = roles.map(role => (roles.length > 1 ? (roleLabel[role] || '本段') + ' ' : '') + format(targets[role]));
    if (segments.some(segment => segment.role === 'interval')) parts.push('间歇心率有滞后，不追数字');
    return unique(parts).join('；');
  }
  function volumeFlags(weeklyRange, current, add) {
    const base = positive(current);
    if (!validRange(weeklyRange) || base === null) return;
    const ratio = weeklyRange[1] / base;
    if (ratio > 1.2) add(ratio > 1.5 ? 2 : 1, '本周目标跑量约 ' + roundKm(weeklyRange[0]) + '–' + roundKm(weeklyRange[1]) + ' km，高于目前 ' + base + ' km/周；需先建立相应基础。');
  }
  function foundationFlags(context, add) {
    const missing = [], zero = [];
    [['weeklyKm', '目前周跑量'], ['longestRun', '近 30 天最长跑']].forEach(([field, label]) => {
      const raw = context[field];
      const absent = raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '') || !Number.isFinite(Number(raw)) || Number(raw) < 0;
      if (absent) missing.push(label);
      else if (Number(raw) === 0) zero.push(label);
    });
    if (zero.length) add(2, zero.join('、') + '填写为 0，尚无稳定的近期跑步基础；执行目标跑步课难度较高，需先建立基础。');
    if (missing.length) add(0, missing.join('、') + '尚未填写；当前只能比较配速与已填项目，训练基础仍待补充，不能确认整体匹配。');
    return { missing: missing.length > 0, zero: zero.length > 0, missingFields: missing, zeroFields: zero };
  }
  function result(level, reasons, extras) {
    const list = unique(reasons);
    return { level, label: LABELS[level], reason: list.slice(0, 3).join(' '), reasons: list, paceText: '', paceLines: [], heartText: '', notes: [RULES], confidence: 'low', ...extras };
  }
  function forSession(session, assessment, context) {
    session = session || {}; assessment = assessment || {}; context = context || {};
    if (session.kind === 'rest') return result('rest', ['按目标课表休息，不补课。'], { notes: [], confidence: 'not_applicable' });
    if (hold(assessment, context)) return result('hold', ['当前记录了疼痛、疾病或恢复问题；先处理恢复，再决定是否执行。主课表仍作为目标参考保留。'], { paceText: '恢复后再评估个人建议配速', notes: [RULES], confidence: assessment.evidence?.confidence || 'low' });
    if (session.kind === 'strength') return result('matched', ['采用中低负荷，以动作质量和恢复状态为准；不练至酸痛。'], { label: '按状态激活', notes: [], confidence: 'not_applicable' });
    let severity = 0;
    const reasons = [], notes = [RULES], add = (rank, text) => { severity = Math.max(severity, rank); reasons.push(text); };
    const segments = segmentsFor(session), hasAbility = known(assessment), ranges = segments.map(segment => suggestedRange(segment, session, assessment, segments));
    const confidence = assessment.evidence?.confidence || 'low';
    const foundation = foundationFlags(context, add);
    if (hasAbility) {
      let worstGap = 0, worstRecoveryGap = 0, continuousHardMinutes = 0;
      segments.forEach((segment, index) => {
        const personal = ranges[index];
        if (!personal || !validRange(segment.pace)) return;
        const gap = Math.max(0, (personal[0] - mid(segment.pace)) / personal[0]);
        if (segment.role === 'recovery') worstRecoveryGap = Math.max(worstRecoveryGap, gap);
        else worstGap = Math.max(worstGap, gap);
        if (['tempo', 'interval'].includes(adviceRole(segment, session))) {
          const distance = positive(segment.distanceKm) || (validRange(segment.distanceRange) ? segment.distanceRange[1] : 0);
          const minutes = distance * mid(personal) / 60;
          continuousHardMinutes = Math.max(continuousHardMinutes, minutes);
        }
      });
      if (worstGap > 0.03) add(worstGap > 0.07 ? 2 : 1, '目标主段比当前能力建议的较快端还快约 ' + Math.round(worstGap * 100) + '%，可按下方个人建议执行。');
      if (worstRecoveryGap > 0.03) add(1, '目标组间恢复配速偏快；按当前能力建议放慢恢复段，避免持续累积强度。');
      if (continuousHardMinutes > 45) add(continuousHardMinutes > 60 ? 2 : 1, '本课连续较高强度段按当前能力约需 ' + Math.round(continuousHardMinutes) + ' 分钟，对专项耐力要求较高。');
    }
    const distance = kmRange(session), longest = positive(context.longestRun);
    if (distance && longest !== null) {
      if (session.kind !== 'race' && distance[1] / longest > 1.15) add(distance[1] / longest > 1.35 ? 2 : 1, '本课约 ' + roundKm(distance[0]) + (distance[1] !== distance[0] ? '–' + roundKm(distance[1]) : '') + ' km，高于近 30 天最长跑 ' + longest + ' km；需先确认长跑基础。');
      if (session.kind === 'race' && longest < distance[1] * 0.6) add(longest < distance[1] * 0.4 ? 2 : 1, '近 30 天最长跑 ' + longest + ' km，比赛专项耐力准备仍需补足。');
    }
    volumeFlags(context.weekTotalKm || context.weekKm, context.weeklyKm, add);
    const requiredDays = positive(context.requiredRunDays), availableDays = positive(context.runDays);
    if (requiredDays !== null && availableDays !== null && requiredDays > availableDays) add(1, '这一周安排 ' + requiredDays + ' 次跑步，高于填写的每周 ' + availableDays + ' 天；需评估时间与恢复安排。');
    if (context.personal?.recentConsistency === 'restarting') add(1, '近期刚恢复训练，当前难度参考需结合恢复进展重新评估。');
    if (context.personal?.recentConsistency === 'interrupted') add(1, '近期训练有中断，需要观察连续训练和恢复情况。');
    if (!hasAbility) {
      if (!hasImportedTrainingBase(context)) {
        reasons.unshift(assessment.evidence?.newestAgeDays > 180 ? '有效成绩已超过 180 天，不能据此判断目前完成难度。' : '尚无可用于当前能力估算的近期实绩；请确认 10 km 或半马成绩。');
        return result('unknown', reasons, { paceText: '待补充近期成绩', heartText: heartText(session, assessment), notes, confidence });
      }
      const level = levelFor(severity), incomplete = foundation.missing;
      reasons.unshift('依据个人周跑量、近 30 天最长跑和训练频率比较本课负荷；近期比赛或全力测试成绩未确认，因此暂不判断个人配速能力。');
      if (incomplete) reasons.push('训练基础还缺少' + foundation.missingFields.join('、') + '，当前结论仅供参考。');
      return result(incomplete ? 'unknown' : level, reasons, {
        label: incomplete ? '训练基础待补全 · ' + LABELS[level] : '训练基础 · ' + LABELS[level],
        paceText: '个人配速待确认；按交谈与体感控制', heartText: heartText(session, assessment),
        notes: notes.concat('导入的训练跑量与最长跑直接用于本课负荷比较；确认比赛或全力测试成绩后，才会补充个人配速建议。'), confidence: 'low'
      });
    }
    if (segments.some(s => s.role === 'interval' && positive(s.distanceKm) >= 1.5)) notes.push('2 km 长重复段使用当前节奏能力作为个人建议，不套用短间歇的 5 km 强度；目标课表组数和配速不变。');
    if (segments.some(s => s.role === 'steady')) notes.push('稳定段为当前轻松与节奏建议之间的经验过渡范围；多段保持逐渐加速。');
    if (confidence === 'low') notes.push('能力证据有限，难度结论应随更近期、路线明确的实绩重新核对。');
    if (!reasons.length) reasons.push('目标配速与已知训练基础目前较匹配；仍需根据当天体感和恢复调整执行。');
    const items = [];
    segments.forEach((segment, index) => {
      if (!ranges[index]) return;
      const role = adviceRole(segment, session), label = segment.role === 'interval' ? '每组 2 km' : segment.role === 'recovery' ? '组间恢复' : segment.label || '本课';
      const text = (segments.length > 1 ? label + ' ' : '') + paceRange(ranges[index]) + (role === 'race' ? '（当前等效能力）' : '');
      if (!items.includes(text)) items.push(text);
    });
    const incomplete = foundation.missing && !foundation.zero;
    return result(incomplete ? 'unknown' : levelFor(severity), reasons, { ...(incomplete ? { label: '配速可参考 · 基础待补充' } : {}), paceText: items.join('；') || '按交谈与体感调整', paceLines: items, heartText: heartText(session, assessment), notes, confidence });
  }
  function forPlan(plan, assessment, context) {
    plan = plan || {}; assessment = assessment || {}; context = context || {};
    const weeks = Array.isArray(plan.weeks) ? plan.weeks : [];
    const remaining = weeks.map(week => (Array.isArray(week.sessions) ? week.sessions : []).filter(session => session.past !== true && !(typeof context.now === 'string' && typeof session.date === 'string' && session.date < context.now)));
    const runWeeks = remaining.map(sessions => sessions.filter(session => RUN_KINDS.includes(session.kind)));
    const totals = runWeeks.map(sessions => sessions.reduce((sum, session) => { const km = kmRange(session); return km ? [sum[0] + km[0], sum[1] + km[1]] : sum; }, [0, 0]));
    const peakKm = [0, 1].map(bound => Math.round(Math.max(0, ...totals.map(total => total[bound])) * 10) / 10);
    const requiredRunDays = Math.max(0, ...runWeeks.map(sessions => sessions.length));
    const extras = { peakKm, requiredRunDays, confidence: assessment.evidence?.confidence || 'low' };
    if (hold(assessment, context)) return result('hold', ['当前有恢复问题，暂缓执行强化课；主课表保留为目标参考。'], extras);
    let severity = 0;
    const reasons = [], add = (rank, text) => { severity = Math.max(severity, rank); reasons.push(text); };
    const foundation = requiredRunDays > 0 ? foundationFlags(context, add) : { missing: false, zero: false };
    volumeFlags(peakKm, context.weeklyKm, add);
    const available = positive(context.runDays);
    if (available !== null && requiredRunDays > available) add(1, '目标课表一周最多安排 ' + requiredRunDays + ' 次跑步，高于填写的每周 ' + available + ' 天；主课表保留原结构，请评估时间与恢复安排。');
    const results = runWeeks.flatMap(sessions => sessions.map(session => forSession(session, assessment, context)));
    const hardest = results.filter(item => item.level === 'high');
    if (hardest.length) add(2, '部分课程按当前能力难度较高：' + hardest[0].reason);
    else {
      const challenge = results.find(item => item.level === 'challenge');
      if (challenge) add(1, '部分课程需要逐步准备：' + challenge.reason);
    }
    if (!known(assessment)) {
      if (!hasImportedTrainingBase(context)) {
        reasons.unshift('需补充近期实绩后，才能把目标课表与个人能力一起判断；现有跑量信息只作负荷提醒。');
        return result('unknown', reasons, extras);
      }
      const level = levelFor(severity), incomplete = foundation.missing;
      reasons.unshift('已按本档案的周跑量、近 30 天最长跑和可跑天数比较计划训练负荷；近期比赛或全力测试成绩未确认，暂不判断目标配速适配。');
      if (incomplete) reasons.push('训练基础还缺少' + foundation.missingFields.join('、') + '，当前结论仅供参考。');
      return result(incomplete ? 'unknown' : level, reasons, {
        ...extras,
        label: incomplete ? '训练基础待补全 · ' + LABELS[level] : '训练基础 · ' + LABELS[level],
        paceText: '个人配速待确认；按交谈与体感控制',
        notes: [RULES, '本结论只比较已导入或填写的训练基础与课表负荷；没有近期比赛或全力测试成绩时，不判断目标配速是否适合。']
      });
    }
    if (!reasons.length) reasons.push('目标课表与当前已知能力、跑量和训练天数较匹配；未来训练适应和比赛表现仍存在不确定性。');
    const notes = [RULES, '按当前状态估计执行难度，未预测未来每周必然进步；目标适配度与实际课表难度分别展示。'];
    const incomplete = foundation.missing && !foundation.zero;
    return result(incomplete ? 'unknown' : levelFor(severity), reasons, { ...extras, ...(incomplete ? { label: '配速可参考 · 基础待补充' } : {}), notes });
  }
  return Object.freeze({ forSession, forPlan, RULES });
});
