const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ProfileStore = require('../src/profile-store.js');
const RunningAssessment = require('../src/assessment.js');
const TargetPlan = require('../src/target-plan.js');
const SessionAdvice = require('../src/session-advice.js');

const FIXED_NOW = Date.UTC(2026, 10, 11, 12);

function makeElement(value = '') {
  const attrs = new Map();
  const classes = new Set();
  return {
    value, textContent: '', innerHTML: '', hidden: false, open: false,
    dataset: {}, style: {},
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
      toggle(name, force) { if (force ?? !classes.has(name)) classes.add(name); else classes.delete(name); },
    },
    setAttribute(name, value) { attrs.set(name, value); },
    getAttribute(name) { return attrs.get(name) ?? null; },
    addEventListener() {}, focus() {}, scrollIntoView() {},
    parentElement: { setAttribute() {} },
  };
}

function harness() {
  let clockNow = FIXED_NOW;
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clockNow])); }
    static now() { return clockNow; }
  }
  const data = new Map();
  const writes = [];
  const localStorage = {
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { data.set(key, String(value)); writes.push(key); },
    removeItem(key) { data.delete(key); },
  };
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  }
  let workoutDates = null;
  const document = {
    getElementById: element,
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === '#weekList .checkin[data-workout="true"]') {
        if (workoutDates) return workoutDates.map(date => ({ dataset: { date }, getAttribute: () => 'false' }));
        return [...element('weekList').innerHTML.matchAll(/<button\b([^>]*)>/g)]
          .filter(match => /data-workout="true"/.test(match[1]))
          .map(match => {
            const attrs = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(attr => [attr[1], attr[2]]));
            return { dataset: { date: attrs['data-date'] }, getAttribute: key => attrs[key] ?? null };
          });
      }
      return [];
    },
  };
  const defaults = {
    distance: '21.0975', raceDate: '2027-02-01', halfGoalTime: '01:45:00',
    paceMin: '5', paceSec: '0', weeklyKm: '28', days: '4', longRun: '12',
    maxHrSource: 'measured', thresholdHrSource: 'measured', vo2maxSource: 'watch',
  };
  for (const [id, value] of Object.entries(defaults)) element(id).value = value;
  const context = vm.createContext({
    document, localStorage, ProfileStore, RunningAssessment, TargetPlan, SessionAdvice,
    Date: FixedDate, setTimeout, clearTimeout,
  });
  const source = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  const marker = '// Boot and explicit UI events.';
  assert.ok(source.includes(marker), 'The app boot marker must exist so event setup is never executed by this harness.');
  vm.runInContext(source.slice(0, source.indexOf(marker)) + `
    globalThis.__appTest = {
      render, savePlanHistory, readAdherence, validatePersonal, saveProfileForm, loadProfileForm,
      setState(state) {
        if ('profileId' in state) activeProfileId = state.profileId;
        if ('checkinKey' in state) activeCheckinKey = state.checkinKey;
        if ('startDate' in state) activePlanStartDate = state.startDate;
        if ('records' in state) currentRecords = state.records;
      }
    };
  `, context, { filename: 'src/app.js' });
  // app.js initializes its default date; choose a fixed future date for tests.
  element('raceDate').value = defaults.raceDate;
  return {
    api: context.__appTest, data, writes, element, localStorage,
    records: ProfileStore.createStore(localStorage),
    setWorkouts(dates) { workoutDates = dates; },
    advanceDays(days) { clockNow += days * 86400000; },
    save(key, value) { localStorage.setItem(key, JSON.stringify(value)); },
    read(key) { return JSON.parse(localStorage.getItem(key) || 'null'); },
  };
}

const historyKey = id => 'xunxu-plan-evidence-v2:' + id;
const checkinKey = id => 'xunxu-checkins-v1:half-target-v1:2027-02-01:6300' + (id === 'default' ? '' : ':profile:' + id);

// Extract complete nested divs so comparisons include the whole target
// prescription while excluding the separate, intentionally changing advice.
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

