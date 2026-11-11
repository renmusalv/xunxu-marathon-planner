'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const sandbox = { module: { exports: {} }, Date, console };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/assessment.js'), 'utf8'), sandbox);
const engine = sandbox.module.exports;

const record = (overrides = {}) => ({
  id: 'test-10k', distanceKm: 10, elapsedSeconds: 3000, date: '2026-11-01',
  effort: 'race', confirmed: true, include: true, durationType: 'elapsed', course: 'road_flat',
  source: 'manual', averageHr: 158, peakHr: 177, ...overrides
});
const input = (overrides = {}) => ({
  distanceKm: 21.0975, targetSeconds: 6900, raceDate: '2027-01-10',
  weeklyKm: 35, longestRun: 17, runDays: 4, now: '2026-11-11',
  records: [record()], personal: { recentConsistency: 'stable' }, ...overrides
});
const evaluate = overrides => engine.evaluate(input(overrides));

test('10 km 50:00 uses exponent 1.07, with a non-statistical scenario range', () => {
  const result = evaluate();
  const expected = 3000 * Math.pow(21.0975 / 10, 1.07);
  assert.ok(Math.abs(result.equivalentSeconds - expected) < 0.0001);
  assert.ok(result.range[0] < expected && result.range[1] > expected);
  assert.equal(result.methodology.scoreIsProbability, false);
  assert.equal(result.methodology.intervalIsConfidenceInterval, false);
});

test('same-distance half-marathon result is preserved exactly', () => {
  const result = evaluate({ records: [record({ distanceKm: 21.0975, elapsedSeconds: 6300 })] });
  assert.ok(Math.abs(result.equivalentSeconds - 6300) < 0.0001);
});

test('changing only the goal does not accelerate training paces', () => {
  const moderate = evaluate({ targetSeconds: 7200 });
  const aggressive = evaluate({ targetSeconds: 5400 });
  for (const type of ['easy', 'long', 'recovery', 'tempo', 'interval']) assert.deepEqual(moderate.paces[type], aggressive.paces[type]);
  assert.ok(aggressive.fit.score < moderate.fit.score);
  assert.notDeepEqual(moderate.paces.race, aggressive.paces.race);
});

test('no valid evidence yields no training paces or compatibility score', () => {
  const result = evaluate({ records: [] });
  assert.equal(result.fit.score, null);
  assert.equal(result.equivalentSeconds, null);
  assert.equal(result.paces.easy, null);
  assert.equal(result.heartRate.method, 'effort');
  assert.ok(result.heartRate.zones.every(zone => zone.min === null && zone.max === null));
});

test('ordinary training, unconfirmed OCR, opted-out, moving time and unknown time are not race capability', () => {
  const variants = [{ effort: 'training' }, { confirmed: false }, { include: false }, { durationType: 'moving' }, { durationType: 'unknown' }, { durationType: undefined }];
  for (const variant of variants) assert.equal(evaluate({ records: [record(variant)] }).fit.score, null, JSON.stringify(variant));
});

test('hilly, trail and treadmill records remain excluded from flat road estimates', () => {
  for (const course of ['hilly', 'trail', 'treadmill']) {
    const result = evaluate({ records: [record({ course })] });
    assert.equal(result.equivalentSeconds, null);
    assert.match(result.evidence.excludedRecords[0].reason, /仅留档/);
  }
});

test('future, invalid and older than 365-day results cannot influence estimates', () => {
  for (const date of ['2026-11-12', '2026-02-30', '2025-11-10', 'not a date']) {
    const result = evaluate({ records: [record({ date })] });
    assert.equal(result.equivalentSeconds, null, date);
  }
  assert.notEqual(evaluate({ records: [record({ date: '2025-11-11' })] }).equivalentSeconds, null);
});

test('181-day-old evidence gives historical references but no current fit score', () => {
  const old = evaluate({ records: [record({ date: '2026-01-01' })] });
  assert.notEqual(old.equivalentSeconds, null);
  assert.equal(old.fit.score, null);
  assert.equal(old.evidence.confidence, 'low');
});

test('multiple screenshots of the same event do not increase evidence weight', () => {
  const one = evaluate();
  const duplicates = evaluate({ records: [record(), record({ id: 'copy', source: 'screenshot' })] });
  assert.equal(duplicates.evidence.count, 1);
  assert.equal(duplicates.equivalentSeconds, one.equivalentSeconds);
  assert.equal(duplicates.evidence.confidence, one.evidence.confidence);
});

