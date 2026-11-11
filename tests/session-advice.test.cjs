const test = require('node:test');
const assert = require('node:assert/strict');
const Advice = require('../src/session-advice.js');
const TargetPlan = require('../src/target-plan.js');

function assessment(pace = 300, extra = {}) {
  return {
    equivalentPace: pace,
    equivalentSeconds: pace * 21.0975,
    evidence: { count: 2, confidence: 'high', newestAgeDays: 12 },
    fit: { hold: false },
    paces: { easy: [pace * 1.16, pace * 1.32], recovery: [pace * 1.25, pace * 1.42], long: [pace * 1.16, pace * 1.32], tempo: [pace * .96, pace * 1.01], interval: [pace * .9, pace * .95], race: [200, 200] },
    heartRate: { targets: { easy: { min: 120, max: 140 }, long: { min: 120, max: 140 }, recovery: { min: 110, max: 120 }, steady: { min: 140, max: 155 }, tempo: { min: 155, max: 170 }, interval: { min: null, max: null, note: '按体感，不追心率' }, race: { min: null, max: null, note: '按比赛体感' } } },
    ...extra
  };
}
const foundation = { weeklyKm: 50, longestRun: 18, runDays: 4, personal: { recentConsistency: 'stable' } };
function frozen(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}

test('annotation never changes frozen target sessions, plan, assessment, or context', () => {
  const plan = frozen({ weeks: [TargetPlan.weekTemplate(1, 6300)] });
  const evidence = frozen(assessment()), context = frozen({ ...foundation, weekKm: plan.weeks[0].totalKm });
  const before = JSON.stringify({ plan, evidence, context });
  Advice.forSession(plan.weeks[0].sessions[2], evidence, context);
  Advice.forPlan(plan, evidence, context);
  assert.equal(JSON.stringify({ plan, evidence, context }), before);
  assert.deepEqual(plan.weeks[0].sessions[2].segments.filter(s => s.role === 'interval').map(s => s.distanceKm), [2, 2, 2]);
});

test('weaker ability changes advice and difficulty while the same target pace stays intact', () => {
  const session = TargetPlan.weekTemplate(0, 6300).sessions[0];
  const main = JSON.stringify(session);
  const strong = Advice.forSession(session, assessment(290), foundation);
  const weak = Advice.forSession(session, assessment(400), foundation);
  assert.equal(strong.level, 'matched');
  assert.equal(weak.level, 'high');
  assert.notEqual(strong.paceText, weak.paceText);
  assert.match(weak.reason, /目标主段/);
  assert.equal(JSON.stringify(session), main);
});

test('missing or old performance is unknown while independent heart-rate advice remains available', () => {
  const session = TargetPlan.weekTemplate(0, 6300).sessions[6];
  const missing = assessment(null, { equivalentPace: null, evidence: { count: 0, confidence: 'low' }, paces: {} });
  const result = Advice.forSession(session, missing, { ...foundation, longestRun: 5 });
  assert.equal(result.level, 'unknown');
  assert.equal(result.paceText, '待补充近期成绩');
  assert.match(result.reason, /最长跑 5/);
  assert.match(result.heartText, /120–140 bpm/);
  const old = Advice.forSession(session, assessment(300, { evidence: { count: 1, newestAgeDays: 200, confidence: 'low' } }), foundation);
  assert.equal(old.level, 'unknown');
  assert.match(old.reason, /180 天/);
});

test('large distance increase is visible even when speed matches ability', () => {
  const session = TargetPlan.weekTemplate(0, 6300).sessions[6];
  const result = Advice.forSession(session, assessment(290), { ...foundation, longestRun: 8 });
  assert.equal(result.level, 'high');
  assert.match(result.reason, /15 km/);
  assert.match(result.reason, /最长跑 8 km/);
});

test('pain or illness blocks execution recommendations without removing the main session', () => {
  const session = TargetPlan.weekTemplate(3, 6300).sessions[2];
  const before = JSON.stringify(session);
  const result = Advice.forSession(session, assessment(300, { fit: { hold: true } }), foundation);
  assert.equal(result.level, 'hold');
  assert.equal(result.paceLines.length, 0);
  assert.equal(result.heartText, '');
  assert.equal(JSON.stringify(session), before);
  assert.equal(Advice.forSession(session, assessment(), { ...foundation, personal: { discomfort: 'illness' } }).level, 'hold');
});

test('2 km repetitions use tempo advice and collapse to two lines, retaining three main repeats', () => {
  const session = TargetPlan.weekTemplate(1, 6300).sessions[2];
  const result = Advice.forSession(session, assessment(300), foundation);
  assert.equal(result.paceLines.length, 2);
  assert.match(result.paceLines[0], /4:48–5:03/);
  assert.match(result.paceLines[1], /6:15–7:06/);
  assert.doesNotMatch(result.paceLines[0], /4:30/);
  assert.match(result.heartText, /不追数字/);
  assert.equal(session.segments.filter(s => s.role === 'interval').length, 3);
  assert.equal(session.totalKm[0], 8);
});

test('progressive suggestions keep distinct slow-to-fast steady stages', () => {
  const session = TargetPlan.weekTemplate(2, 6300).sessions[2];
  const result = Advice.forSession(session, assessment(300), foundation);
  assert.equal(result.paceLines.length, 3);
  assert.match(result.paceLines[0], /前段 5:26–5:48/);
  assert.match(result.paceLines[1], /中段 5:03–5:26/);
  assert.match(result.paceLines[2], /后段 4:48–5:03/);
  assert.ok(result.notes.some(n => n.includes('经验过渡')));
});

