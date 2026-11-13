'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const TargetPlan = require('../src/target-plan.js');

const baseInput = { targetSeconds: 6300, raceDate: '2026-10-18', fromDate: '2026-08-31' };
const plan = overrides => TargetPlan.build({ ...baseInput, ...overrides });
const week = index => TargetPlan.weekTemplate(index, 6300);
const approximately = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should equal ${expected}`);
const prescription = session => ({
  kind: session.kind, title: session.title, distanceKm: session.distanceKm,
  distanceRange: session.distanceRange, durationMinutes: session.durationMinutes,
  displayAmount: session.displayAmount,
  segments: session.segments.map(({ label, role, distanceKm, distanceRange, durationMinutes }) => ({ label, role, distanceKm, distanceRange, durationMinutes }))
});

test('the 1:45 reference preserves every weekly workout and Sunday long run', () => {
  const result = plan();
  assert.equal(result.valid, true);
  assert.equal(result.weeks.length, 7);
  assert.deepEqual(result.weeks.map(item => item.templateWeek), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(result.weeks.map(item => item.sessions[2].distanceKm || item.sessions[2].distanceRange), [8, 8, 12, 10, 8, 9, [5, 6]]);
  assert.deepEqual(result.weeks.map(item => item.sessions[6].distanceKm || item.sessions[6].distanceRange), [15, 15, 16, 16, 15, [12, 14], 21.0975]);
  for (const index of [0, 1, 2, 3, 4]) {
    for (const day of [0, 3]) {
      assert.deepEqual(result.weeks[index].sessions[day].durationMinutes, [50, 60]);
      assert.deepEqual(result.weeks[index].sessions[day].segments[0].pace, [360, 390]);
    }
  }
  assert.deepEqual(week(0).sessions[2].segments[0].pace, [290, 295]);
  assert.deepEqual(week(3).sessions[2].segments[0].pace, [290, 295]);
  assert.equal(week(0).sessions[2].displayAmount, '连续 8 km');
  assert.equal(week(3).sessions[2].displayAmount, '连续 10 km');
});

test('2K × 3 has exactly two 1K recoveries at 5:40, totaling 8K before warmup/cooldown', () => {
  for (const index of [1, 4]) {
    const session = week(index).sessions[2];
    assert.deepEqual(session.segments.map(segment => [segment.role, segment.distanceKm, ...segment.pace]), [
      ['interval', 2, 285, 290], ['recovery', 1, 340, 340],
      ['interval', 2, 285, 290], ['recovery', 1, 340, 340],
      ['interval', 2, 285, 290]
    ]);
    assert.deepEqual(session.totalKm, [8, 8]);
    assert.equal(session.segments.reduce((sum, item) => sum + item.distanceKm, 0), 8);
    assert.match(session.notes.join(' '), /热身、放松另计/);
    assert.match(session.paceLines[1], /5:40/);
  }
});

test('progressive runs and the 16K self-test retain the reference splits', () => {
  assert.deepEqual(week(2).sessions[2].segments.map(segment => [segment.distanceKm, ...segment.pace]), [
    [4, 335, 335], [4, 315, 315], [4, 290, 295]
  ]);
  assert.deepEqual(week(5).sessions[2].segments.map(segment => [segment.distanceKm, ...segment.pace]), [
    [3, 335, 335], [3, 315, 315], [3, 290, 295]
  ]);
  for (const index of [1, 4]) assert.deepEqual(week(index).sessions[6].segments.map(segment => [segment.distanceKm, ...segment.pace]), [
    [5, 360, 360], [5, 330, 330], [5, 295, 300]
  ]);
  assert.deepEqual(week(3).sessions[6].segments.map(segment => [segment.distanceKm, ...segment.pace]), [
    [10, 320, 325], [6, 295, 295]
  ]);
  assert.match(week(3).sessions[6].notes[0], /不代表保证/);
});

test('strength durations and the last two weeks taper without changing the original prescription', () => {
  assert.deepEqual(Array.from({ length: 7 }, (_, index) => week(index).sessions[4].durationMinutes), [
    [20, 30], [20, 30], [20, 30], [20, 20], [20, 30], [15, 20], [10, 15]
  ]);
  assert.deepEqual(week(5).sessions[0].durationMinutes, [40, 50]);
  assert.deepEqual(week(5).sessions[3].durationMinutes, [40, 50]);
  assert.deepEqual(week(6).sessions[0].durationMinutes, [35, 45]);
  assert.deepEqual(week(6).sessions[3].durationMinutes, [30, 40]);
  assert.deepEqual(week(5).sessions[6].distanceRange, [12, 14]);
  assert.deepEqual(week(6).sessions[2].distanceRange, [5, 6]);
  assert.deepEqual(week(6).sessions[2].segments[0].pace, [298, 298]);
});

test('paces absent from two image cells are explicitly identified as inherited references', () => {
  for (const session of [week(4).sessions[0], week(6).sessions[3]]) {
    assert.equal(session.paceSource, 'inherited_easy_reference');
    assert.match(session.paceLines.join(' '), /沿用有氧参考/);
    assert.match(session.notes.join(' '), /原图此格未标数字配速/);
    assert.deepEqual(session.segments[0].pace, [360, 390]);
  }
  assert.match(week(4).sessions[0].notes.join(' '), /恢复优先/);
});

test('race day keeps 105 minutes exactly and distinguishes 4:59 rounded race pace from 4:58 activation', () => {
  const result = plan(), race = result.weeks[6].sessions[6];
  assert.equal(race.targetSeconds, 6300);
  approximately(race.segments[0].pace[0] * race.distanceKm, 6300);
  approximately(result.targetPace, 6300 / 21.0975);
  assert.equal(result.templateRacePace, 298);
  assert.match(race.paceLines[0], /4:59/);
  assert.match(race.notes.join(' '), /4:58.6/);
  assert.equal(result.weeks[6].sessions[2].segments[0].pace[0], 298);
});

test('the 1:50 image is a second exact anchor, with easy and quality paces calibrated separately', () => {
  const result = plan({ targetSeconds: 6600 });
  assert.equal(result.calibration.mode, 'reference');
  assert.equal(result.calibration.exactAnchorTarget, 6600);
  assert.match(result.calibration.label, /1:50/);
  assert.deepEqual(result.weeks.map(item => item.sessions[2].distanceKm || item.sessions[2].distanceRange), [8, 8, 12, 10, 8, 9, [5, 6]]);
  assert.deepEqual(result.weeks.map(item => item.sessions[6].distanceKm || item.sessions[6].distanceRange), [15, 15, 16, 16, 15, [12, 14], 21.0975]);
  for (const index of [0, 1, 2, 3, 4]) {
    for (const day of [0, 3]) {
      assert.deepEqual(result.weeks[index].sessions[day].durationMinutes, [50, 60]);
      assert.deepEqual(result.weeks[index].sessions[day].segments[0].pace, [370, 400]);
    }
  }
  for (const index of [0, 3]) assert.deepEqual(result.weeks[index].sessions[2].segments[0].pace, [305, 310]);
  for (const index of [1, 4]) {
    assert.deepEqual(result.weeks[index].sessions[2].segments.map(segment => [segment.role, segment.distanceKm, ...segment.pace]), [
      ['interval', 2, 300, 305], ['recovery', 1, 355, 355],
      ['interval', 2, 300, 305], ['recovery', 1, 355, 355], ['interval', 2, 300, 305]
    ]);
    assert.deepEqual(result.weeks[index].sessions[6].segments.map(segment => [segment.distanceKm, ...segment.pace]), [
      [5, 370, 370], [5, 345, 345], [5, 310, 315]
    ]);
  }
  assert.deepEqual(result.weeks[2].sessions[2].segments.map(segment => [segment.distanceKm, ...segment.pace]), [
    [4, 350, 350], [4, 330, 330], [4, 305, 310]
  ]);
  assert.deepEqual(result.weeks[5].sessions[2].segments.map(segment => [segment.distanceKm, ...segment.pace]), [
    [3, 350, 350], [3, 330, 330], [3, 305, 310]
  ]);
  assert.deepEqual(result.weeks[3].sessions[6].segments.map(segment => [segment.distanceKm, ...segment.pace]), [
    [10, 335, 340], [6, 310, 312]
  ]);
  for (const index of [0, 2, 5]) assert.deepEqual(result.weeks[index].sessions[6].segments[0].pace, [370, 400]);
  assert.deepEqual(result.weeks[5].sessions[0].durationMinutes, [40, 50]);
  assert.deepEqual(result.weeks[5].sessions[3].durationMinutes, [40, 50]);
  assert.deepEqual(result.weeks[6].sessions[0].durationMinutes, [35, 45]);
  assert.deepEqual(result.weeks[6].sessions[3].durationMinutes, [30, 40]);
  assert.deepEqual(result.weeks.map(item => item.sessions[4].durationMinutes), [[20, 30], [20, 30], [20, 30], [20, 20], [20, 30], [15, 20], [10, 15]]);
  assert.deepEqual(result.weeks[6].sessions[2].segments[0].pace, [312, 312]);
  assert.match(result.weeks[3].sessions[6].paceLines[1], /5:10–5:12/);
});

test('110 minutes keeps the image activation pace and the exact race target distinct', () => {
  const result = plan({ targetSeconds: 6600 });
  const race = result.weeks[6].sessions[6];
  assert.equal(race.targetSeconds, 6600);
  approximately(race.segments[0].pace[0] * race.distanceKm, 6600);
  assert.equal(result.templateRacePace, 312);
  assert.match(race.paceLines[0], /5:13/);
  assert.match(race.notes.join(' '), /5:12.8/);
});

test('107:30 interpolates each course and each range endpoint without changing the seven-week prescription', () => {
  const result = plan({ targetSeconds: 6450 });
  assert.equal(result.calibration.mode, 'interpolated');
  assert.equal(result.calibration.exactAnchorTarget, null);
  assert.equal(result.calibration.nearestAnchorTarget, null);
  assert.match(result.calibration.description, /每课配速区间的两端插值/);
  assert.deepEqual(result.weeks[0].sessions[0].segments[0].pace, [365, 395]);
  assert.deepEqual(result.weeks[0].sessions[2].segments[0].pace, [297.5, 302.5]);
  assert.deepEqual(result.weeks[1].sessions[2].segments[1].pace, [347.5, 347.5]);
  assert.deepEqual(result.weeks[1].sessions[6].segments.map(segment => segment.pace), [[365, 365], [337.5, 337.5], [302.5, 307.5]]);
  assert.deepEqual(result.weeks[3].sessions[6].segments.map(segment => segment.pace), [[327.5, 332.5], [302.5, 303.5]]);
  assert.deepEqual(result.weeks[6].sessions[2].segments[0].pace, [305, 305]);
  approximately(result.weeks[6].sessions[6].segments[0].pace[0] * 21.0975, 6450);
  result.weeks.forEach((item, index) => item.sessions.forEach((session, day) => assert.deepEqual(prescription(session), prescription(week(index).sessions[day]))));
});

test('goals outside the observed range use the nearest anchor and disclose extrapolation', () => {
  for (const [target, anchor] of [[7200, 6600], [5700, 6300]]) {
    const reference = plan({ targetSeconds: anchor });
    const mapped = plan({ targetSeconds: target });
    const expectedDelta = (target - anchor) / 21.0975;
    assert.equal(mapped.calibration.mode, 'extrapolated');
    assert.equal(mapped.calibration.nearestAnchorTarget, anchor);
    assert.equal(mapped.calibration.exactAnchorTarget, null);
    assert.match(mapped.calibration.description, /外推参考/);
    reference.weeks.forEach((sourceWeek, index) => {
      sourceWeek.sessions.forEach((source, day) => {
        const changed = mapped.weeks[index].sessions[day];
        assert.deepEqual(prescription(changed), prescription(source));
        source.segments.forEach((segment, part) => {
          for (const bound of [0, 1]) approximately(changed.segments[part].pace[bound] - segment.pace[bound], expectedDelta);
        });
      });
    });
    approximately(mapped.targetPace - reference.targetPace, expectedDelta);
  }
});

test('course paces are continuous at both anchor boundaries and never reverse their ranges', () => {
  for (const target of [6300, 6600]) {
    const before = plan({ targetSeconds: target - 0.001 });
    const exact = plan({ targetSeconds: target });
    const after = plan({ targetSeconds: target + 0.001 });
    exact.weeks.forEach((item, index) => item.sessions.forEach((session, day) => session.segments.forEach((segment, part) => {
      for (const bound of [0, 1]) {
        approximately(before.weeks[index].sessions[day].segments[part].pace[bound], segment.pace[bound], 0.0001);
        approximately(after.weeks[index].sessions[day].segments[part].pace[bound], segment.pace[bound], 0.0001);
      }
    })));
  }
  for (const targetSeconds of [5700, 6300, 6450, 6600, 7200, 10800]) {
    const result = plan({ targetSeconds });
    assert.ok(result.weeks.flatMap(item => item.sessions).flatMap(item => item.segments).every(item => item.pace[0] <= item.pace[1]));
  }
});

test('all personal capability inputs are ignored by the main prescription', () => {
  for (const targetSeconds of [6300, 6450, 6600, 7200]) {
    const reference = plan({ targetSeconds });
    const weak = plan({ targetSeconds, weeklyKm: 5, longestRun: 3, longRun: 3, runDays: 2, personal: { restingHr: 90, maxHr: 160, vo2max: 25 }, records: [{ elapsedSeconds: 9000 }], assessment: { fit: { score: 10 } } });
    const strong = plan({ targetSeconds, weeklyKm: 120, longestRun: 35, longRun: 35, runDays: 7, personal: { restingHr: 40, maxHr: 200, vo2max: 70 }, records: [{ elapsedSeconds: 4500 }], assessment: { fit: { score: 99 } } });
    assert.deepEqual(weak, reference);
    assert.deepEqual(strong, reference);
  }
});

test('Sunday races use the image Monday-to-Sunday rhythm and stop on race day', () => {
  const result = plan();
  assert.equal(result.weeks[0].startDate, '2026-08-31');
  assert.equal(result.weeks.at(-1).endDate, '2026-10-18');
  for (const current of result.weeks) {
    assert.deepEqual(current.sessions.map(session => session.weekday), [1, 2, 3, 4, 5, 6, 0]);
    assert.deepEqual(current.sessions.map(session => session.kind), ['easy', 'rest', 'quality', 'easy', 'strength', 'rest', current.templateWeek === 7 ? 'race' : 'long']);
    assert.ok(current.sessions.every(session => session.date <= '2026-10-18'));
  }
  assert.equal(result.weeks[6].sessions[5].date, '2026-10-17');
  assert.equal(result.weeks[6].sessions[5].kind, 'rest');
});

test('non-Sunday races shift the entire cycle, retaining rest on the preceding day', () => {
  const result = plan({ raceDate: '2026-10-15', fromDate: '2026-08-28' });
  assert.equal(result.weeks.length, 7);
  assert.deepEqual(result.weeks[0].sessions.map(session => session.weekday), [5, 6, 0, 1, 2, 3, 4]);
  const final = result.weeks.at(-1).sessions;
  assert.equal(final[5].date, '2026-10-14');
  assert.equal(final[5].kind, 'rest');
  assert.equal(final[6].date, '2026-10-15');
  assert.equal(final[6].kind, 'race');
  assert.ok(result.weeks.flatMap(item => item.sessions).every(session => session.date <= '2026-10-15'));
  assert.match(result.notes.join(' '), /整体平移/);
});

test('short horizons preserve original week numbers and forbid makeup of passed sessions', () => {
  const result = plan({ fromDate: '2026-10-08' });
  assert.deepEqual(result.weeks.map(item => item.templateWeek), [6, 7]);
  assert.equal(result.weeks[0].startDate, '2026-10-05');
  assert.equal(result.weeks[0].partial, true);
  assert.deepEqual(result.weeks[0].sessions.map(session => session.past), [true, true, true, false, false, false, false]);
  assert.ok(result.weeks[0].sessions.slice(0, 3).every(session => session.canComplete === false));
  assert.match(result.weeks[0].sessions[2].notes.join(' '), /不安排补训/);
  assert.deepEqual(prescription(result.weeks[0].sessions[2]), prescription(week(5).sessions[2]));
  assert.ok(result.weeks[0].remainingKm[0] < result.weeks[0].totalKm[0]);
  assert.match(result.notes.join(' '), /不压缩或合并/);
});

test('additional bridge weeks are labeled and leave all seven dated core weeks unchanged', () => {
  const original = plan();
  const extended = plan({ fromDate: '2026-07-06' });
  assert.equal(extended.summary.bridgeWeeks, 8);
  assert.equal(extended.weeks.length, 15);
  const bridges = extended.weeks.filter(item => item.templateWeek === null);
  assert.deepEqual(bridges.map(item => item.label), bridges.map((item, index) => '第 ' + (index + 1) + ' 周'));
  assert.ok(bridges.every(item => item.phase === '衔接期'));
  assert.ok(bridges.every(item => item.sessions.filter(session => ['easy', 'long'].includes(session.kind)).length === 3));
  assert.deepEqual(bridges.map(item => item.sessions[6].distanceKm), [10, 10, 10, 11, 11, 11, 12, 12]);
  extended.weeks.slice(8).forEach((actual, index) => {
    assert.equal(actual.startDate, original.weeks[index].startDate);
    assert.deepEqual(actual.sessions, original.weeks[index].sessions);
    assert.deepEqual(actual.totalKm, original.weeks[index].totalKm);
  });
});

test('1:50 bridge work uses its easy pace while preserving the exact core template', () => {
  const original = plan({ targetSeconds: 6600 });
  const extended = plan({ targetSeconds: 6600, fromDate: '2026-08-17' });
  assert.equal(extended.summary.bridgeWeeks, 2);
  for (const current of extended.weeks.slice(0, 2)) {
    for (const session of current.sessions.filter(item => ['easy', 'long'].includes(item.kind))) {
      assert.deepEqual(session.segments[0].pace, [370, 400]);
    }
  }
  extended.weeks.slice(2).forEach((current, index) => assert.deepEqual(current.sessions, original.weeks[index].sessions));
});

test('duration-based distances remain estimates and weekly volumes are ranges', () => {
  const result = plan();
  const easy = result.weeks[0].sessions[0];
  assert.equal(easy.distanceKm, undefined);
  assert.equal(easy.distanceRange, undefined);
  assert.equal(easy.estimatedKm, true);
  assert.deepEqual(easy.durationMinutes, [50, 60]);
  approximately(easy.totalKm[0], 50 * 60 / 390, 0.005);
  approximately(easy.totalKm[1], 60 * 60 / 360, 0.005);
  assert.deepEqual(result.weeks[0].totalKm, [38.38, 43]);
  assert.deepEqual(result.summary.peakKm, [43.38, 48]);
  assert.equal(result.summary.longestKm, 16);
  assert.equal(result.summary.volumeIsEstimated, true);
  assert.match(result.summary.volumeNote, /热身、放松不计入/);
  assert.ok(result.weeks[6].totalKm[0] > result.weeks[6].sessions[6].distanceKm);
});

test('invalid times, dates and horizons return actionable errors without fabricated plans', () => {
  const invalid = [
    { targetSeconds: 0 }, { targetSeconds: -6300 }, { targetSeconds: 'x' }, { targetSeconds: '' },
    { targetSeconds: Infinity }, { targetSeconds: {} }, { targetSeconds: 60000 },
    { raceDate: '2026-02-30' }, { raceDate: '2026-13-01' }, { raceDate: '2026-2-01' },
    { fromDate: '2026-10-19' }, { fromDate: '2026-02-29' }, { fromDate: '2026-05-03' }, { fromDate: undefined }
  ];
  for (const overrides of invalid) {
    const result = plan(overrides);
    assert.equal(result.valid, false, JSON.stringify(overrides));
    assert.equal(typeof result.error, 'string');
    assert.deepEqual(result.weeks, []);
    assert.equal(result.summary, null);
    assert.ok(!JSON.stringify(result).includes('NaN'));
  }
  assert.throws(() => TargetPlan.weekTemplate(-1, 6300), RangeError);
  assert.throws(() => TargetPlan.weekTemplate(7, 6300), RangeError);
  assert.throws(() => TargetPlan.weekTemplate(0.5, 6300), RangeError);
  assert.throws(() => TargetPlan.weekTemplate(0, 'invalid'), RangeError);
});

test('the exact 24-week boundary and same-day view fit calendar limits', () => {
  const maximum = plan({ fromDate: '2026-05-04' });
  assert.equal(maximum.valid, true);
  assert.equal(maximum.weeks.length, 24);
  assert.equal(maximum.weeks.flatMap(item => item.sessions).length, 168);
  assert.equal(plan({ fromDate: '2026-05-03' }).valid, false);
  const raceDay = plan({ fromDate: '2026-10-18' });
  assert.equal(raceDay.valid, true);
  assert.deepEqual(raceDay.weeks.map(item => item.templateWeek), [7]);
  assert.ok(raceDay.weeks[0].sessions.slice(0, 6).every(session => session.past && !session.canComplete));
  assert.equal(raceDay.weeks[0].sessions[6].past, false);
  assert.equal(raceDay.summary.longestKm, 0);
});

test('UTC date arithmetic handles a leap day without duplicated or missing calendar dates', () => {
  const result = plan({ raceDate: '2028-03-05', fromDate: '2028-01-17' });
  assert.equal(result.valid, true);
  const dates = result.weeks.flatMap(item => item.sessions).map(session => session.date);
  assert.equal(dates.length, 49);
  assert.equal(new Set(dates).size, 49);
  assert.ok(dates.includes('2028-02-29'));
  for (let index = 1; index < dates.length; index += 1) assert.equal(Date.parse(dates[index]) - Date.parse(dates[index - 1]), 86400000);
});

test('returns are independent across goals and profiles, with a browser classic-script export', () => {
  const original = week(1);
  const changed = week(1);
  changed.sessions[2].segments[0].pace[0] = 999;
  changed.sessions[0].durationMinutes[0] = 5;
  assert.deepEqual(week(1), original);
  const input = { ...baseInput, personal: { maxHr: 190 } }, before = JSON.stringify(input);
  TargetPlan.build(input);
  assert.equal(JSON.stringify(input), before);
  const browser = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/target-plan.js'), 'utf8'), browser);
  assert.equal(typeof browser.TargetPlan.build, 'function');
  assert.equal(browser.TargetPlan.build(baseInput).valid, true);
});