test('a recent result has higher weight than an older result', () => {
  const result = evaluate({ records: [record({ id: 'new', date: '2026-11-10', elapsedSeconds: 3200 }), record({ id: 'old', date: '2026-02-01', elapsedSeconds: 2700 })] });
  const newest = result.evidence.usedRecords.find(item => item.id === 'new');
  const oldest = result.evidence.usedRecords.find(item => item.id === 'old');
  assert.ok(newest.weight > oldest.weight);
  assert.ok(Math.abs(result.equivalentSeconds - newest.equivalentSeconds) < Math.abs(result.equivalentSeconds - oldest.equivalentSeconds));
});

test('unknown route decreases confidence and widens the scenario interval', () => {
  const flat = evaluate();
  const unknown = evaluate({ records: [record({ course: 'unknown' })] });
  assert.equal(unknown.evidence.confidence, 'low');
  assert.ok(unknown.range[1] - unknown.range[0] > flat.range[1] - flat.range[0]);
});

test('short-distance results are never extrapolated to a marathon', () => {
  const result = evaluate({ distanceKm: 42.195, targetSeconds: 14400 });
  assert.equal(result.equivalentSeconds, null);
  assert.equal(result.fit.score, null);
  const full = evaluate({ distanceKm: 42.195, targetSeconds: 14400, records: [record({ distanceKm: 42.195, elapsedSeconds: 14200 })] });
  assert.ok(Math.abs(full.equivalentSeconds - 14200) < 0.0001);
});

test('HRR uses explicitly provided resting/max heart rates, not race average', () => {
  const result = evaluate({ personal: { restingHr: 50, maxHr: 190, maxHrSource: 'measured' } });
  assert.equal(result.heartRate.method, 'hrr');
  const easy = result.heartRate.zones.find(zone => zone.id === 'easy');
  assert.equal(easy.min, 106);
  assert.equal(easy.max, 133);
  assert.equal(result.heartRate.maxHr, 190);
});

test('age and race peak alone never create an assumed personal maximum', () => {
  const result = evaluate({ personal: { age: 35 }, records: [record({ averageHr: 170, peakHr: 190 })] });
  assert.equal(result.heartRate.method, 'effort');
  assert.equal(result.heartRate.maxHr, null);
});

test('max-only and threshold-only inputs select their own clearly named methods', () => {
  assert.equal(evaluate({ personal: { maxHr: 190, maxHrSource: 'measured' } }).heartRate.method, 'hrmax');
  const threshold = evaluate({ personal: { thresholdHr: 170, thresholdHrSource: 'field' } });
  assert.equal(threshold.heartRate.method, 'lthr');
  const easy = threshold.heartRate.zones.find(zone => zone.id === 'easy');
  assert.equal(easy.min, 145);
  assert.equal(easy.max, 152);
});

test('a reliable threshold takes precedence over an observed, non-measured maximum', () => {
  const result = evaluate({ personal: { maxHr: 190, restingHr: 50, maxHrSource: 'observed', thresholdHr: 170, thresholdHrSource: 'lab' } });
  assert.equal(result.heartRate.method, 'lthr');
});

test('average/peak contradictions produce warnings, never silently overwrite HRmax', () => {
  const result = evaluate({ personal: { maxHr: 160, restingHr: 50, maxHrSource: 'measured' }, records: [record({ averageHr: 170, peakHr: 185 })] });
  assert.equal(result.heartRate.maxHr, 160);
  assert.equal(result.heartRate.confidence, 'low');
  assert.ok(result.warnings.some(note => note.includes('平均心率高于')));
  assert.ok(result.warnings.some(note => note.includes('本次最高心率超过')));
  assert.equal(result.heartRate.method, 'effort');
  assert.equal(result.heartRate.conflict, true);
  assert.equal(result.heartRate.label, '心率资料待核对 · 暂用体感');
  assert.ok(result.heartRate.zones.every(zone => zone.min === null && zone.max === null));
  assert.ok(Object.values(result.heartRate.targets).every(target => target.min === null && target.max === null));
});