test('race personal advice uses current equivalent ability, never paces.race target', () => {
  const session = TargetPlan.weekTemplate(6, 6300).sessions[6];
  const result = Advice.forSession(session, assessment(360), foundation);
  assert.match(result.paceText, /6:00\/km/);
  assert.doesNotMatch(result.paceText, /3:20/);
  assert.equal(result.level, 'high');
});

test('long continuous tempo volume flags demand even when speed is appropriate', () => {
  const session = TargetPlan.weekTemplate(3, 6300).sessions[2];
  const result = Advice.forSession(session, assessment(300), foundation);
  assert.equal(result.level, 'challenge');
  assert.match(result.reason, /连续较高强度段/);
  assert.equal(session.distanceKm, 10);
});

test('plan reports weekly-load and available-days mismatch rather than altering the schedule', () => {
  const plan = { weeks: [TargetPlan.weekTemplate(0, 6300)] };
  const result = Advice.forPlan(plan, assessment(290), { ...foundation, weeklyKm: 20, runDays: 3 });
  assert.equal(result.level, 'high');
  assert.equal(result.requiredRunDays, 4);
  assert.equal(result.peakKm[1], 43);
  assert.ok(result.reasons.some(reason => reason.includes('20 km/周')));
  assert.ok(result.reasons.some(reason => reason.includes('每周 3 天')));
  assert.equal(plan.weeks[0].sessions.filter(s => ['easy', 'quality', 'long'].includes(s.kind)).length, 4);
});

test('plan with no performance keeps load warnings but makes no difficulty determination', () => {
  const plan = { weeks: [TargetPlan.weekTemplate(0, 6300)] };
  const result = Advice.forPlan(plan, assessment(null, { equivalentPace: null, evidence: { count: 0 }, paces: {} }), { ...foundation, weeklyKm: 15 });
  assert.equal(result.level, 'unknown');
  assert.ok(result.reasons.some(reason => reason.includes('15 km/周')));
  assert.equal('probability' in result, false);
  assert.match(Advice.RULES, /产品规则/);
});

test('plan counts only remaining sessions and does not impose four runs on bridge or partial weeks', () => {
  const sessions = [
    { ...TargetPlan.weekTemplate(0, 6300).sessions[0], date: '2026-11-09' },
    { ...TargetPlan.weekTemplate(0, 6300).sessions[2], date: '2026-11-11' },
    { ...TargetPlan.weekTemplate(0, 6300).sessions[6], date: '2026-11-15' }
  ];
  const result = Advice.forPlan({ weeks: [{ sessions }] }, assessment(280), { ...foundation, runDays: 2, now: '2026-11-11' });
  assert.equal(result.requiredRunDays, 2);
  assert.deepEqual(result.peakKm, [23, 23]);
  assert.ok(!result.reasons.some(reason => reason.includes('每周 2 天')));
});

test('per-session context accepts integration weekKm and requiredRunDays fields', () => {
  const session = TargetPlan.weekTemplate(0, 6300).sessions[0];
  const result = Advice.forSession(session, assessment(280), { ...foundation, weekKm: [38, 43], weeklyKm: 25, requiredRunDays: 4, runDays: 3 });
  assert.equal(result.level, 'high');
  assert.ok(result.reasons.some(reason => reason.includes('25 km/周')));
  assert.ok(result.reasons.some(reason => reason.includes('每周 3 天')));
});

test('missing training foundation keeps performance-based pace but cannot claim overall match', () => {
  const week = TargetPlan.weekTemplate(0, 6300), evidence = assessment(280);
  for (const gaps of [{ weeklyKm: null, longestRun: null }, { weeklyKm: '', longestRun: 18 }, { weeklyKm: 50, longestRun: null }]) {
    const context = { ...foundation, ...gaps };
    const session = Advice.forSession(week.sessions[0], evidence, context);
    const plan = Advice.forPlan({ weeks: [week] }, evidence, context);
    for (const result of [session, plan]) {
      assert.equal(result.level, 'unknown');
      assert.match(result.label, /基础待补充/);
      assert.match(result.reason, /尚未填写/);
      assert.doesNotMatch(result.reason, /训练基础目前较匹配|当前已知能力、跑量和训练天数较匹配/);
    }
    assert.ok(session.paceLines.length > 0);
    assert.match(session.paceText, /\/km/);
  }
});

test('explicit zero foundation flags high difficulty without division by zero while absent performance stays unknown', () => {
  const week = TargetPlan.weekTemplate(0, 6300);
  for (const zero of [{ weeklyKm: 0 }, { longestRun: 0 }, { weeklyKm: 0, longestRun: 0 }]) {
    const context = { ...foundation, ...zero };
    const session = Advice.forSession(week.sessions[0], assessment(280), context);
    const plan = Advice.forPlan({ weeks: [week] }, assessment(280), context);
    for (const result of [session, plan]) {
      assert.equal(result.level, 'high');
      assert.match(result.reason, /填写为 0.*尚无稳定/);
      assert.doesNotMatch(JSON.stringify(result), /Infinity|NaN/);
    }
    const missing = assessment(null, { equivalentPace: null, evidence: { count: 0 }, paces: {} });
    assert.equal(Advice.forSession(week.sessions[0], missing, context).level, 'unknown');
    assert.equal(Advice.forPlan({ weeks: [week] }, missing, context).level, 'unknown');
  }
});
