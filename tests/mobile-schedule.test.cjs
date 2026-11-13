const test = require('node:test');
const assert = require('node:assert/strict');
const {create, resolveSelection, selectionForWeek, offsetDate, nearestIndex} = require('../src/mobile-schedule.js');

const week = (start, count = 7) => ({days: Array.from({length: count}, (_, i) => ({date: offsetDate(start, i)}))});

test('mobile schedule initially selects today instead of the first historical course', () => {
  const weeks = [week('2026-11-02'), week('2026-11-09'), week('2026-11-16')];
  assert.deepEqual(resolveSelection(weeks, {today: '2026-11-12'}), {weekIndex: 1, dayIndex: 3, date: '2026-11-12'});
});

test('mobile schedule keeps a chosen date after assessment or check-in re-render', () => {
  const weeks = [week('2026-11-02'), week('2026-11-09'), week('2026-11-16')];
  assert.deepEqual(resolveSelection(weeks, {today: '2026-11-12', preferredDate: '2026-11-21'}), {weekIndex: 2, dayIndex: 5, date: '2026-11-21'});
});

test('mobile schedule chooses first future day or last completed day when today is outside plan', () => {
  const weeks = [week('2026-11-09'), week('2026-11-16', 3)];
  assert.deepEqual(resolveSelection(weeks, {today: '2026-11-01', preferredDate: '2026-10-31'}), {weekIndex: 0, dayIndex: 0, date: '2026-11-09'});
  assert.deepEqual(resolveSelection(weeks, {today: '2026-11-20'}), {weekIndex: 1, dayIndex: 2, date: '2026-11-18'});
  assert.equal(resolveSelection([], {today: '2026-11-12'}), null);
});

test('changing weeks keeps the weekday and clamps short race weeks', () => {
  const weeks = [week('2026-11-09'), week('2026-11-16', 3)];
  assert.deepEqual(selectionForWeek(weeks, 1, '2026-11-10'), {weekIndex: 1, dayIndex: 1, date: '2026-11-17'});
  assert.deepEqual(selectionForWeek(weeks, 1, '2026-11-15'), {weekIndex: 1, dayIndex: 2, date: '2026-11-18'});
  assert.deepEqual(selectionForWeek(weeks, -1, '2026-11-18'), {weekIndex: 0, dayIndex: 2, date: '2026-11-11'});
  assert.equal(selectionForWeek([], 0, '2026-11-12'), null);
});

test('date fallback handles year and leap boundaries without timezone drift', () => {
  assert.equal(offsetDate('2026-12-28', 6), '2027-01-03');
  assert.equal(offsetDate('2028-02-28', 1), '2028-02-29');
  assert.equal(offsetDate('2028-02-28', 2), '2028-03-01');
  assert.equal(offsetDate('2026-02-29', 1), '');
  assert.equal(offsetDate('2026-13-01', 1), '');
});

test('swiping selects nearest visible card with gaps and ignores overscroll at week edges', () => {
  const offsets = [0, 332, 664, 996, 1328, 1660, 1992];
  assert.equal(nearestIndex(0, offsets), 0);
  assert.equal(nearestIndex(172, offsets), 1);
  assert.equal(nearestIndex(970, offsets), 3);
  assert.equal(nearestIndex(-42, offsets), 0);
  assert.equal(nearestIndex(2200, offsets), 6);
});