function assertGeneratedPlan(h, profileId = 'default') {
  assert.ok(targetBlocks(h).length > 0, 'A valid target must produce target prescription blocks.');
  assert.match(h.element('weekList').innerHTML, /data-workout="true"/);
  assert.doesNotMatch(h.element('weekList').innerHTML, /信息未通过检查/);
  const history = h.read(historyKey(profileId));
  assert.equal(history.profileId, profileId);
  assert.ok(history.dates.length > 0);
  assert.equal(h.localStorage.getItem(history.checkinKey + ':started'), history.startDate);
  return history;
}

test('same-plan regeneration retains past workout dates and replaces future dates', () => {
  const h = harness();
  const key = checkinKey('runner-a');
  h.save(historyKey('runner-a'), {
    profileId: 'runner-a', startDate: '2026-11-03', checkinKey: key,
    dates: ['2026-11-04', '2026-11-09', '2026-11-11', '2026-11-12', '2026-11-14'],
  });
  h.api.setState({ profileId: 'runner-a', checkinKey: key, startDate: '2026-11-03' });
  h.setWorkouts(['2026-11-11', '2026-11-13', '2026-11-13', '2026-11-15']);
  h.api.savePlanHistory();
  assert.deepEqual(h.read(historyKey('runner-a')), {
    profileId: 'runner-a', startDate: '2026-11-03', checkinKey: key,
    dates: ['2026-11-04', '2026-11-09', '2026-11-11', '2026-11-13', '2026-11-15'],
  });
  assert.equal(h.localStorage.getItem(key + ':started'), '2026-11-03');
});

test('a different plan key does not inherit the previous plan past dates', () => {
  const h = harness();
  const key = checkinKey('runner-a');
  h.save(historyKey('runner-a'), {
    profileId: 'runner-a', startDate: '2026-11-01', checkinKey: key + '-old', dates: ['2026-11-05'],
  });
  h.api.setState({ profileId: 'runner-a', checkinKey: key, startDate: '2026-11-11' });
  h.setWorkouts(['2026-11-12']);
  h.api.savePlanHistory();
  assert.deepEqual(h.read(historyKey('runner-a')).dates, ['2026-11-12']);
});

test('saving plan history leaves another profile history and check-ins unchanged', () => {
  const h = harness();
  const aKey = checkinKey('runner-a'), bKey = checkinKey('runner-b');
  h.save(historyKey('runner-b'), {
    profileId: 'runner-b', startDate: '2026-11-01', checkinKey: bKey, dates: ['2026-11-03', '2026-11-13'],
  });
  h.save(bKey, { '2026-11-03': true });
  h.localStorage.setItem(bKey + ':started', '2026-11-01');
  const before = [historyKey('runner-b'), bKey, bKey + ':started'].map(key => h.localStorage.getItem(key));
  h.api.setState({ profileId: 'runner-a', checkinKey: aKey, startDate: '2026-11-11' });
  h.setWorkouts(['2026-11-12', '2026-11-15']);
  h.api.savePlanHistory();
  const after = [historyKey('runner-b'), bKey, bKey + ':started'].map(key => h.localStorage.getItem(key));
  assert.deepEqual(after, before);
});

