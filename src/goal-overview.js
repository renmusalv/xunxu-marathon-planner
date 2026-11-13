(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.XunxuGoalOverview = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  // This view only presents an existing assessment. It never creates a score,
  // changes a goal, or interprets missing fields as zero.
  const HALF = 21.0975, FULL = 42.195;
  const value = input => {
    if (input === null || input === undefined || input === '' || !['number', 'string'].includes(typeof input)) return null;
    if (typeof input === 'string' && !input.trim()) return null;
    const parsed = Number(input);
    return Number.isFinite(parsed) ? parsed : null;
  };
  function duration(seconds) {
    const n = value(seconds);
    if (n === null || n <= 0) return null;
    const total = Math.round(n);
    return Math.floor(total / 3600) + ':' + String(Math.floor(total / 60) % 60).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
  }
  function validDate(input) {
    const match = typeof input === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
    if (!match) return false;
    const [year, month, day] = match.slice(1).map(Number), d = new Date(Date.UTC(year, month - 1, day));
    return year >= 1900 && year <= 2200 && d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
  }

  function create({root, hero = null, heroToggle = null} = {}) {
    if (!root) return null;
    const find = id => root.querySelector('#' + id);
    const nodes = Object.fromEntries(['overviewProfile', 'overviewRaceTitle', 'overviewRaceDate', 'overviewTarget', 'overviewScore', 'overviewScoreUnit', 'overviewRing', 'overviewChart', 'overviewVerdict', 'overviewSummary', 'overviewEvidence', 'overviewBaseline'].map(id => [id, find(id)]));
    const setText = (id, text) => { if (nodes[id]) nodes[id].textContent = text; };
    const initialHeroHidden = hero ? hero.hidden : false;
    let destroyed = false;

    function update(input = {}) {
      if (destroyed) return;
      const {assessment, raceDate, targetSeconds, distanceKm, profileName, failed, loading} = input;
      const distance = value(distanceKm), target = value(targetSeconds);
      const half = distance !== null && Math.abs(distance - HALF) < 0.015;
      const full = distance !== null && Math.abs(distance - FULL) < 0.015;
      const distanceName = half ? '半马' : full ? '全马' : '比赛';
      const validTarget = (half || full) && target !== null && target >= distance * 120 && target <= distance * 1200;
      const dateOK = validDate(raceDate);
      const result = assessment && typeof assessment === 'object' ? assessment : null;
      const fit = result && result.fit && typeof result.fit === 'object' ? result.fit : {};
      const resultTarget = result ? value(result.targetSeconds) : null;
      const resultDistance = result ? value(result.distanceKm) : null;
      // A goal edit may arrive before recalculation. Never show the old goal's
      // score underneath a new target, or retain another profile's result.
      const matchingResult = result !== null && resultTarget !== null && resultDistance !== null && validTarget && Math.abs(resultTarget - target) < 0.5 && Math.abs(resultDistance - distance) < 0.015;
      const usable = matchingResult && dateOK && !failed && !loading;
      const hold = usable && fit.hold === true;
      const rawScore = value(fit.score);
      const score = usable && !hold && rawScore !== null && rawScore >= 0 && rawScore <= 100 ? Math.round(rawScore) : null;
      const status = loading ? 'loading' : failed ? 'error' : hold ? 'hold' : score !== null ? 'ready' : 'incomplete';
      const level = score !== null && ['low', 'medium', 'high'].includes(fit.level) ? fit.level : 'unknown';
      root.dataset.status = status;
      root.dataset.level = level;
      root.setAttribute('aria-busy', String(Boolean(loading)));

      setText('overviewProfile', typeof profileName === 'string' && profileName.trim() ? profileName.trim() : '当前档案');
      setText('overviewRaceTitle', half || full ? '下一场' + distanceName + '目标' : '下一场目标比赛');
      const days = usable ? value(fit.days) : null;
      setText('overviewRaceDate', dateOK ? raceDate.replaceAll('-', '.') + (days !== null && days > 0 ? ' · 还有 ' + Math.ceil(days) + ' 天' : '') : '比赛日期待设置');
      setText('overviewTarget', validTarget ? duration(target) : '未设目标');
      setText('overviewScore', score === null ? '—' : String(score));
      setText('overviewScoreUnit', score !== null ? '/ 100' : hold ? '暂缓' : loading ? '更新中' : '待评估');

      const ring = nodes.overviewRing;
      if (ring) {
        ring.setAttribute('pathLength', '100');
        ring.setAttribute('stroke-dasharray', '100');
        ring.setAttribute('stroke-dashoffset', String(score === null ? 100 : 100 - score));
        ring.style.strokeDashoffset = String(score === null ? 100 : 100 - score);
        ring.style.visibility = score === null ? 'hidden' : 'visible';
        ring.setAttribute('aria-hidden', 'true');
      }
      if (nodes.overviewChart) {
        nodes.overviewChart.setAttribute('role', 'img');
        nodes.overviewChart.setAttribute('aria-label', score !== null ? '目标准备度 ' + score + ' 分，满分 100；不是比赛成功概率' : hold ? '优先恢复，暂缓目标准备度评估' : loading ? '正在更新目标准备度评估' : '目标准备度待评估，资料尚不完整');
      }

      const evidence = usable && result.evidence && typeof result.evidence === 'object' ? result.evidence : {};
      const count = value(evidence.count);
      const baseline = usable ? duration(result.equivalentSeconds) : null;
      setText('overviewBaseline', baseline ? '当前' + distanceName + '等效 ' + baseline : '当前能力待确认');
      setText('overviewEvidence', loading ? '正在核对评估数据' : count !== null && count > 0 ? Math.floor(count) + ' 次有效成绩 · 证据' + ({high: '较充分', medium: '一般', low: '有限'}[evidence.confidence] || '待确认') : '暂无有效比赛或测试成绩');

      let verdict, summary;
      if (loading) {
        verdict = '正在更新评估'; summary = '正在读取当前档案，完成后显示目标准备度。';
      } else if (failed) {
        verdict = '请先核对比赛设置'; summary = '修正提示中的资料后，重新生成课表与评估。';
      } else if (!validTarget || !dateOK) {
        verdict = '设置下一场比赛目标'; summary = '填写比赛距离、日期与目标用时，建立你的备赛计划。';
      } else if (hold) {
        verdict = '优先恢复 · 暂缓评估'; summary = '当前处于不适或恢复阶段，先关注恢复，再判断目标训练强度。';
      } else if (score !== null) {
        verdict = typeof fit.label === 'string' && fit.label.trim() ? fit.label : '目标准备度已更新';
        const gap = value(fit.gapPct);
        summary = gap !== null && gap > 0 ? '目标比当前等效成绩快 ' + gap.toFixed(1) + '%，请结合备赛时间与训练基础推进。' : gap !== null ? '当前等效成绩接近或覆盖目标，继续结合训练基础与恢复状态执行。' : '已综合近期成绩、备赛时间和训练基础，请展开查看判断依据。';
      } else {
        verdict = '资料不足 · 待评估';
        const missing = usable && Array.isArray(fit.missing) ? fit.missing.find(item => typeof item === 'string' && item.trim()) : null;
        summary = missing ? '还需补充' + missing.slice(0, 50) + '，完善目标判断依据。' : '补充并核对近期成绩与训练基础，再评估目标准备度。';
      }
      setText('overviewVerdict', verdict);
      setText('overviewSummary', summary);
    }

    function setHeroExpanded(expanded) {
      if (!hero || !heroToggle) return;
      hero.hidden = !expanded;
      heroToggle.setAttribute('aria-expanded', String(expanded));
      if (hero.id) heroToggle.setAttribute('aria-controls', hero.id);
      heroToggle.setAttribute('aria-label', expanded ? '收起半马主题头图' : '展开半马主题头图');
      const label = heroToggle.querySelector('[data-hero-toggle-label]');
      (label || heroToggle).textContent = expanded ? '收起头图' : '展开头图';
    }
    const toggleHero = () => { if (!destroyed && hero) setHeroExpanded(hero.hidden); };
    if (hero && heroToggle) {
      setHeroExpanded(!hero.hidden);
      heroToggle.addEventListener('click', toggleHero);
    }
    update();
    return {
      update,
      reset() { update(); },
      destroy() {
        if (destroyed) return;
        update();
        destroyed = true;
        if (hero && heroToggle) {
          heroToggle.removeEventListener('click', toggleHero);
          setHeroExpanded(!initialHeroHidden);
        }
      }
    };
  }
  return Object.freeze({create});
});