test('every contradictory heart-rate combination removes all bpm targets, including direct heartRate calls', () => {
  const cases = [
    { personal: { maxHr: 160, restingHr: 50 }, records: [record({ averageHr: 170, peakHr: null })] },
    { personal: { maxHr: 180, restingHr: 50 }, records: [record({ averageHr: 150, peakHr: 185 })] },
    { personal: { maxHr: 190, restingHr: 50 }, records: [record({ averageHr: 170, peakHr: 160 })] },
    { personal: { maxHr: 110, restingHr: 120 }, records: [] },
    { personal: { maxHr: 190, restingHr: 50, thresholdHr: 195 }, records: [] },
    { personal: { maxHr: 999, restingHr: 50, thresholdHr: 170 }, records: [] },
    { personal: { maxHr: 190, restingHr: 'invalid', thresholdHr: 170 }, records: [] }
  ];
  for (const scenario of cases) {
    const result = engine.heartRate(scenario.personal, scenario.records);
    assert.equal(result.method, 'effort', JSON.stringify(scenario));
    assert.equal(result.conflict, true);
    assert.equal(result.formula, '');
    assert.ok(result.warnings.length > 0);
    assert.ok(result.zones.every(zone => zone.min === null && zone.max === null));
    assert.ok(Object.values(result.targets).every(target => target.min === null && target.max === null));
  }
});

test('correcting a heart-rate conflict restores personalized bpm without changing stored inputs', () => {
  const profile = { maxHr: 180, restingHr: 50, maxHrSource: 'measured' };
  const conflictRecord = record({ averageHr: 160, peakHr: 185 });
  assert.equal(engine.heartRate(profile, [conflictRecord]).method, 'effort');
  const corrected = { ...profile, maxHr: 190 };
  const result = engine.heartRate(corrected, [conflictRecord]);
  assert.equal(result.conflict, false);
  assert.equal(result.method, 'hrr');
  assert.equal(result.targets.easy.min, 106);
  assert.equal(profile.maxHr, 180);
  assert.equal(conflictRecord.peakHr, 185);
});

test('VO2max, including a laboratory value, never awards compatibility points', () => {
  const base = evaluate();
  const watch = evaluate({ personal: { recentConsistency: 'stable', vo2max: 60, vo2maxSource: 'watch', vo2maxDate: '2026-11-01' } });
  const lab = evaluate({ personal: { recentConsistency: 'stable', vo2max: 70, vo2maxSource: 'lab', vo2maxDate: '2026-11-01' } });
  assert.equal(base.fit.score, watch.fit.score);
  assert.equal(base.fit.score, lab.fit.score);
  assert.equal(watch.vo2.source, 'watch');
  assert.equal(lab.vo2.source, 'lab');
});

test('reported pain or illness suspends a numeric compatibility verdict', () => {
  for (const discomfort of ['pain', 'illness']) {
    const result = evaluate({ personal: { discomfort } });
    assert.equal(result.fit.score, null);
    assert.equal(result.fit.hold, true);
    assert.match(result.fit.label, /恢复/);
  }
});

test('adherence is included only for enough due sessions; future sessions are not implied', () => {
  const base = evaluate();
  assert.equal(evaluate({ adherence: { due: 2, completed: 0 } }).fit.score, base.fit.score);
  assert.ok(evaluate({ adherence: { due: 10, completed: 3 } }).fit.score < base.fit.score);
  assert.equal(evaluate({ adherence: { due: 3, completed: 5 } }).fit.score, base.fit.score);
});

test('invalid goal, invalid race date and invalid profile values do not create NaN or valid scores', () => {
  for (const invalid of [{ targetSeconds: 1 }, { targetSeconds: 'oops' }, { raceDate: '2026-02-30' }, { raceDate: '2026-11-11' }, { raceDate: '2025-11-11' }, { weeklyKm: ' ' }, { distanceKm: 5 }]) {
    const result = evaluate(invalid);
    assert.equal(result.fit.score, null, JSON.stringify(invalid));
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes('NaN') && !serialized.includes('Infinity'));
  }
});

test('all score deductions are exposed, including the low-foundation cap', () => {
  const result = evaluate({ weeklyKm: 5, longestRun: 3 });
  assert.ok(result.fit.score <= 65);
  assert.equal(result.fit.score, Math.max(0, 100 - result.fit.factors.reduce((sum, factor) => sum + factor.points, 0)));
});

test('evaluation is deterministic and does not mutate or retain another profile', () => {
  const first = input();
  const snapshot = JSON.stringify(first);
  const a = engine.evaluate(first);
  engine.evaluate(input({ records: [record({ elapsedSeconds: 2000 })], personal: { maxHr: 205, restingHr: 42 } }));
  const again = engine.evaluate(first);
  assert.deepEqual(a, again);
  assert.equal(JSON.stringify(first), snapshot);
});