// A small DOM harness exercises the public controller without introducing a
// browser dependency. Layout values are explicit; actual touch/layout is QA'd
// in the browser in addition to these lifecycle/accessibility checks.
function harness() {
  const media = {matches: true, listeners: new Set(), addEventListener(_, fn) { this.listeners.add(fn); }, removeEventListener(_, fn) { this.listeners.delete(fn); }};
  const frames = new Map(); let frameId = 0;
  const document = {activeElement: null};
  const window = {
    matchMedia: () => media,
    requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    addEventListener() {}, removeEventListener() {}
  };
  document.defaultView = window;
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.ownerDocument = document; this.children = []; this.parentNode = null; this.dataset = {}; this.attrs = new Map(); this.listeners = new Map(); this.style = {height: ''}; this.className = ''; this._text = ''; this.offsetLeft = 0; this.clientWidth = 320; this.scrollLeft = 0; this.height = 200; this.disabled = false; this.value = ''; }
    get id() { return this.attrs.get('id') || ''; } set id(value) { this.attrs.set('id', String(value)); }
    get hidden() { return this.attrs.has('hidden'); } set hidden(value) { this.toggleAttribute('hidden', value); }
    get tabIndex() { return Number(this.attrs.get('tabindex') || 0); } set tabIndex(value) { this.attrs.set('tabindex', String(value)); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); } set textContent(value) { this._text = String(value); this.children = []; }
    get classList() { const self = this; return {contains(name) { return self.className.split(/\s+/).includes(name); }, add(name) { if (!this.contains(name)) self.className = (self.className + ' ' + name).trim(); }, remove(name) { self.className = self.className.split(/\s+/).filter(item => item !== name).join(' '); }}; }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    replaceChildren(...children) { this.children.forEach(child => { child.parentNode = null; }); this.children = []; this._text = ''; this.append(...children); }
    insertBefore(child, reference) { child.parentNode = this; this.children.splice(this.children.indexOf(reference), 0, child); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
    setAttribute(name, value) { this.attrs.set(name, String(value)); }
    getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
    removeAttribute(name) { this.attrs.delete(name); }
    toggleAttribute(name, force) { const next = force === undefined ? !this.attrs.has(name) : force; if (next) this.attrs.set(name, ''); else this.attrs.delete(name); return next; }
    addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
    removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
    emit(name, extras = {}) { for (const fn of this.listeners.get(name) || []) fn({target: this, preventDefault() {}, ...extras}); }
    scrollTo({left}) { this.scrollLeft = left; }
    getBoundingClientRect() { return {height: this.height, width: this.clientWidth}; }
    focus() { document.activeElement = this; }
    matches(selector) {
      if (selector.includes(' > ')) { const [parent, child] = selector.split(' > '); return this.matches(child) && this.parentNode?.matches(parent); }
      if (selector.includes(' ')) { const [parent, child] = selector.split(' '); let ancestor = this.parentNode; while (ancestor && !ancestor.matches(parent)) ancestor = ancestor.parentNode; return this.matches(child) && Boolean(ancestor); }
      return selector.startsWith('.') ? this.classList.contains(selector.slice(1)) : this.tagName === selector.toUpperCase();
    }
    querySelectorAll(selector) { const nodes = []; const visit = parent => { parent.children.forEach(child => { if (child.matches(selector)) nodes.push(child); visit(child); }); }; visit(this); return nodes; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  document.createElement = tag => new Element(tag);
  function node(tag, className, text = '') { const result = new Element(tag); result.className = className; result.textContent = text; return result; }
  const parent = node('section', 'work');
  const root = node('div', 'week-list'); parent.appendChild(root);
  function buildWeeks(starts) {
    root.replaceChildren();
    starts.forEach((start, index) => {
      const article = node('article', 'week'); article.dataset.start = start; article.dataset.end = offsetDate(start, 6);
      const top = node('div', 'week-top'), title = node('div', 'week-title'); title.appendChild(node('b', '', `第 ${index + 1} 周`)); top.appendChild(title);
      const stats = node('div', 'week-stats'); stats.appendChild(node('span', '', '40 km')); top.appendChild(stats);
      const grid = node('div', 'day-grid');
      for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        const card = node('div', 'day'); card.dataset.date = offsetDate(start, dayIndex); card.offsetLeft = dayIndex * 332; card.height = dayIndex % 2 ? 150 : 350;
        card.appendChild(node('div', 'title', dayIndex % 2 ? '休息' : '有氧跑')); grid.appendChild(card);
      }
      article.append(top, grid); root.appendChild(article);
    });
  }
  function flush() { let safety = 20; while (frames.size && safety-- > 0) { const list = [...frames.values()]; frames.clear(); list.forEach(fn => fn()); } }
  function setMobile(value) { media.matches = value; media.listeners.forEach(fn => fn()); flush(); }
  buildWeeks(['2026-11-09', '2026-11-16']);
  const controller = create({root, now: () => new Date(2026, 10, 12, 12)}); controller.refresh({profileKey: 'A'}); flush();
  return {root, parent, controller, buildWeeks, flush, setMobile, document};
}