test('adherence counts unique past due dates from plan start and only boolean completed checks', () => {
  const h = harness(), key = checkinKey('runner-a');
  h.api.setState({ profileId: 'runner-a' });
  h.save(historyKey('runner-a'), {
    profileId: 'runner-a', checkinKey: key, startDate: '2026-11-05',
    dates: ['2026-11-01', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-07', '2026-11-10', '2026-11-11', '2026-11-12'],
  });
  h.save(key, {
    '2026-11-01': true, '2026-11-05': true, '2026-11-06': false,
    '2026-11-07': true, '2026-11-10': 1, '2026-11-11': true, '2026-11-12': true,
  });
  const result = h.api.readAdherence();
  assert.equal(result.due, 4);
  assert.equal(result.completed, 2);
  assert.ok(result.completed <= result.due);
});

test('a new plan with only today and future dates has no due adherence sessions', () => {
  const h = harness(), key = checkinKey('default');
  h.save(historyKey('default'), {
    profileId: 'default', checkinKey: key, startDate: '2026-11-11', dates: ['2026-11-11', '2026-11-12'],
  });
  h.save(key, { '2026-11-11': true, '2026-11-12': true });
  const result = h.api.readAdherence();
  assert.equal(result.due, 0);
  assert.equal(result.completed, 0);
});

test('adherence rejects a foreign profile or cross-profile check-in key', () => {
  const cases = [
    ['runner-a', { profileId: 'runner-b', checkinKey: checkinKey('runner-b') }],
    ['runner-a', { profileId: 'runner-a', checkinKey: checkinKey('runner-b') }],
    ['default', { profileId: 'default', checkinKey: checkinKey('runner-b') }],
  ];
  for (const [profileId, fields] of cases) {
    const h = harness();
    h.api.setState({ profileId });
    h.save(historyKey(profileId), { ...fields, startDate: '2026-11-01', dates: ['2026-11-05'] });
    h.save(fields.checkinKey, { '2026-11-05': true });
    assert.equal(h.api.readAdherence(), null);
  }
});

test('unreadable history produces unknown adherence instead of fabricated zero completion', () => {
  const h = harness();
  h.localStorage.setItem(historyKey('default'), '{broken');
  assert.equal(h.api.readAdherence(), null);
});

function assertNoGeneratedPlan(h) {
  assert.match(h.element('weekList').innerHTML, /信息未通过检查/);
  assert.doesNotMatch(h.element('weekList').innerHTML, /data-workout="true"/);
  assert.equal(h.writes.some(key => key.endsWith(':started')), false, 'A failed render must not start a plan.');
  assert.equal(h.writes.some(key => key.startsWith('xunxu-plan-evidence-v2:')), false, 'A failed render must not replace plan history.');
}

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

test('switching profiles reloads only their own records, personal data, history and check-in key', () => {
  const h = harness();
  const a = 'runner-a', b = 'runner-b';
  const commonForm = { raceDate: '2027-02-01', halfGoalTime: '01:45:00', weeklyKm: '45', longRun: '18', days: '4' };
  h.save('xunxu-profile-form-v1:' + a, { ...commonForm, restingHr: '50', maxHr: '190' });
  h.save('xunxu-profile-form-v1:' + b, { ...commonForm, restingHr: '65', maxHr: '180' });
  h.records.put(a, record({ id: 'result-a', profileId: a, elapsedSeconds: 6000 }));
  h.records.put(b, record({ id: 'result-b', profileId: b, elapsedSeconds: 7800, date: '2026-10-15' }));
  h.api.loadProfileForm(a); h.api.render();
  const aTargets = targetBlocks(h), aAdvice = adviceBlocks(h), aHistory = assertGeneratedPlan(h, a);
  assert.equal(h.element('equivalentTime').textContent, '1:40:00');
  h.save(aHistory.checkinKey, { '2026-11-10': true });
  const aKeys = [historyKey(a), aHistory.checkinKey, aHistory.checkinKey + ':started', h.records.key(a), 'xunxu-profile-form-v1:' + a];
  const aStored = aKeys.map(key => h.localStorage.getItem(key));
  h.api.loadProfileForm(b); h.api.render();
  const bHistory = assertGeneratedPlan(h, b);
  assert.notEqual(bHistory.checkinKey, aHistory.checkinKey);
  assert.equal(h.element('equivalentTime').textContent, '2:10:00');
  assert.equal(h.element('restingHr').value, '65');
  assert.match(h.element('evidenceDetails').innerHTML, /2026-10-15/);
  assert.doesNotMatch(h.element('evidenceDetails').innerHTML, /2026-11-01/);
  assert.deepEqual(targetBlocks(h), aTargets);
  assert.notDeepEqual(adviceBlocks(h), aAdvice);
  assert.deepEqual(aKeys.map(key => h.localStorage.getItem(key)), aStored);
  h.api.loadProfileForm(a); h.api.render();
  assert.equal(h.element('equivalentTime').textContent, '1:40:00');
  assert.equal(h.element('restingHr').value, '50');
  assert.deepEqual(adviceBlocks(h), aAdvice);
  assert.equal(assertGeneratedPlan(h, a).checkinKey, aHistory.checkinKey);
  assert.equal(h.records.list(a).length, 1);
  assert.equal(h.records.list(b).length, 1);
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
  assert.ok(h.read(historyKey('default')).dates.every(date => date <= '2027-02-01'));
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
