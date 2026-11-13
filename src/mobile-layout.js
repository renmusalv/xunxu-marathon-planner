(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.XunxuWorkspace = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  function create(options) {
    const {shell, profile, plan, tabs, onSchedule} = options;
    if (!shell || !profile || !plan || !tabs) return null;
    const doc = shell.ownerDocument;
    const win = doc.defaultView;
    const media = win.matchMedia('(max-width: 900px)');
    const buttons = Array.from(tabs.querySelectorAll('[data-view]'));
    const disclosures = ['planInsights', 'planExplanation'].map(id => doc.getElementById(id)).filter(Boolean);
    const openOnMobile = new Map(disclosures.map(element => [element.id, false]));
    let view = 'profile';
    let destroyed = false;

    function activateSchedule() {
      if (view === 'schedule' || !media.matches) {
        win.requestAnimationFrame(() => { if (!destroyed) onSchedule?.(); });
      }
    }

    function updatePanels() {
      const mobile = media.matches;
      shell.dataset.workspaceView = view;
      tabs.hidden = !mobile;
      profile.hidden = mobile && view !== 'profile';
      plan.hidden = mobile && view !== 'schedule';
      [[profile, 'view-profile'], [plan, 'view-schedule']].forEach(([panel, label]) => {
        if (mobile) {
          panel.setAttribute('role', 'tabpanel');
          panel.setAttribute('aria-labelledby', label);
        } else {
          panel.removeAttribute('role');
          panel.removeAttribute('aria-labelledby');
        }
      });
      buttons.forEach(button => {
        const active = button.dataset.view === view;
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
      });
      activateSchedule();
    }

    function select(next, {scroll = false, focus = false} = {}) {
      if (!['profile', 'schedule'].includes(next) || destroyed) return;
      view = next;
      updatePanels();
      if (media.matches) {
        if (focus) doc.getElementById('view-' + view)?.focus({preventScroll: true});
        if (scroll) shell.scrollIntoView({behavior: win.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start'});
      }
    }

    function onViewportChange() {
      if (media.matches && plan.contains(doc.activeElement)) view = 'schedule';
      disclosures.forEach(element => { element.open = media.matches ? openOnMobile.get(element.id) : true; });
      updatePanels();
    }

    const listeners = [];
    buttons.forEach(button => {
      const click = () => select(button.dataset.view, {scroll: true});
      const keydown = event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'profile' : event.key === 'End' ? 'schedule' : view === 'profile' ? 'schedule' : 'profile';
        select(next, {focus: true});
      };
      button.addEventListener('click', click);
      button.addEventListener('keydown', keydown);
      listeners.push(() => { button.removeEventListener('click', click); button.removeEventListener('keydown', keydown); });
    });
    disclosures.forEach(element => {
      const toggle = () => { if (media.matches) openOnMobile.set(element.id, element.open); };
      element.addEventListener('toggle', toggle);
      listeners.push(() => element.removeEventListener('toggle', toggle));
    });
    media.addEventListener('change', onViewportChange);
    onViewportChange();
    return {
      select,
      getView: () => view,
      isMobile: () => media.matches,
      destroy() {
        destroyed = true;
        media.removeEventListener('change', onViewportChange);
        listeners.forEach(remove => remove());
        profile.hidden = false;
        plan.hidden = false;
        tabs.hidden = true;
        delete shell.dataset.workspaceView;
        [profile, plan].forEach(panel => { panel.removeAttribute('role'); panel.removeAttribute('aria-labelledby'); });
      }
    };
  }
  return {create};
});