test('controller hides other weeks, exposes one day, and sizes a rest day to its own content', () => {
  const h = harness();
  const weeks = h.root.querySelectorAll('.week');
  assert.equal(weeks[0].hidden, false); assert.equal(weeks[1].hidden, true);
  const days = weeks[0].querySelectorAll('.day');
  assert.equal(days[3].getAttribute('inert'), null);
  assert.equal(days[2].getAttribute('inert'), '');
  assert.equal(days[3].getAttribute('aria-hidden'), 'false');
  assert.equal(weeks[0].querySelector('.day-grid').style.height, '150px');
  assert.equal(weeks[0].querySelector('.day-grid').scrollLeft, 996);
});

test('controller supports day clicks, native scroll updates, and keyboard day navigation', () => {
  const h = harness();
  h.parent.querySelectorAll('.mobile-day-tab')[5].emit('click'); h.flush();
  assert.equal(h.controller.selection().date, '2026-11-14');
  const grid = h.root.querySelector('.day-grid'); grid.scrollLeft = 1328; grid.emit('scroll'); h.flush();
  assert.equal(h.controller.selection().date, '2026-11-13');
  h.parent.querySelectorAll('.mobile-day-tab')[4].emit('keydown', {key: 'Home'}); h.flush();
  assert.equal(h.controller.selection().date, '2026-11-09');
  assert.equal(h.document.activeElement, h.parent.querySelectorAll('.mobile-day-tab')[0]);
});

test('controller preserves selection on re-render but resets it when the profile changes', () => {
  const h = harness();
  h.parent.querySelectorAll('.mobile-week-arrow')[1].emit('click'); h.flush();
  assert.equal(h.controller.selection().date, '2026-11-19');
  h.buildWeeks(['2026-11-09', '2026-11-16']);
  h.controller.refresh({profileKey: 'A'}); h.flush();
  assert.equal(h.controller.selection().date, '2026-11-19');
  h.controller.refresh({profileKey: 'B'}); h.flush();
  assert.equal(h.controller.selection().date, '2026-11-12');
});

test('desktop mode and destroy restore normal course semantics, content height, and all weeks', () => {
  const h = harness(); h.setMobile(false);
  assert.ok(h.root.querySelectorAll('.week').every(item => !item.hidden && item.getAttribute('inert') === null));
  assert.ok(h.root.querySelectorAll('.day').every(item => item.getAttribute('role') === null && item.getAttribute('aria-hidden') === null));
  assert.ok(h.root.querySelectorAll('.day-grid').every(item => item.style.height === '' && item.scrollLeft === 0));
  assert.equal(h.parent.querySelector('.mobile-schedule-controls').hidden, true);
  h.setMobile(true); assert.equal(h.controller.selection().date, '2026-11-12');
  h.controller.destroy();
  assert.equal(h.parent.querySelector('.mobile-schedule-controls'), null);
  assert.ok(h.root.querySelectorAll('.week').every(item => !item.hidden));
});

test('empty/error plan clears navigation and replacement plan does not retain stale hidden DOM', () => {
  const h = harness(); h.root.replaceChildren(); h.controller.refresh({profileKey: 'A'}); h.flush();
  assert.equal(h.controller.selection(), null);
  assert.equal(h.parent.querySelector('.mobile-schedule-controls').hidden, true);
  h.buildWeeks(['2026-11-16']); h.controller.refresh({profileKey: 'A'}); h.flush();
  assert.equal(h.controller.selection().date, '2026-11-16');
  assert.equal(h.root.querySelector('.week').hidden, false);
});
