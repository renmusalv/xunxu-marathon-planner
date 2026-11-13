const test = require('node:test');
const assert = require('node:assert/strict');
const {create} = require('../src/mobile-layout.js');

// Exercise navigation and responsive lifecycle with explicit viewport changes.
// This deliberately does not simulate layout; that is checked in browser QA.
function harness({mobile = true, reducedMotion = false} = {}) {
  const nodes = new Map(), frames = [];
  const document = {activeElement: null, getElementById: id => nodes.get(id) || null};
  class Element {
    constructor(id) {
      this.id = id; this.ownerDocument = document; this.dataset = {}; this.attrs = new Map();
      this.listeners = new Map(); this.children = []; this.hidden = false; this.open = true;
      this.scrollCalls = []; this.focusCalls = []; nodes.set(id, this);
    }
    setAttribute(name, value) { this.attrs.set(name, String(value)); }
    getAttribute(name) { return this.attrs.get(name) ?? null; }
    removeAttribute(name) { this.attrs.delete(name); }
    addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
    removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
    emit(name, event = {}) {
      const e = {target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...event};
      [...(this.listeners.get(name) || [])].forEach(fn => fn(e)); return e;
    }
    querySelectorAll(selector) { return selector === '[data-view]' ? this.children.filter(child => child.dataset.view) : []; }
    contains(element) { return this === element || this.children.some(child => child.contains(element)); }
    focus(options) { document.activeElement = this; this.focusCalls.push(options); }
    scrollIntoView(options) { this.scrollCalls.push(options); }
  }
  const media = {matches: mobile, listeners: new Set(), addEventListener(type, fn) { this.listeners.add(fn); }, removeEventListener(type, fn) { this.listeners.delete(fn); }};
  document.defaultView = {
    matchMedia: query => query.includes('prefers-reduced-motion') ? {matches: reducedMotion} : media,
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; }
  };
  const shell = new Element('workspaceShell'), profile = new Element('plannerForm'), plan = new Element('planWorkspace'), tabs = new Element('workspaceTabs');
  const profileButton = new Element('view-profile'), scheduleButton = new Element('view-schedule');
  profileButton.dataset.view = 'profile'; scheduleButton.dataset.view = 'schedule';
  tabs.children = [profileButton, scheduleButton]; shell.children = [tabs, profile, plan];
  const insights = new Element('planInsights'), explanation = new Element('planExplanation'), courseButton = new Element('courseCheckin');
  plan.children = [insights, explanation, courseButton];
  let activations = 0;
  const controller = create({shell, profile, plan, tabs, onSchedule: () => activations++});
  function flush() { while (frames.length) frames.shift()(); }
  function setMobile(value) { media.matches = value; [...media.listeners].forEach(fn => fn({matches: value})); flush(); }
  return {controller, shell, profile, plan, tabs, profileButton, scheduleButton, insights, explanation, courseButton, document, media, flush, setMobile, activations: () => activations};
}

test('mobile workspace shows one panel and updates accessible tab state on click', () => {
  const h = harness();
  assert.equal(h.profile.hidden, false); assert.equal(h.plan.hidden, true); assert.equal(h.tabs.hidden, false);
  assert.equal(h.profile.getAttribute('role'), 'tabpanel'); assert.equal(h.profile.getAttribute('aria-labelledby'), 'view-profile');
  assert.equal(h.plan.getAttribute('aria-labelledby'), 'view-schedule');
  assert.equal(h.profileButton.getAttribute('aria-selected'), 'true'); assert.equal(h.profileButton.tabIndex, 0);
  assert.equal(h.scheduleButton.tabIndex, -1);
  h.scheduleButton.emit('click'); h.flush();
  assert.equal(h.controller.getView(), 'schedule'); assert.equal(h.shell.dataset.workspaceView, 'schedule');
  assert.equal(h.profile.hidden, true); assert.equal(h.plan.hidden, false);
  assert.equal(h.profileButton.getAttribute('aria-selected'), 'false'); assert.equal(h.scheduleButton.getAttribute('aria-selected'), 'true');
  assert.equal(h.scheduleButton.tabIndex, 0); assert.equal(h.profileButton.tabIndex, -1);
  assert.deepEqual(h.shell.scrollCalls.at(-1), {behavior: 'smooth', block: 'start'});
  assert.equal(h.tabs.scrollCalls.length, 0, 'Sticky tabs cannot anchor a return to the course header');
});

