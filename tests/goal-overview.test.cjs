const test = require('node:test');
const assert = require('node:assert/strict');
const {create} = require('../src/goal-overview.js');

function harness() {
  class Element {
    constructor(id) { this.id = id; this.textContent = ''; this.dataset = {}; this.style = {}; this.attrs = {}; this.hidden = false; this.listeners = new Map(); }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    getAttribute(name) { return this.attrs[name] ?? null; }
    querySelector(selector) { return nodes.get(selector.slice(1)) || null; }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    removeEventListener(type) { this.listeners.delete(type); }
    click() { this.listeners.get('click')?.(); }
  }
  const nodes = new Map();
  for (const id of ['overviewProfile', 'overviewRaceTitle', 'overviewRaceDate', 'overviewTarget', 'overviewScore', 'overviewScoreUnit', 'overviewRing', 'overviewChart', 'overviewVerdict', 'overviewSummary', 'overviewEvidence', 'overviewBaseline']) nodes.set(id, new Element(id));
  const root = new Element('goalOverview'), hero = new Element('raceHero'), heroToggle = new Element('heroToggle');
  const controller = create({root, hero, heroToggle});
  return {nodes, root, hero, heroToggle, controller, text: id => nodes.get(id).textContent};
}

function input(overrides = {}) {
  const assessment = {
    targetSeconds: 6600, distanceKm: 21.0975, equivalentSeconds: 6700,
    evidence: {count: 2, confidence: 'medium'},
    fit: {score: 82, level: 'low', label: '当前基础较匹配', gapPct: 1.4925, days: 44, missing: [], hold: false}
  };
  return {assessment, raceDate: '2026-12-27', targetSeconds: 6600, distanceKm: 21.0975, profileName: '我的半马档案', ...overrides};
}

test('overview shows genuine score out of 100 with matching target and current profile', () => {
  const h = harness(); h.controller.update(input());
  assert.equal(h.root.dataset.status, 'ready'); assert.equal(h.root.dataset.level, 'low');
  assert.equal(h.text('overviewProfile'), '我的半马档案'); assert.equal(h.text('overviewTarget'), '1:50:00');
  assert.equal(h.text('overviewScore'), '82'); assert.equal(h.text('overviewScoreUnit'), '/ 100');
  assert.equal(h.text('overviewBaseline'), '当前半马等效 1:51:40');
  assert.equal(h.text('overviewEvidence'), '2 次有效成绩 · 证据一般');
  assert.equal(h.nodes.get('overviewRing').style.strokeDashoffset, '18');
  assert.match(h.nodes.get('overviewChart').getAttribute('aria-label'), /不是比赛成功概率/);
  assert.match(h.text('overviewSummary'), /1\.5%/);
});

test('missing score is unknown rather than zero, while an actual zero stays a valid score', () => {
  const h = harness(), data = input();
  data.assessment.fit.score = null; data.assessment.fit.missing = ['近 30 天最长跑'];
  h.controller.update(data);
  assert.equal(h.text('overviewScore'), '—'); assert.equal(h.text('overviewScoreUnit'), '待评估');
  assert.equal(h.root.dataset.status, 'incomplete'); assert.equal(h.nodes.get('overviewRing').style.visibility, 'hidden');
  assert.match(h.text('overviewSummary'), /近 30 天最长跑/);
  data.assessment.fit.score = 0; data.assessment.fit.level = 'high'; h.controller.update(data);
  assert.equal(h.text('overviewScore'), '0'); assert.equal(h.text('overviewScoreUnit'), '/ 100');
  assert.equal(h.root.dataset.status, 'ready'); assert.equal(h.nodes.get('overviewRing').style.visibility, 'visible');
});

test('recovery hold hides even a supplied numerical score and does not imply failed probability', () => {
  const h = harness(), data = input(); data.assessment.fit.hold = true; h.controller.update(data);
  assert.equal(h.root.dataset.status, 'hold'); assert.equal(h.root.dataset.level, 'unknown');
  assert.equal(h.text('overviewScore'), '—'); assert.equal(h.text('overviewScoreUnit'), '暂缓');
  assert.match(h.text('overviewVerdict'), /优先恢复/);
  assert.equal(h.nodes.get('overviewRing').style.visibility, 'hidden');
});

test('blank, invalid or changed target cannot retain a previous goal score', () => {
  const h = harness();
  for (const overrides of [{targetSeconds: ''}, {targetSeconds: ' '}, {targetSeconds: null}, {targetSeconds: 0}, {targetSeconds: 'bad'}, {targetSeconds: 999999}, {distanceKm: ''}, {distanceKm: 10}, {raceDate: '2026-02-30'}, {raceDate: ''}, {targetSeconds: 6300}]) {
    h.controller.update(input()); h.controller.update(input(overrides));
    assert.equal(h.root.dataset.status, 'incomplete', JSON.stringify(overrides));
    assert.equal(h.text('overviewScore'), '—', JSON.stringify(overrides));
    assert.equal(h.text('overviewBaseline'), '当前能力待确认', JSON.stringify(overrides));
  }
});

test('loading and failed states immediately clear old assessment evidence', () => {
  const h = harness(); h.controller.update(input()); h.controller.update(input({loading: true}));
  assert.equal(h.root.dataset.status, 'loading'); assert.equal(h.root.getAttribute('aria-busy'), 'true');
  assert.equal(h.text('overviewScore'), '—'); assert.equal(h.text('overviewScoreUnit'), '更新中');
  assert.equal(h.text('overviewBaseline'), '当前能力待确认');
  h.controller.update(input({failed: true}));
  assert.equal(h.root.dataset.status, 'error'); assert.equal(h.root.getAttribute('aria-busy'), 'false');
  assert.equal(h.text('overviewScore'), '—'); assert.match(h.text('overviewVerdict'), /核对/);
  assert.equal(h.text('overviewEvidence'), '暂无有效比赛或测试成绩');
});

test('profile reset removes previous scores and labels without restoring folded hero', () => {
  const h = harness(); h.controller.update(input()); h.heroToggle.click(); h.controller.reset();
  assert.equal(h.text('overviewProfile'), '当前档案'); assert.equal(h.text('overviewScore'), '—');
  assert.equal(h.text('overviewBaseline'), '当前能力待确认'); assert.equal(h.text('overviewTarget'), '未设目标');
  assert.equal(h.hero.hidden, true);
  h.controller.update(input({profileName: '第二个档案', assessment: null}));
  assert.equal(h.text('overviewProfile'), '第二个档案'); assert.equal(h.text('overviewScore'), '—');
});

test('hero control exposes real expansion state and destroy removes event effects', () => {
  const h = harness();
  assert.equal(h.heroToggle.getAttribute('aria-controls'), 'raceHero');
  assert.equal(h.heroToggle.getAttribute('aria-expanded'), 'true');
  h.heroToggle.click(); assert.equal(h.hero.hidden, true);
  assert.equal(h.heroToggle.getAttribute('aria-expanded'), 'false'); assert.equal(h.heroToggle.textContent, '展开头图');
  h.controller.destroy(); assert.equal(h.hero.hidden, false); assert.equal(h.heroToggle.listeners.size, 0);
  h.heroToggle.click(); h.controller.update(input());
  assert.equal(h.hero.hidden, false); assert.equal(h.text('overviewScore'), '—');
});
