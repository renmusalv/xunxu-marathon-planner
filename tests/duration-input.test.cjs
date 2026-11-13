const test = require('node:test');
const assert = require('node:assert/strict');
const DurationInput = require('../src/duration-input.js');

class Element {
  constructor(document, tag) {
    this.ownerDocument = document; this.nodeType = 1; this.tagName = tag.toUpperCase();
    this.children = []; this.attributes = new Map(); this.listeners = new Map();
    this.dataset = {}; this.value = ''; this.type = 'text'; this.hidden = false;
    this.disabled = false; this.readOnly = false; this.validationMessage = '';
    document.elements.push(this);
  }
  get labels() { return this.ownerDocument.elements.filter(item => item.tagName === 'LABEL' && item.htmlFor === this.id); }
  get nextSibling() { const list = this.parentNode?.children || []; return list[list.indexOf(this) + 1] || null; }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  removeAttribute(key) { this.attributes.delete(key); }
  append(...items) { items.forEach(item => this.appendChild(item)); }
  appendChild(item) { item.parentNode = this; this.children.push(item); return item; }
  insertBefore(item, reference) { item.parentNode = this; const at = this.children.indexOf(reference); this.children.splice(at < 0 ? this.children.length : at, 0, item); }
  remove() { this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); }
  addEventListener(name, handler) { const handlers = this.listeners.get(name) || []; handlers.push(handler); this.listeners.set(name, handlers); }
  removeEventListener(name, handler) { this.listeners.set(name, (this.listeners.get(name) || []).filter(item => item !== handler)); }
  dispatchEvent(event) { for (const listener of this.listeners.get(event.type) || []) listener(event); return !event.defaultPrevented; }
  setCustomValidity(message) { this.validationMessage = message; }
  focus() { this.ownerDocument.activeElement = this; }
}

function fixture(values = {halfGoalTime: '01:45:00', recordTime: '', benchmarkTime: ''}) {
  const doc = {nodeType: 9, elements: [], defaultView: {Event}, activeElement: null};
  doc.createElement = tag => new Element(doc, tag);
  doc.getElementById = id => doc.elements.find(element => element.id === id) || null;
  doc.querySelectorAll = () => doc.elements.filter(element => element.tagName === 'INPUT' && element.attributes.has('data-duration'));
  const parent = doc.createElement('form');
  const calls = [];
  Object.entries(values).forEach(([id, value]) => {
    const label = doc.createElement('label'); label.htmlFor = id; label.textContent = id === 'halfGoalTime' ? '下次半马目标用时' : '历史实际用时';
    const input = doc.createElement('input'); input.id = id; input.value = value; input.setAttribute('data-duration', '');
    ['input', 'change'].forEach(name => input.addEventListener(name, () => calls.push({id, type: name, value: input.value})));
    parent.append(label, input);
  });
  const controller = DurationInput.mount(doc);
  const get = id => doc.getElementById(id);
  const enter = (id, value, type = 'input') => { get(id).value = value; get(id).dispatchEvent(new Event(type)); };
  return {doc, get, enter, controller, calls};
}

test('three numeric segments update the original duration and event without moving focus', () => {
  const f = fixture();
  const minute = f.get('halfGoalTimeMinutes');
  assert.equal(minute.type, 'text'); assert.equal(minute.inputMode, 'numeric');
  assert.equal(minute.getAttribute('aria-label'), '下次半马目标用时 · 分钟');
  minute.focus(); f.enter('halfGoalTimeMinutes', '50');
  assert.equal(f.get('halfGoalTime').value, '01:50:00');
  assert.equal(f.doc.activeElement, minute);
  assert.deepEqual(f.calls, [{id: 'halfGoalTime', type: 'input', value: '01:50:00'}]);
  assert.equal(f.get('halfGoalTime').hidden, true);
  assert.equal(f.get('halfGoalTime').type, 'text', 'Canonical must retain text-input reset semantics.');
  assert.equal(f.doc.elements.find(item => item.tagName === 'LABEL').htmlFor, 'halfGoalTimeHours');
});

test('deleting and invalid ranges cannot silently produce another valid duration', () => {
  const f = fixture();
  f.enter('halfGoalTimeMinutes', '');
  assert.equal(f.get('halfGoalTime').value, '01::00');
  f.enter('halfGoalTimeMinutes', '80');
  assert.equal(f.get('halfGoalTime').value, '01:80:00');
  assert.match(f.get('halfGoalTimeMinutes').validationMessage, /0–59/);
  assert.equal(f.get('halfGoalTimeMinutes').getAttribute('aria-invalid'), 'true');
  f.enter('halfGoalTimeMinutes', '150');
  assert.equal(f.get('halfGoalTime').value, '01:150:00', 'Do not truncate pasted 150 minutes to 15.');
  f.enter('halfGoalTimeHours', '1e2');
  assert.equal(f.get('halfGoalTime').value, '1e2:150:00', 'Do not turn exponent or mixed text into digits.');
  f.enter('halfGoalTimeHours', ''); f.enter('halfGoalTimeMinutes', ''); f.enter('halfGoalTimeSeconds', '');
  assert.equal(f.get('halfGoalTime').value, '');
});