test('mobile workspace keyboard navigation moves selection and focus without trapping unrelated keys', () => {
  const h = harness();
  assert.equal(h.profileButton.emit('keydown', {key: 'ArrowRight'}).defaultPrevented, true);
  assert.equal(h.controller.getView(), 'schedule'); assert.equal(h.document.activeElement, h.scheduleButton);
  h.scheduleButton.emit('keydown', {key: 'ArrowLeft'}); assert.equal(h.controller.getView(), 'profile');
  h.profileButton.emit('keydown', {key: 'End'}); assert.equal(h.controller.getView(), 'schedule');
  h.scheduleButton.emit('keydown', {key: 'Home'}); assert.equal(h.document.activeElement, h.profileButton);
  assert.equal(h.profileButton.emit('keydown', {key: 'Tab'}).defaultPrevented, false);
  assert.equal(h.controller.getView(), 'profile'); assert.equal(h.shell.scrollCalls.length, 0);
});

test('desktop restores both panels and expanded analysis; returning mobile keeps focused course visible', () => {
  const h = harness();
  assert.equal(h.insights.open, false); assert.equal(h.explanation.open, false);
  h.setMobile(false);
  assert.equal(h.profile.hidden, false); assert.equal(h.plan.hidden, false); assert.equal(h.tabs.hidden, true);
  assert.equal(h.profile.getAttribute('role'), null); assert.equal(h.plan.getAttribute('aria-labelledby'), null);
  assert.equal(h.insights.open, true); assert.equal(h.explanation.open, true);
  assert.equal(h.activations(), 1);
  h.courseButton.focus(); h.setMobile(true);
  assert.equal(h.controller.getView(), 'schedule'); assert.equal(h.plan.hidden, false); assert.equal(h.profile.hidden, true);
  assert.equal(h.document.activeElement, h.courseButton);
  assert.equal(h.insights.open, false); assert.equal(h.explanation.open, false);
});

test('mobile disclosure choices survive desktop changes independently', () => {
  const h = harness();
  h.insights.open = true; h.insights.emit('toggle');
  h.explanation.open = false; h.explanation.emit('toggle');
  h.setMobile(false);
  // Desktop toggles must not overwrite the phone's disclosure preference.
  h.insights.open = false; h.insights.emit('toggle');
  h.explanation.open = true; h.explanation.emit('toggle');
  h.setMobile(true);
  assert.equal(h.insights.open, true); assert.equal(h.explanation.open, false);
  h.insights.open = false; h.insights.emit('toggle');
  h.setMobile(false); h.setMobile(true);
  assert.equal(h.insights.open, false); assert.equal(h.explanation.open, false);
});

test('schedule activation waits for visibility frame and scroll respects reduced motion', () => {
  const h = harness({reducedMotion: true});
  h.flush(); assert.equal(h.activations(), 0);
  h.controller.select('schedule', {scroll: true, focus: true});
  assert.equal(h.plan.hidden, false); assert.equal(h.activations(), 0);
  h.flush(); assert.equal(h.activations(), 1);
  assert.equal(h.document.activeElement, h.scheduleButton);
  assert.deepEqual(h.shell.scrollCalls.at(-1), {behavior: 'auto', block: 'start'});
  assert.equal(h.tabs.scrollCalls.length, 0);
  h.controller.select('profile'); h.flush(); assert.equal(h.activations(), 1);
  h.controller.select('unexpected'); assert.equal(h.controller.getView(), 'profile');
});

test('destroy removes controls and responsive listeners, cancels callbacks, and restores visibility', () => {
  const h = harness();
  h.controller.select('schedule');
  h.controller.destroy(); h.flush();
  assert.equal(h.activations(), 0); assert.equal(h.media.listeners.size, 0);
  assert.equal(h.profile.hidden, false); assert.equal(h.plan.hidden, false); assert.equal(h.tabs.hidden, true);
  assert.equal(h.profile.getAttribute('role'), null); assert.equal(h.plan.getAttribute('aria-labelledby'), null);
  assert.equal(h.shell.dataset.workspaceView, undefined, 'CSS view selector must not keep hiding a restored panel');
  for (const node of [h.profileButton, h.scheduleButton, h.insights, h.explanation]) {
    assert.ok([...node.listeners.values()].every(listeners => listeners.size === 0));
  }
  h.profileButton.emit('click'); h.setMobile(false); h.setMobile(true); h.controller.select('profile'); h.flush();
  assert.equal(h.profile.hidden, false); assert.equal(h.plan.hidden, false); assert.equal(h.activations(), 0);
});
