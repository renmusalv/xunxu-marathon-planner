/*
 * TargetPlan — the user's seven-week 1:45 and 1:50 reference schedules.
 * Main prescriptions depend only on targetSeconds and calendar dates. Ability,
 * heart rate, race records and recent load belong to separate UI annotations.
 * Paces are seconds/km; time-based runs retain their duration prescription.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TargetPlan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HALF = 21.0975;
  const BASE_TARGET = 6300;
  const SECOND_TARGET = 6600;
  const IMAGE_RACE_PACE = 298;
  const SECOND_IMAGE_RACE_PACE = 312;
  const DAY = 86400000;
  const MAX_WEEKS = 24;
  const WARMUP_NOTE = '原图未规定热身和放松距离；本课所列为主要训练内容，热身、放松另计。';
  const VOLUME_NOTE = '周跑量为估算区间：按时长的有氧跑由配速折算距离；未规定的热身、放松不计入。比赛周总量包含比赛。';

  function rounded(value) { return Math.round(value * 100) / 100; }
  function paceText(seconds) {
    const value = Math.round(seconds);
    return Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0');
  }
  function rangeText(range) {
    return range[0] === range[1] ? String(range[0]) : range[0] + '–' + range[1];
  }
  function paceRangeText(range) {
    const first = paceText(range[0]), last = paceText(range[1]);
    return (first === last ? first : first + '–' + last) + '/km';
  }
  function goalValue(targetSeconds) {
    if ((typeof targetSeconds !== 'number' && typeof targetSeconds !== 'string') || String(targetSeconds).trim() === '') return null;
    const value = Number(targetSeconds);
    return Number.isFinite(value) && value / HALF >= 120 && value / HALF <= 1200 ? value : null;
  }
  function dateValue(value) {
    if (typeof value !== 'string') return null;
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    if (year < 1900 || year > 2200) return null;
    const timestamp = Date.UTC(year, month - 1, day), date = new Date(timestamp);
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? timestamp : null;
  }
  function dateKey(timestamp) { return new Date(timestamp).toISOString().slice(0, 10); }
  function shiftedPace(base, delta) {
    return (Array.isArray(base) ? base : [base, base]).map(value => value + delta);
  }
  // Each course has its own pair of observed paces. The supplied 1:50 image
  // slows easy running by 10 s/km, most quality work by 15 s/km, and changes
  // the self-test finish to a range. A single global shift loses those facts.
  function calibratedPace(first, second, target) {
    const a = shiftedPace(first, 0), b = shiftedPace(second, 0);
    if (target < BASE_TARGET) return shiftedPace(a, (target - BASE_TARGET) / HALF);
    if (target > SECOND_TARGET) return shiftedPace(b, (target - SECOND_TARGET) / HALF);
    const ratio = (target - BASE_TARGET) / (SECOND_TARGET - BASE_TARGET);
    return a.map((value, bound) => value + (b[bound] - value) * ratio);
  }
  function paceProfile(target) {
    const map = (first, second) => calibratedPace(first, second, target);
    return {
      target,
      easy: map([360, 390], [370, 400]),
      tempo: map([290, 295], [305, 310]),
      interval: map([285, 290], [300, 305]),
      recovery: map(340, 355),
      progressionStart: map(335, 350),
      progressionMiddle: map(315, 330),
      longStart: map(360, 370),
      longMiddle: map(330, 345),
      longFinish: map([295, 300], [310, 315]),
      testStart: map([320, 325], [335, 340]),
      testFinish: map(295, [310, 312]),
      activation: map(IMAGE_RACE_PACE, SECOND_IMAGE_RACE_PACE)
    };
  }
  function calibrationFor(target) {
    const exact = target === BASE_TARGET || target === SECOND_TARGET;
    const between = target > BASE_TARGET && target < SECOND_TARGET;
    const mode = exact ? 'reference' : between ? 'interpolated' : 'extrapolated';
    const nearest = target < BASE_TARGET ? BASE_TARGET : target > SECOND_TARGET ? SECOND_TARGET : exact ? target : null;
    const label = exact ? (target === BASE_TARGET ? '1:45' : '1:50') + ' · 参考图课表'
      : between ? '双参考图 · 逐课插值' : '参考图外推 · 需审慎使用';
    const description = exact
      ? '按对应的 ' + (target === BASE_TARGET ? '1:45' : '1:50') + ' 参考图保留七周结构、距离、时长和各课配速；比赛日均速按目标用时精确计算。'
      : between
        ? '目标位于 1:45 与 1:50 之间：保留两图共有的七周结构、距离与时长，分别对每课配速区间的两端插值。这是模板推导，未经个体训练效果验证。'
        : '目标位于 1:45–1:50 参考范围之外：以最近的 ' + (nearest === BASE_TARGET ? '1:45' : '1:50') + ' 课表为基础，各训练配速加上目标均速差，保留距离、时长与七周结构。这是外推参考，不能据此证明训练量或强度适合个人。';
    return { mode, label, description, anchorTargets: [BASE_TARGET, SECOND_TARGET], exactAnchorTarget: exact ? target : null, nearestAnchorTarget: nearest };
  }
  function sumRanges(sessions) {
    return [0, 1].map(bound => rounded(sessions.reduce((sum, session) => sum + session.totalKm[bound], 0)));
  }
  function shell(kind, title, displayAmount, paceType) {
    return { kind, title, displayAmount, paceType: paceType || null, paceLines: [], segments: [], totalKm: [0, 0], estimatedKm: false, notes: [] };
  }
  function rest() { return shell('rest', '休息', '恢复与休息'); }
  function strength(minutes, note, activation) {
    const result = shell('strength', activation ? '力量激活' : '力量维持', rangeText(minutes) + ' 分钟');
    result.durationMinutes = minutes.slice();
    result.notes.push(note);
    return result;
  }
  function timedEasy(minutes, paces, options) {
    options = options || {};
    const pace = paces.easy.slice();
    const result = shell('easy', options.title || '有氧慢跑', rangeText(minutes) + ' 分钟', 'easy');
    result.durationMinutes = minutes.slice();
    const mode = calibrationFor(paces.target).mode;
    result.paceSource = options.inferred ? 'inherited_easy_reference' : mode === 'reference' ? 'image_template' : mode === 'interpolated' ? 'reference_interpolation' : 'reference_extrapolation';
    result.paceLines = [(options.inferred ? '沿用有氧参考 ' : '') + paceRangeText(pace)];
    result.segments = [{ label: options.segmentLabel || '有氧慢跑', role: 'easy', durationMinutes: minutes.slice(), pace }];
    result.totalKm = [rounded(minutes[0] * 60 / pace[1]), rounded(minutes[1] * 60 / pace[0])];
    result.estimatedKm = true;
    if (options.note) result.notes.push(options.note);
    if (options.inferred) result.notes.push('原图此格未标数字配速；这里沿用该目标下的有氧配速区间作为补充参考。');
    return result;
  }
  function distanceRun(kind, title, distance, basePace, delta, role, options) {
    options = options || {};
    const range = Array.isArray(distance) ? distance.slice() : [distance, distance];
    const pace = shiftedPace(basePace, delta);
    const result = shell(kind, title, rangeText(range) + ' km', role === 'race' ? 'race' : kind === 'long' ? 'long' : role);
    if (range[0] === range[1]) result.distanceKm = range[0];
    else result.distanceRange = range.slice();
    result.paceLines = [paceRangeText(pace) + (options.paceSuffix || '')];
    const segment = { label: options.segmentLabel || title, role, pace };
    if (range[0] === range[1]) segment.distanceKm = range[0];
    else segment.distanceRange = range.slice();
    result.segments = [segment];
    result.totalKm = range.slice();
    if (options.note) result.notes.push(options.note);
    if (kind === 'quality') result.notes.push(WARMUP_NOTE);
    return result;
  }
  function tempo(km, paces) {
    const result = distanceRun('quality', '节奏跑', km, paces.tempo, 0, 'tempo');
    result.displayAmount = '连续 ' + km + ' km';
    return result;
  }
  function intervals(paces) {
    const fast = paces.interval.slice(), recovery = paces.recovery.slice();
    const result = shell('quality', '2K 变速跑', '2 km × 3 ＋ 组间 1 km × 2', 'interval');
    result.distanceKm = 8;
    result.totalKm = [8, 8];
    result.paceLines = ['2 km × 3 @ ' + paceRangeText(fast), '组间 1 km × 2 @ ' + paceRangeText(recovery) + ' 左右'];
    for (let repetition = 1; repetition <= 3; repetition += 1) {
      result.segments.push({ label: '第 ' + repetition + ' 组', role: 'interval', distanceKm: 2, pace: fast.slice() });
      if (repetition < 3) result.segments.push({ label: '第 ' + repetition + ' 次组间恢复', role: 'recovery', distanceKm: 1, pace: recovery.slice() });
    }
    result.notes = ['3 组之间有 2 段 1 km 恢复，主要训练共 8 km；最后一组后不再添加组间恢复。', WARMUP_NOTE];
    return result;
  }
  function segmented(kind, title, segments, delta, paceType) {
    const result = shell(kind, title, '', paceType);
    result.segments = segments.map(segment => ({ label: segment.label, role: segment.role, distanceKm: segment.distanceKm, pace: shiftedPace(segment.pace, delta) }));
    result.distanceKm = result.segments.reduce((sum, segment) => sum + segment.distanceKm, 0);
    result.displayAmount = result.distanceKm + ' km';
    result.totalKm = [result.distanceKm, result.distanceKm];
    result.paceLines = result.segments.map(segment => segment.label + ' ' + segment.distanceKm + ' km @ ' + paceRangeText(segment.pace));
    if (kind === 'quality') result.notes.push(WARMUP_NOTE);
    return result;
  }
  function progression(km, paces) {
    return segmented('quality', km + 'K 渐加速跑', [
      { label: '前段', role: 'steady', distanceKm: km / 3, pace: paces.progressionStart },
      { label: '中段', role: 'steady', distanceKm: km / 3, pace: paces.progressionMiddle },
      { label: '后段', role: 'tempo', distanceKm: km / 3, pace: paces.tempo }
    ], 0, 'tempo');
  }
  function segmentedLong(paces) {
    return segmented('long', '15K 分段加速长距离', [
      { label: '前段', role: 'easy', distanceKm: 5, pace: paces.longStart },
      { label: '中段', role: 'steady', distanceKm: 5, pace: paces.longMiddle },
      { label: '后段', role: 'tempo', distanceKm: 5, pace: paces.longFinish }
    ], 0, 'long');
  }
  function selfTest(paces) {
    const result = segmented('long', '16K 专项自测', [
      { label: '前段', role: 'steady', distanceKm: 10, pace: paces.testStart },
      { label: '后段', role: 'tempo', distanceKm: 6, pace: paces.testFinish }
    ], 0, 'long');
    if (paces.testFinish[0] === paces.testFinish[1]) result.paceLines[1] += ' 左右';
    result.notes.push('结合是否稳定完成、体感与恢复判断专项准备情况；一次自测不代表保证达成比赛目标。');
    return result;
  }
  function race(target) {
    const exact = target / HALF;
    const result = distanceRun('race', '比赛日', HALF, exact, 0, 'race');
    result.targetSeconds = target;
    result.paceLines = ['精确目标配速约 ' + paceText(exact) + '/km'];
    result.notes.push('比赛目标用时按 ' + target + ' 秒计算，配速显示四舍五入到秒；显示配速不会反向改变目标用时。');
    if (target === BASE_TARGET) result.notes.push('原图 4:58/km 是近似标注；1:45:00 ÷ 21.0975 km = 4:58.6/km，按整秒显示为 4:59/km。');
    if (target === SECOND_TARGET) result.notes.push('原图 5:12/km 是近似标注；1:50:00 ÷ 21.0975 km = 5:12.8/km，按整秒显示为 5:13/km。');
    return result;
  }

  /** index is zero-based (0..6). Returns a fresh, undated reference week. */
  function weekTemplate(index, targetSeconds) {
    const target = goalValue(targetSeconds);
    if (!Number.isInteger(index) || index < 0 || index > 6) throw new RangeError('模板周序号必须为 0–6。');
    if (target === null) throw new RangeError('目标时间无效；目标配速须在 2:00–20:00/km 范围内。');
    const paces = paceProfile(target);
    const titles = ['适应节奏', '变速适应', '渐进耐力', '专项自测', '专项巩固', '赛前减量', '比赛周'];
    const easyMinutes = index === 6 ? [35, 45] : index === 5 ? [40, 50] : [50, 60];
    const monday = timedEasy(easyMinutes, paces, index === 4 ? { inferred: true, note: '恢复优先。' } : undefined);
    const thursday = index === 6
      ? timedEasy([30, 40], paces, { inferred: true, note: '轻松跑开，不追加训练。' })
      : timedEasy(easyMinutes, paces);
    const quality = index === 0 ? tempo(8, paces)
      : index === 1 || index === 4 ? intervals(paces)
      : index === 2 ? progression(12, paces)
      : index === 3 ? tempo(10, paces)
      : index === 5 ? progression(9, paces)
      : distanceRun('quality', '半马配速唤醒', [5, 6], paces.activation, 0, 'race', {
        paceSuffix: ' · 不顶',
        note: target === BASE_TARGET
          ? '训练唤醒保留原图 4:58/km；比赛日按目标用时计算精确配速，两者约差 0.6 秒/km。'
          : target === SECOND_TARGET
            ? '训练唤醒保留原图 5:12/km；比赛日按目标用时计算精确配速，两者约差 0.8 秒/km。'
            : '训练唤醒依据两张参考图的对应课程推导；比赛日单独按目标用时计算精确配速，显示值可能略有不同。'
      });
    const strengthSession = index === 6 ? strength([10, 15], '身体唤醒。', true)
      : index === 5 ? strength([15, 20], '不练酸，保留激活。', true)
      : index === 3 ? strength([20, 20], '激活为主。', false)
      : strength([20, 30], '中低负荷，不练酸痛。', false);
    const long = index === 0 ? distanceRun('long', 'LSD 长距离', 15, paces.easy, 0, 'easy')
      : index === 1 || index === 4 ? segmentedLong(paces)
      : index === 2 ? distanceRun('long', 'LSD 长距离', 16, paces.easy, 0, 'easy')
      : index === 3 ? selfTest(paces)
      : index === 5 ? distanceRun('long', '减量有氧长距离', [12, 14], paces.easy, 0, 'easy')
      : race(target);
    const sessions = [monday, rest(), quality, thursday, strengthSession, rest(), long];
    return {
      templateWeek: index + 1,
      phase: index === 6 ? '比赛周' : index === 5 ? '减量' : '专项',
      phaseId: index === 6 ? 'race' : index === 5 ? 'taper' : 'specific',
      label: '第 ' + (index + 1) + ' 周 · ' + titles[index],
      sessions,
      totalKm: sumRanges(sessions),
      notes: [VOLUME_NOTE]
    };
  }
  function bridgeWeek(index, count, target) {
    const step = Math.min(2, Math.floor(index * 3 / count));
    const paces = paceProfile(target);
    const minutes = [30 + 5 * step, 40 + 5 * step];
    const sessions = [
      timedEasy(minutes, paces, { title: '轻松跑（衔接）' }),
      rest(),
      timedEasy(minutes, paces, { title: '轻松跑（衔接）' }),
      rest(),
      strength([20, 30], '中低负荷。', false),
      rest(),
      distanceRun('long', '有氧长距离（衔接）', 10 + step, paces.easy, 0, 'easy')
    ];
    sessions.filter(session => session.kind === 'easy').forEach(session => { session.paceSource = 'bridge_reference'; });
    return {
      templateWeek: null,
      phase: '衔接期（非原图）',
      phaseId: 'bridge',
      label: '衔接期第 ' + (index + 1) + ' 周（非原图）',
      sessions,
      totalKm: sumRanges(sessions),
      notes: ['这是核心 7 周之前的补充衔接安排，不属于原图课表。每周 3 次有氧跑与 1 次力量，进度仅按衔接周数设置。', VOLUME_NOTE]
    };
  }
  function invalid(error) {
    return { valid: false, error, weeks: [], notes: [error], summary: null, targetPace: null, templateRacePace: null, calibration: null };
  }

  function build(input) {
    input = input || {};
    const target = goalValue(input.targetSeconds);
    const raceDay = dateValue(input.raceDate), fromDay = dateValue(input.fromDate);
    if (target === null) return invalid('目标时间无效；目标配速须在 2:00–20:00/km 范围内。');
    if (raceDay === null || fromDay === null) return invalid('比赛日期和起始日期须是有效的 YYYY-MM-DD 日期。');
    const dayGap = Math.round((raceDay - fromDay) / DAY);
    if (dayGap < 0) return invalid('比赛日期不能早于计划起始日期。');
    if (dayGap >= MAX_WEEKS * 7) return invalid('目前支持含比赛日在内最多 24 周（168 天）的计划，请选择更近的比赛日期。');

    const delta = (target - BASE_TARGET) / HALF;
    const calibration = calibrationFor(target);
    const coreStart = raceDay - 48 * DAY;
    const bridgeCount = Math.max(0, Math.ceil((coreStart - fromDay) / (7 * DAY)));
    const firstCoreIndex = Math.max(0, Math.floor((fromDay - coreStart) / (7 * DAY)));
    const calendarStart = bridgeCount ? coreStart - bridgeCount * 7 * DAY : coreStart + firstCoreIndex * 7 * DAY;
    const weeks = [];
    for (let bridgeIndex = 0; bridgeIndex < bridgeCount; bridgeIndex += 1) weeks.push(bridgeWeek(bridgeIndex, bridgeCount, target));
    for (let templateIndex = firstCoreIndex; templateIndex < 7; templateIndex += 1) weeks.push(weekTemplate(templateIndex, target));
    weeks.forEach((week, index) => {
      const start = calendarStart + index * 7 * DAY;
      week.index = index;
      week.startDate = dateKey(start);
      week.endDate = dateKey(start + 6 * DAY);
      week.sessions.forEach((session, dayIndex) => {
        const timestamp = start + dayIndex * DAY;
        session.date = dateKey(timestamp);
        session.dayOffset = dayIndex;
        session.weekday = new Date(timestamp).getUTCDay();
        session.past = timestamp < fromDay;
        session.canComplete = !session.past && session.kind !== 'rest';
        if (session.past) session.notes.push('此日期早于本次计划起始日，标为已过；不安排补训。');
      });
      week.remainingKm = sumRanges(week.sessions.filter(session => !session.past));
      week.partial = week.sessions.some(session => session.past);
    });

    const allSessions = weeks.flatMap(week => week.sessions);
    const notes = [
      '主课表的结构、距离、时长及配速仅由目标用时和比赛日期确定；个人能力只用于另列完成难度和建议配速。',
      calibration.description,
      '两张参考图的有氧配速相差 10 秒/km，多数质量段相差 15 秒/km，专项自测末段范围也有差异；各课分别校准，不把所有配速统一加减同一数值。',
      VOLUME_NOTE
    ];
    if (new Date(raceDay).getUTCDay() !== 0) notes.push('比赛不在周日，完整 7 天训练节奏已整体平移，以比赛日结束每周；比赛前一天保持休息，不安排赛后训练。');
    if (fromDay > coreStart) notes.push('起始日已进入 7 周专项期，只展示相应的剩余模板周；首周已过日期不补训，也不压缩或合并前面的课。');
    if (bridgeCount) notes.push('核心 7 周前增加 ' + bridgeCount + ' 周「衔接期（非原图）」，其安排不会修改后面的 7 周参考课表。');
    if (calibration.mode === 'extrapolated' && Math.abs((target - calibration.nearestAnchorTarget) / HALF) > 60) notes.push('该目标与最近参考图的目标均速相差超过 1 分钟/km。外推不验证训练效果或负荷适合度，请结合当前能力建议和实际恢复情况调整执行。');
    const trainingSessions = allSessions.filter(session => !session.past && session.kind !== 'race');
    const peakKm = [0, 1].map(bound => Math.max(...weeks.map(week => week.totalKm[bound])));
    const peakRemainingKm = [0, 1].map(bound => Math.max(...weeks.map(week => week.remainingKm[bound])));
    const peakTrainingKm = [0, 1].map(bound => Math.max(...weeks.map(week => sumRanges(week.sessions.filter(session => !session.past && session.kind !== 'race'))[bound])));
    const longSessions = trainingSessions.filter(session => session.kind === 'long');
    const firstTraining = allSessions.find(session => !session.past && !['rest', 'strength'].includes(session.kind));
    return {
      valid: true,
      error: null,
      weeks,
      notes,
      summary: {
        peakKm,
        peakRemainingKm,
        peakTrainingKm,
        peakIncludesRace: true,
        longestKm: longSessions.length ? Math.max(...longSessions.map(session => session.totalKm[1])) : 0,
        trainingStartDate: firstTraining ? firstTraining.date : input.fromDate,
        calendarStartDate: dateKey(calendarStart),
        templateStartDate: dateKey(coreStart),
        plannedWeeks: weeks.length,
        remainingWeeks: weeks.length,
        bridgeWeeks: bridgeCount,
        daysToRace: dayGap,
        volumeIsEstimated: true,
        volumeNote: VOLUME_NOTE
      },
      targetSeconds: target,
      targetPace: target / HALF,
      templateRacePace: paceProfile(target).activation[0],
      // Legacy diagnostic only: actual prescriptions use per-course calibration.
      paceDelta: delta,
      calibration,
      reference: {
        targetSeconds: BASE_TARGET, racePace: IMAGE_RACE_PACE, weeks: 7,
        source: '用户提供的半马 145 与 150 冲刺课表图片',
        anchors: [
          { targetSeconds: BASE_TARGET, racePace: IMAGE_RACE_PACE, label: '1:45' },
          { targetSeconds: SECOND_TARGET, racePace: SECOND_IMAGE_RACE_PACE, label: '1:50' }
        ]
      }
    };
  }

  return Object.freeze({ build, weekTemplate, HALF, BASE_TARGET, SECOND_TARGET, MAX_WEEKS, paceText });
});