test('one-digit entry and full-width digits need no colon and are padded on blur', () => {
  const f = fixture({recordTime: ''});
  f.enter('recordTimeHours', '０'); f.enter('recordTimeMinutes', '５'); f.enter('recordTimeSeconds', '３');
  assert.equal(f.get('recordTime').value, '00:05:03');
  assert.equal(f.get('recordTimeMinutes').value, '5', 'Typing never forces an extra zero into the active field.');
  f.get('recordTimeMinutes').dispatchEvent(new Event('blur'));
  assert.equal(f.get('recordTimeMinutes').value, '05');
  assert.equal(f.get('recordTimeMinutes').validationMessage, '');
});

test('a complete duration can be pasted into any segment, including full-width colons', () => {
  const f = fixture({recordTime: ''});
  let prevented = false;
  f.get('recordTimeMinutes').dispatchEvent({type: 'paste', clipboardData: {getData: () => '０１：５０：００'}, preventDefault() { prevented = true; }});
  assert.equal(prevented, true);
  assert.equal(f.get('recordTime').value, '01:50:00');
  assert.equal(f.get('recordTimeHours').value, '01');
  assert.equal(f.get('recordTimeMinutes').value, '50');
  assert.equal(f.get('recordTimeSeconds').value, '00');
  assert.deepEqual(f.calls.map(item => item.type), ['input', 'change']);
  f.get('recordTimeHours').dispatchEvent({type: 'paste', clipboardData: {getData: () => '01:90:00'}, preventDefault() {}});
  assert.equal(f.get('recordTime').value, '01:90:00');
  assert.match(f.get('recordTimeMinutes').validationMessage, /0–59/);
});

test('OCR and profile loads sync only from canonical values and do not save or emit edits', () => {
  const f = fixture();
  f.get('recordTime').value = '00:52:00'; f.controller.sync('recordTime');
  assert.deepEqual(['Hours', 'Minutes', 'Seconds'].map(suffix => f.get('recordTime' + suffix).value), ['00', '52', '00']);
  assert.equal(f.get('halfGoalTimeMinutes').value, '45');
  assert.equal(f.calls.length, 0);
  f.get('halfGoalTime').value = '02:10:30'; f.controller.sync();
  assert.equal(f.get('halfGoalTimeMinutes').value, '10');
  f.get('recordTime').value = ''; f.controller.sync('recordTime');
  assert.deepEqual(['Hours', 'Minutes', 'Seconds'].map(suffix => f.get('recordTime' + suffix).value), ['', '', '']);
  assert.equal(f.calls.length, 0);
  assert.equal(f.controller.sync('not-a-duration'), false);
});

test('validation focuses the visible incorrect segment and programmatic state propagates', () => {
  const f = fixture();
  f.enter('halfGoalTimeSeconds', '77');
  assert.equal(f.controller.focus('halfGoalTime'), true);
  assert.equal(f.doc.activeElement, f.get('halfGoalTimeSeconds'));
  assert.equal(f.controller.focus('not-a-duration'), false);
  f.get('halfGoalTime').disabled = true; f.get('halfGoalTime').readOnly = true; f.controller.sync('halfGoalTime');
  for (const suffix of ['Hours', 'Minutes', 'Seconds']) {
    assert.equal(f.get('halfGoalTime' + suffix).disabled, true);
    assert.equal(f.get('halfGoalTime' + suffix).readOnly, true);
  }
});

test('zero, excessive hours and ambiguous old values remain invalid', () => {
  assert.match(DurationInput.errorsFor(['0', '0', '0'])[0], /大于 0/);
  assert.match(DurationInput.errorsFor(['13', '00', '00'])[0], /0–12/);
  assert.equal(DurationInput.serialize(['1', '', '0']), '01::00');
  assert.deepEqual(DurationInput.split('1:50'), ['1:50', '', '']);
  const f = fixture({benchmarkTime: '1:50'});
  assert.equal(f.get('benchmarkTime').value, '1:50', 'Loading never rewrites old data.');
  assert.match(f.get('benchmarkTimeHours').validationMessage, /数字/);
});

test('Enter advances deliberately while destroy restores the original label and input', () => {
  const f = fixture();
  let prevented = false;
  f.get('halfGoalTimeHours').dispatchEvent({type: 'keydown', key: 'Enter', preventDefault() { prevented = true; }});
  assert.equal(prevented, true); assert.equal(f.doc.activeElement, f.get('halfGoalTimeMinutes'));
  f.controller.destroy();
  assert.equal(f.get('halfGoalTime').hidden, false);
  assert.equal(f.get('halfGoalTime').getAttribute('aria-hidden'), null);
  assert.equal(f.doc.elements.find(item => item.tagName === 'LABEL').htmlFor, 'halfGoalTime');
  assert.equal(f.controller.focus('halfGoalTime'), false);
});
