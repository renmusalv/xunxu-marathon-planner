/*
 * RunningAssessment — deterministic, profile-independent training estimates.
 * No storage, network calls or implicit access to other profiles.
 * Formula references and explicit product assumptions are returned separately.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RunningAssessment = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HALF = 21.0975;
  const FULL = 42.195;
  const DAY = 86400000;
  const EXPONENT = 1.07;
  const SOURCES = Object.freeze([
    { id: 'prediction', title: '业余跑者比赛时间预测研究（Vickers & Vertosick, 2016）', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5000509/', supports: 'Riegel 距离换算；等效成绩不等于个体预测保证。' },
    { id: 'training', title: '半马与全马训练特征队列研究（Fokkema et al., 2020）', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7496388/', supports: '训练跑量、长跑与成绩的观察性关联；不是必需门槛。' },
    { id: 'intensity', title: 'ACSM / ESSA 运动强度术语共识', url: 'https://doi.org/10.1249/MSS.0000000000003795', supports: '心率储备与最大心率强度范围及个体差异。' },
    { id: 'hrr', title: 'HPRC：目标心率与心率储备计算', url: 'https://www.hprc-online.org/physical-fitness/training-performance/find-your-target-heart-rate', supports: '目标心率 = 静息心率 + 强度比例 ×（最大心率 − 静息心率）。' },
    { id: 'lthr', title: 'Joe Friel 跑步阈值心率分区', url: 'https://www.trainingpeaks.com/learn/articles/joe-friel-s-quick-guide-to-setting-zones/', supports: '已有可靠跑步阈值心率时使用的教练分区方案。' },
    { id: 'pace', title: 'Jack Daniels：训练强度定义', url: 'https://vdoto2.com/learn-more/training-definitions', supports: '节奏训练近一小时比赛强度，轻松跑以完整交谈为准。具体配速倍率是本工具的经验起点。' },
    { id: 'vo2', title: 'Apple：Apple Watch 的 VO₂max 估算方法', url: 'https://www.apple.com/healthcare/docs/site/Using_Apple_Watch_to_Estimate_Cardio_Fitness_with_VO2_max.pdf', supports: '设备 VO₂max 为算法估值；不将其直接换算成目标达成概率。' },
    { id: 'load', title: 'IOC 训练负荷共识', url: 'https://doi.org/10.1136/bjsports-2016-096581', supports: '训练负荷与恢复需要综合判断，单一指标不能预测个体适应。' }
  ]);

  function number(value, min, max) {
    if (value === null || value === undefined || !['number', 'string'].includes(typeof value) || (typeof value === 'string' && value.trim() === '')) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
  }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function roundPace(value) { return Math.round(value / 5) * 5; }
  function clock(value) {
    if (!Number.isFinite(value)) return '—';
    const total = Math.round(value);
    return [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60].map(v => String(v).padStart(2, '0')).join(':');
  }
  function dayValue(value) {
    if (value instanceof Date) {
      if (!Number.isFinite(value.getTime())) return null;
      return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
    }
    const match = String(value || '').trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (!match) return null;
    const y = Number(match[1]), m = Number(match[2]), d = Number(match[3]);
    if (y < 1900 || y > 2200) return null;
    const timestamp = Date.UTC(y, m - 1, d), date = new Date(timestamp);
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? timestamp : null;
  }
  function standardDistance(value) {
    const distance = number(value, 1, 100);
    if (distance === null) return null;
    if (Math.abs(distance - 10) < 0.015) return 10;
    if (Math.abs(distance - HALF) < 0.015) return HALF;
    if (Math.abs(distance - FULL) < 0.015) return FULL;
    return null;
  }
  function unique(items) { return Array.from(new Set(items)); }
  function gradeLabel(value) { return value === 'high' ? '较充分' : value === 'medium' ? '一般' : '有限'; }

  function collectRecords(records, targetDistance, today) {
    const accepted = [], excluded = [], notes = [], seen = new Set();
    (Array.isArray(records) ? records : []).forEach((record, index) => {
      if (!record || typeof record !== 'object') return;
      const id = String(record.id || 'record_' + index);
      const exclude = reason => excluded.push({ id, reason });
      if (record.confirmed !== true) { exclude('尚未核对确认'); return; }
      if (record.include === false) { exclude('已选择不纳入估算'); return; }
      if (!['race', 'time_trial'].includes(record.effort)) { exclude('普通训练不用于推断全力比赛能力'); return; }
      if (record.durationType !== 'elapsed') { exclude('请先确认完整计时；移动时间或未知计时仅留档'); return; }
      if (['hilly', 'trail', 'treadmill'].includes(record.course)) { exclude('起伏、越野或跑步机成绩仅留档，不直接换算平路比赛能力'); return; }
      const distance = standardDistance(record.distanceKm), elapsed = number(record.elapsedSeconds, 1, 86400);
      const date = dayValue(record.date), age = date === null ? null : Math.floor((today - date) / DAY);
      if (!distance || elapsed === null || elapsed / distance < 120 || elapsed / distance > 1200) { exclude('距离或用时无效，请核对'); return; }
      if (date === null || age < 0) { exclude('日期无效或位于未来'); return; }
      if (age > 365) { exclude('成绩超过 365 天'); return; }
      if (targetDistance === FULL && distance !== FULL) { exclude('全马计划需近期全马成绩，未用短距离外推全马'); return; }
      if (targetDistance === HALF && ![10, HALF].includes(distance)) { exclude('半马计划仅纳入 10 km 或半马成绩'); return; }
      const fingerprint = [distance, elapsed, date].join('|');
      if (seen.has(fingerprint)) { exclude('同一天同距离同用时的重复成绩'); return; }
      seen.add(fingerprint);
      const sameDistance = distance === targetDistance;
      const equivalent = sameDistance ? elapsed : elapsed * Math.pow(targetDistance / distance, EXPONENT);
      const freshness = Math.exp(-age / 120);
      const courseKnown = record.course === 'road_flat';
      const weight = freshness * (sameDistance ? 1.4 : 1) * (record.effort === 'race' ? 1 : 0.85) * (courseKnown ? 1 : 0.7);
      accepted.push({ id, distanceKm: distance, elapsedSeconds: elapsed, date: record.date, ageDays: age, equivalentSeconds: equivalent, sameDistance, effort: record.effort, source: record.source || 'manual', courseKnown, weight, averageHr: number(record.averageHr, 30, 240), peakHr: number(record.peakHr, 30, 250) });
    });
    accepted.sort((a, b) => a.ageDays - b.ageDays || b.weight - a.weight);
    if (excluded.some(r => r.reason.includes('重复'))) notes.push('重复截图按同一次成绩处理，不会增加证据权重。');
    if (excluded.some(r => r.reason.includes('普通训练'))) notes.push('普通训练仅作记录，不把非全力训练速度当作比赛能力。');
    if (excluded.some(r => r.reason.includes('计时'))) notes.push('仅使用已确认的完整计时，移动时间不会与完整比赛用时混用。');
    return { accepted, excluded, notes };
  }

  function estimate(records, targetDistance, today) {
    const collected = collectRecords(records, targetDistance, today), used = collected.accepted;
    if (!used.length) return {
      equivalentSeconds: null, equivalentPace: null, range: null,
      evidence: { confidence: 'low', label: '资料不足', count: 0, usedRecords: [], excludedRecords: collected.excluded, newestAgeDays: null, spreadPct: null, notes: collected.notes.concat('请确认一条近 180 天的比赛或全力测试成绩。'), rangeLabel: '情景参考区间（非统计置信区间）' }
    };
    const weightTotal = used.reduce((sum, record) => sum + record.weight, 0);
    const logMean = used.reduce((sum, record) => sum + Math.log(record.equivalentSeconds) * record.weight, 0) / weightTotal;
    const equivalent = Math.exp(logMean);
    const variance = used.reduce((sum, record) => sum + record.weight * Math.pow(Math.log(record.equivalentSeconds) - logMean, 2), 0) / weightTotal;
    const spreadPct = (Math.exp(Math.sqrt(variance)) - 1) * 100;
    const newest = used[0].ageDays;
    const fresh = used.filter(record => record.ageDays <= 90);
    const sameDistance = used.some(record => record.sameDistance && record.ageDays <= 90);
    let confidence = fresh.length >= 2 && sameDistance && spreadPct <= 5 ? 'high' : newest <= 180 && spreadPct <= 8 ? 'medium' : 'low';
    const unknownCourseWeight = used.reduce((sum, record) => sum + (record.courseKnown ? 0 : record.weight), 0) / weightTotal;
    if (unknownCourseWeight > 0.5) confidence = 'low';
    const freshnessPad = newest > 180 ? 0.08 : newest > 90 ? 0.04 : 0;
    const conversionWeight = used.reduce((sum, record) => sum + (record.sameDistance ? 0 : record.weight), 0) / weightTotal;
    const margin = clamp(0.025 + conversionWeight * 0.025 + freshnessPad + unknownCourseWeight * 0.03 + Math.sqrt(variance), 0.025, 0.25);
    const notes = collected.notes.concat([
      '成绩按新鲜度、比赛距离和比赛／全力测试类型加权；重复截图不重复计权。',
      '10 km → 半马使用 Riegel 指数 1.07；同距离直接使用实际成绩。',
      '参考区间包含换算、成绩差异和陈旧程度的经验余量，不是统计置信区间或成功概率。'
    ]);
    if (used.length === 1) notes.push('目前只有一次有效成绩，尚不能判断状态趋势。');
    if (unknownCourseWeight > 0) notes.push('部分成绩的路线类型尚未明确，已降低权重并扩大参考区间；默认未做坡度或环境修正。');
    if (newest > 90) notes.push('最近有效成绩已超过 90 天，当前状态判断的可靠性降低。');
    if (spreadPct > 5) notes.push('多次等效成绩差异较大，可能包含训练状态、天气、路线或比赛投入程度差异。');
    if (newest > 180) notes.push('当前仅有半年前的成绩：可查看历史参考配速，暂不显示目标适配度分数。');
    return {
      equivalentSeconds: equivalent, equivalentPace: equivalent / targetDistance,
      range: [Math.round(equivalent * (1 - margin)), Math.round(equivalent * (1 + margin))],
      evidence: { confidence, label: gradeLabel(confidence) + ' · ' + used.length + ' 次有效成绩', count: used.length, usedRecords: used.map(record => ({ ...record, weight: record.weight / weightTotal })), excludedRecords: collected.excluded, newestAgeDays: newest, spreadPct: Number(spreadPct.toFixed(1)), notes, rangeLabel: '情景参考区间（非统计置信区间）' }
    };
  }

  function personalNumbers(personal) {
    return {
      age: number(personal.age, 18, 100),
      restingHr: number(personal.restingHr, 25, 120),
      maxHr: number(personal.maxHr, 100, 240),
      thresholdHr: number(personal.thresholdHr, 60, 230),
      vo2max: number(personal.vo2max, 10, 100)
    };
  }

  function heartRate(personal, records) {
    personal = personal || {};
    const values = personalNumbers(personal), notes = [], warnings = [];
    const maxSource = personal.maxHrSource || 'observed';
    let maximum = values.maxHr, rest = values.restingHr, threshold = values.thresholdHr, conflict = false;
    if (maximum !== null && rest !== null && maximum - rest < 20) {
      warnings.push('最大心率必须明显高于静息心率，请核对；当前未使用心率储备法。');
      conflict = true;
      rest = null;
    }
    if (threshold !== null && maximum !== null && threshold >= maximum) {
      warnings.push('阈值心率不应等于或超过已填最大心率；当前忽略阈值心率。');
      conflict = true;
      threshold = null;
    }
    const confirmed = (Array.isArray(records) ? records : []).filter(record => record && record.confirmed === true);
    const averageValues = confirmed.map(record => number(record.averageHr, 30, 240)).filter(value => value !== null);
    const peakValues = confirmed.map(record => number(record.peakHr, 30, 250)).filter(value => value !== null);
    if (maximum !== null && averageValues.some(value => value > maximum)) { warnings.push('有成绩的平均心率高于个人最大心率，请检查识别值、传感器或个人资料。'); conflict = true; }
    if (maximum !== null && peakValues.some(value => value > maximum)) { warnings.push('有截图的本次最高心率超过个人最大心率，请核对；不会自动覆盖个人最大心率。'); conflict = true; }
    if (confirmed.some(record => number(record.averageHr, 30, 240) !== null && number(record.peakHr, 30, 250) !== null && Number(record.averageHr) > Number(record.peakHr))) { warnings.push('有成绩的平均心率大于本次最高心率，请核对截图。'); conflict = true; }
    const supplied = field => personal[field] !== null && personal[field] !== undefined && personal[field] !== '';
    ['restingHr', 'maxHr', 'thresholdHr'].forEach(field => { if (supplied(field) && values[field] === null) { warnings.push(({ restingHr: '静息心率', maxHr: '最大心率', thresholdHr: '阈值心率' })[field] + '超出可接受范围，当前未用于计算。'); conflict = true; } });
    const observation = maxSource !== 'measured' && maxSource !== 'lab';
    const reliableThreshold = threshold !== null && ['lab', 'measured', 'test', 'field'].includes(personal.thresholdHrSource);
    let method = 'effort', label = '体感与交谈测试', confidence = 'low', zones = [], formula = '', targets = {};
    const descriptions = [
      ['recovery', '恢复', '呼吸轻松，可完整交谈'],
      ['easy', '轻松有氧', '能说完整句子；吃力就降速'],
      ['steady', '稳定有氧', '呼吸加深，仍能短句交谈'],
      ['tempo', '较高强度', '明显用力，仅能说短词'],
      ['hard', '高强度', '短段使用，不追逐心率数字']
    ];
    if (conflict) {
      label = '心率资料待核对 · 暂用体感';
      zones = descriptions.map(description => ({ id: description[0], label: description[1], min: null, max: null, effort: description[2], percent: '' }));
      notes.push('心率资料存在冲突或无效值，已暂停所有 bpm 目标。请核对个人资料与截图；确认前只使用交谈测试与体感，不自动覆盖任何已填数值。');
    } else if (maximum !== null && rest !== null && (!observation || !reliableThreshold)) {
      method = 'hrr'; label = observation ? '心率储备法 · 观测最大值暂估' : '心率储备法 · 实测最大心率';
      confidence = observation ? 'low' : 'medium';
      const reserve = maximum - rest;
      const fractions = [[0.30, 0.39], [0.40, 0.59], [0.60, 0.74], [0.75, 0.89], [0.90, 0.95]];
      zones = fractions.map((fraction, index) => ({ id: descriptions[index][0], label: descriptions[index][1], min: Math.round(rest + reserve * fraction[0]), max: Math.round(rest + reserve * fraction[1]), effort: descriptions[index][2], percent: Math.round(fraction[0] * 100) + '–' + Math.round(fraction[1] * 100) + '% HRR' }));
      formula = '目标心率 = ' + rest + ' + 强度比例 ×（' + maximum + ' − ' + rest + '）';
      notes.push('40–59% HRR 对应一般中等强度；其他档位是本工具为训练展示进行的细分，不是个人乳酸阈值。');
    } else if (threshold !== null) {
      method = 'lthr'; label = '跑步阈值心率分区'; confidence = reliableThreshold ? 'medium' : 'low';
      const boundaries = [0.85, 0.90, 0.95, 1.00];
      zones = descriptions.map((description, index) => ({ id: description[0], label: description[1], min: index === 0 ? null : Math.ceil(threshold * boundaries[index - 1]), max: index === 4 ? (maximum === null ? null : maximum) : Math.ceil(threshold * boundaries[index]) - 1, effort: description[2], percent: ['<85% LTHR', '85–89% LTHR', '90–94% LTHR', '95–99% LTHR', '≥100% LTHR'][index] }));
      formula = '按已填跑步阈值心率 ' + threshold + ' bpm 计算';
      notes.push('采用 Friel 跑步分区，将其 5a–5c 合并展示；仅适用于可靠跑步阈值心率，比赛平均心率不自动视为阈值。');
    } else if (maximum !== null) {
      method = 'hrmax'; label = observation ? '最大心率比例 · 观测值暂估' : '最大心率比例 · 缺少静息心率'; confidence = observation ? 'low' : 'medium';
      const fractions = [[0.57, 0.63], [0.64, 0.76], [0.77, 0.85], [0.86, 0.95], [0.96, 1]];
      zones = fractions.map((fraction, index) => ({ id: descriptions[index][0], label: descriptions[index][1], min: Math.round(maximum * fraction[0]), max: Math.round(maximum * fraction[1]), effort: descriptions[index][2], percent: Math.round(fraction[0] * 100) + '–' + Math.round(fraction[1] * 100) + '% HRmax' }));
      formula = '目标心率 = 最大心率 ' + maximum + ' × 强度比例';
      notes.push('缺少静息心率时使用最大心率比例；%HRmax 与 %HRR 不能混用，高强度内部细分为工具约定。');
    } else {
      zones = descriptions.map(description => ({ id: description[0], label: description[1], min: null, max: null, effort: description[2], percent: '' }));
      notes.push('填写可靠最大心率与静息心率，或跑步阈值心率后，才显示数值心率参考。不会把年龄公式或比赛平均心率当作实测最大心率。');
    }
    if (!conflict && maximum !== null && observation) notes.push('近期观测最高心率可能低于真实最大心率，因此这些数值仅作暂时参考。');
    notes.push('炎热、疲劳、药物与传感器误差会改变心率。轻松跑以完整交谈为准；短间歇心率有滞后，不需要追到区间上限。');
    ['recovery', 'easy', 'steady', 'tempo', 'hard'].forEach(id => { const zone = zones.find(item => item.id === id); targets[id] = zone ? { min: zone.min, max: zone.max, note: zone.effort } : null; });
    targets.long = targets.easy;
    targets.interval = { min: null, max: null, note: '以配速和体感为主，短间歇不追逐心率' };
    targets.race = { min: null, max: null, note: '综合体感、天气与已有比赛经验控速' };
    return { method, label, confidence, conflict, zones, targets, notes, warnings: unique(warnings), formula, maxHr: maximum, restingHr: rest, thresholdHr: threshold };
  }

  function trainingPaces(equivalent, targetDistance, goal, confidence) {
    if (!Number.isFinite(equivalent)) return { easy: null, recovery: null, long: null, tempo: null, interval: null, race: goal ? [goal / targetDistance, goal / targetDistance] : null, notes: ['先填写有效实际成绩，训练配速不会用目标时间代替。'] };
    const halfSeconds = targetDistance === HALF ? equivalent : equivalent * Math.pow(HALF / targetDistance, EXPONENT);
    const currentPace = halfSeconds / HALF;
    const conservative = confidence === 'low' ? 1.03 : 1;
    const hourDistance = targetDistance * Math.pow(3600 / equivalent, 1 / EXPONENT);
    const hourPace = 3600 / hourDistance;
    const fiveKmPace = equivalent * Math.pow(5 / targetDistance, EXPONENT) / 5;
    const range = (base, a, b) => [roundPace(base * a * conservative), roundPace(base * b * conservative)];
    return {
      easy: range(currentPace, 1.16, 1.32), recovery: range(currentPace, 1.25, 1.42), long: range(currentPace, 1.16, 1.32),
      tempo: range(hourPace, 1.00, 1.05), interval: range(fiveKmPace, 1.00, 1.05),
      race: goal ? [goal / targetDistance, goal / targetDistance] : null,
      currentHalfPace: currentPace,
      notes: ['轻松、恢复与长跑配速范围为相对当前等效能力的保守经验带，不是实验室测定。', '节奏参考接近一小时比赛能力，短间歇参考等效 5 km 配速；它们不等于实测乳酸阈值或 VO₂max 速度。', '炎热、坡道或疲劳时优先遵从体感与恢复状况，训练配速不随更激进的目标自动加快。'].concat(confidence === 'low' ? ['证据有限，训练参考额外放慢约 3%；建议先补充近期实绩。'] : [])
    };
  }

  function vo2Context(personal, today) {
    const value = number(personal.vo2max, 10, 100);
    if (value === null) return { value: null, label: '未填写', note: 'VO₂max 可作为补充信息；不会因未填而扣适配度。', ageDays: null, source: null };
    const date = dayValue(personal.vo2maxDate), age = date === null ? null : Math.floor((today - date) / DAY);
    const lab = personal.vo2maxSource === 'lab';
    return {
      value, source: lab ? 'lab' : 'watch', label: lab ? '实验室测量' : '设备估算', date: personal.vo2maxDate || null, ageDays: age,
      note: (lab ? '实验室 VO₂max 反映有氧能力之一。' : '手表 VO₂max 是算法估算，会受到设备与测量条件影响。') + '不将它当作比赛表现或完赛概率，不单独加减目标适配度。' + (age !== null && age < 0 ? '记录日期在未来，请核对。' : age !== null && age > 180 ? '这项记录已超过 180 天。' : !date ? '可补充测量日期以判断新鲜度。' : '')
    };
  }

  function consistencyValue(value) {
    if (value === 'stable') return { points: 0, label: '近 4 周稳定' };
    if (value === 'interrupted') return { points: 5, label: '近期有中断' };
    if (value === 'restarting') return { points: 10, label: '刚恢复训练' };
    const weeks = number(value, 0, 4);
    return weeks === null ? null : { points: Math.round((4 - weeks) * 2.5), label: '近 4 周稳定训练 ' + weeks + ' 周' };
  }

  function assessFit(input, estimateResult, today, goal, targetDistance) {
    const personal = input.personal || {}, evidence = estimateResult.evidence, factors = [], missing = [], reasons = [];
    const race = dayValue(input.raceDate), days = race === null ? null : Math.ceil((race - today) / DAY), weeks = days === null ? null : days / 7;
    const weekly = number(input.weeklyKm, 0, 250), longest = number(input.longestRun, 0, 60), runDays = number(input.runDays, 1, 7);
    const base = estimateResult.equivalentSeconds;
    if (!base) missing.push('近期已确认的比赛或全力测试成绩');
    if (base && evidence.newestAgeDays > 180) missing.push('近 180 天的比赛或全力测试成绩');
    if (goal === null) missing.push('合理的目标用时');
    if (!days || days < 0) missing.push('未来的比赛日期');
    if (weekly === null) missing.push('最近 3–4 周平均周跑量');
    if (longest === null) missing.push('近 30 天最长跑');
    if (runDays === null) missing.push('每周跑步天数');
    const blocked = missing.length > 0;
    const gap = base && goal ? (base - goal) / base * 100 : null;
    const required = gap === null ? null : Math.max(0, gap);
    const add = (id, label, value, points, reason) => { const factor = { id, label, value, points, reason }; factors.push(factor); if (points > 0) reasons.push(reason); };
    if (required !== null) add('goal', '目标差距', gap > 0 ? '需快 ' + gap.toFixed(1) + '%' : '已有等效能力覆盖目标', Math.round(Math.min(35, required * 4)), '目标较当前等效成绩快 ' + Math.max(0, gap).toFixed(1) + '%。');
    if (weeks !== null && weeks > 0 && required !== null) add('time', '备赛时间', Math.ceil(weeks) + ' 周', Math.round(Math.min(15, required / Math.max(1, weeks) * 8)), '剩余 ' + Math.ceil(weeks) + ' 周需完成目标差距，周期越短调整空间越有限。');
    const volumeReference = targetDistance === HALF ? 32 : 45, longReference = targetDistance === HALF ? 16 : 28;
    if (weekly !== null) add('volume', '周跑量基础', weekly + ' km/周', Math.round(clamp((volumeReference - weekly) / volumeReference * 14, 0, 14)), '周跑量相对工具规划参考 ' + volumeReference + ' km/周仍有差距；参考值不是达标门槛。');
    if (longest !== null) add('long', '长距离基础', longest + ' km', Math.round(clamp((longReference - longest) / longReference * 14, 0, 14)), '近 30 天最长跑相对规划参考 ' + longReference + ' km仍有差距，应结合跑量逐步建立。');
    if (runDays !== null) add('frequency', '跑步频率', runDays + ' 天/周', runDays < 3 ? 6 : runDays === 3 ? 3 : 0, '每周可跑天数较少，训练与恢复安排的余地较小。');
    const consistency = consistencyValue(personal.recentConsistency);
    if (consistency) add('consistency', '训练连续性', consistency.label, consistency.points, '近期训练有中断，应先恢复稳定节奏，再判断能否推进目标。');
    else { add('consistency', '训练连续性', '待补充', 0, '未填不扣分，但无法判断持续训练情况。'); missing.push('可补充近 4 周训练连续性'); }
    if (base) add('freshness', '成绩新鲜度', evidence.newestAgeDays + ' 天前', evidence.newestAgeDays <= 90 ? 0 : evidence.newestAgeDays <= 180 ? 5 : 10, '较旧成绩对当前状态的解释能力降低。');
    const adherence = input.adherence || {}, due = number(adherence.due, 0, 10000), completed = number(adherence.completed, 0, 10000);
    if (due !== null && completed !== null && due >= 3 && completed <= due) {
      const fraction = completed / due;
      add('adherence', '已到期训练打卡', Math.round(fraction * 100) + '% · ' + completed + '/' + due, fraction >= 0.8 ? 0 : fraction >= 0.6 ? 4 : 8, '已到期训练打卡较少，计划执行证据有限；未打卡不必然代表未训练。');
    } else add('adherence', '已到期训练打卡', '数据积累中', 0, '至少 3 次已到期训练后纳入；未来课程不计入。');
    const discomfort = personal.discomfort || 'none';
    const hold = ['pain', 'illness'].includes(discomfort);
    if (hold) {
      add('recovery', '当前恢复状况', discomfort === 'pain' ? '存在疼痛' : '近期生病 / 恢复中', 0, '先处理当前不适与恢复，不以分数鼓励继续提高训练强度。');
      reasons.unshift('当前存在不适或疾病恢复情况，暂停用分数判断冲刺目标；必要时寻求专业评估。');
    }
    const total = factors.reduce((sum, factor) => sum + factor.points, 0);
    let score = blocked || hold ? null : Math.round(clamp(100 - total, 0, 100));
    const thinBase = weekly !== null && longest !== null && (weekly < (targetDistance === HALF ? 15 : 25) || longest < (targetDistance === HALF ? 8 : 15));
    if (score !== null && thinBase && score > 65) { add('foundation', '基础优先', '先建立稳定基础', score - 65, '近期跑量或最长跑较低，仅靠一次成绩不足以判断长距离准备充分。'); score = 65; }
    const level = score === null ? 'unknown' : score >= 80 ? 'low' : score >= 60 ? 'medium' : 'high';
    const label = hold ? '优先恢复 · 暂缓评估' : score === null ? '资料不足 · 待评估' : level === 'low' ? '当前基础较匹配' : level === 'medium' ? '需要逐步准备' : '目标挑战较大';
    const relation = gap === null ? '' : gap > 0 ? '目标比当前等效成绩快 ' + gap.toFixed(1) + '%。' : '当前等效成绩已接近或覆盖目标。';
    return {
      score, level, label, factors, summary: label + '。' + relation + ' 这是准备度规则评分，不是完赛概率或伤病风险。',
      reasons: unique(reasons), missing: unique(missing), gapPct: gap, requiredImprovementPct: required, weeks: weeks === null ? null : Math.ceil(weeks), days, hold,
      rules: '适配度 = 100 − 各项扣分。目标差距最多 35，周期压力最多 15，跑量及长跑各 14，频率最多 6，连续性最多 10，成绩陈旧最多 10，已到期打卡最多 8。基础不足时上限为 65。以上阈值与权重为透明规划规则，未经个体成功概率验证。'
    };
  }

  function evaluate(input) {
    input = input && typeof input === 'object' ? input : {};
    const targetDistance = standardDistance(input.distanceKm);
    const today = dayValue(input.now === undefined ? new Date() : input.now);
    const personal = input.personal && typeof input.personal === 'object' ? input.personal : {};
    const distance = [HALF, FULL].includes(targetDistance) ? targetDistance : HALF;
    const validToday = today === null ? dayValue(new Date()) : today;
    const goal = number(input.targetSeconds, distance * 120, distance * 1200);
    const assessment = estimate(input.records, distance, validToday);
    const heart = heartRate(personal, input.records);
    const fit = assessFit({ ...input, personal }, assessment, validToday, goal, distance);
    const warnings = heart.warnings.slice();
    if (![HALF, FULL].includes(targetDistance)) warnings.push('比赛距离无效，当前以半马范围显示参考；请核对比赛设置。');
    if (![HALF, FULL].includes(targetDistance)) { fit.score = null; fit.level = 'unknown'; fit.label = '比赛距离待核对'; fit.missing.unshift('有效的目标比赛距离'); fit.summary = '请先选择半程马拉松或全程马拉松，再评估目标适配度。'; }
    if (today === null) warnings.push('评估日期无效，已使用当前日期。');
    if (assessment.evidence.spreadPct > 8) warnings.push('近期成绩之间差异较大，请核对路线、比赛投入程度与识别结果后再使用配速。');
    if (assessment.evidence.newestAgeDays > 180) warnings.push('有效成绩偏旧；以下为历史能力参考，请用近期成绩重新校准。');
    const vo2 = vo2Context(personal, validToday);
    if (vo2.ageDays !== null && vo2.ageDays < 0) warnings.push('VO₂max 记录日期在未来，请核对。');
    if (personal.vo2max !== '' && personal.vo2max !== null && personal.vo2max !== undefined && vo2.value === null) warnings.push('VO₂max 超出可接受范围，当前未使用。');
    return {
      version: '1.0.0', distanceKm: distance, targetSeconds: goal,
      ...assessment, fit, paces: trainingPaces(assessment.equivalentSeconds, distance, goal, assessment.evidence.confidence),
      heartRate: heart, vo2, warnings: unique(warnings), sources: SOURCES,
      methodology: { exponent: EXPONENT, scoreIsProbability: false, intervalIsConfidenceInterval: false, vo2AffectsScore: false }
    };
  }

  return Object.freeze({ evaluate, heartRate, collectRecords, parseDate: dayValue, standardDistance, clock, SOURCES, HALF, FULL, EXPONENT });
});
