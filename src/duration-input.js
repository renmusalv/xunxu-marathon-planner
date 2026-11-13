(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.XunxuDurationInput = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const names = ['小时', '分钟', '秒'];
  const units = ['时', '分', '秒'];
  const suffixes = ['Hours', 'Minutes', 'Seconds'];

  function normalize(value) {
    return String(value ?? '').replace(/[０-９]/g, char => String(char.charCodeAt(0) - 0xff10))
      .replace(/：/g, ':').trim();
  }

  // Unfinished and invalid input stays unfinished/invalid. Never clamp 90 to
  // 59, discard a digit, or infer that a two-part duration means HH:MM.
  function serialize(parts) {
    const values = parts.map(normalize);
    if (values.every(value => value === '')) return '';
    return values.map(value => /^\d{1,2}$/.test(value) ? value.padStart(2, '0') : value).join(':');
  }

  function split(value) {
    const text = normalize(value);
    if (!text) return ['', '', ''];
    const parts = text.split(':');
    return parts.length === 3 ? parts : [text, '', ''];
  }

  function errorsFor(parts) {
    const values = parts.map(normalize);
    const errors = values.map((value, index) => {
      if (!value) return `请填写${names[index]}；没有则填 0。`;
      if (!/^\d{1,2}$/.test(value)) return `${names[index]}请填写 1–2 位数字。`;
      if (Number(value) > (index === 0 ? 12 : 59)) return `${names[index]}请填写 ${index === 0 ? '0–12' : '0–59'}。`;
      return '';
    });
    if (errors.every(error => !error) && values.every(value => Number(value) === 0)) errors[0] = '用时需要大于 0。';
    return errors;
  }

  function mount(scope, options = {}) {
    const doc = scope.nodeType === 9 ? scope : scope.ownerDocument;
    const entries = new Map();
    const selector = options.selector || 'input[data-duration]';
    const inputs = scope.matches?.(selector) ? [scope] : Array.from(scope.querySelectorAll(selector));
    const eventClass = doc.defaultView?.Event || (typeof Event !== 'undefined' ? Event : null);

    function resolve(target) {
      if (typeof target === 'string') return entries.get(doc.getElementById(target));
      return entries.get(target);
    }

    function updateValidity(entry, reveal) {
      const values = entry.fields.map(field => field.value);
      const errors = errorsFor(values);
      entry.fields.forEach((field, index) => {
        field.setCustomValidity(errors[index]);
        const visiblyInvalid = Boolean(errors[index] && (reveal || normalize(values[index])));
        if (visiblyInvalid) field.setAttribute('aria-invalid', 'true');
        else field.removeAttribute('aria-invalid');
      });
      const shown = errors.find((error, index) => error && (reveal || normalize(values[index]))) || '';
      entry.error.textContent = shown;
      entry.error.hidden = !shown;
      return errors;
    }

    function notify(entry, type) {
      if (!eventClass) return;
      entry.notifying = true;
      try { entry.input.dispatchEvent(new eventClass(type, {bubbles: true})); }
      finally { entry.notifying = false; }
    }

    function write(entry, type = 'input') {
      entry.input.value = serialize(entry.fields.map(field => field.value));
      updateValidity(entry, false);
      notify(entry, type);
    }

    function syncEntry(entry) {
      const values = split(entry.input.value);
      entry.fields.forEach((field, index) => {
        field.value = values[index];
        field.disabled = entry.input.disabled;
        field.readOnly = entry.input.readOnly;
      });
      updateValidity(entry, false);
    }

    inputs.forEach(input => {
      if (!input.id || input.dataset.durationMounted === 'true') return;
      const associatedLabels = Array.from(input.labels || []);
      const context = input.getAttribute('data-duration-label') || input.getAttribute('aria-label') || associatedLabels.map(label => label.textContent.trim()).join(' ') || '用时';
      const wrapper = doc.createElement('div');
      wrapper.className = 'duration-input';
      wrapper.setAttribute('role', 'group');
      wrapper.setAttribute('aria-label', context);
      const description = input.getAttribute('aria-describedby');
      if (description) wrapper.setAttribute('aria-describedby', description);

      const error = doc.createElement('small');
      error.id = input.id + 'DurationError';
      error.className = 'duration-error';
      error.hidden = true;
      error.setAttribute('aria-live', 'polite');
      const entry = {
        input, wrapper, error, fields: [], notifying: false, listeners: [],
        original: {hidden: input.hidden, tabIndex: input.getAttribute('tabindex'), ariaHidden: input.getAttribute('aria-hidden')},
        labels: associatedLabels.map(label => ({label, htmlFor: label.htmlFor}))
      };
      function listen(target, name, handler) {
        target.addEventListener(name, handler);
        entry.listeners.push(() => target.removeEventListener(name, handler));
      }

      names.forEach((name, index) => {
        const cell = doc.createElement('div');
        cell.className = 'duration-part';
        const field = doc.createElement('input');
        field.id = input.id + suffixes[index];
        field.type = 'text';
        field.inputMode = 'numeric';
        field.autocomplete = 'off';
        field.enterKeyHint = index < 2 ? 'next' : 'done';
        field.pattern = '[0-9]{1,2}';
        field.placeholder = '00';
        field.setAttribute('aria-label', context + ' · ' + name);
        field.setAttribute('aria-describedby', [description, error.id].filter(Boolean).join(' '));
        const unit = doc.createElement('label');
        unit.htmlFor = field.id;
        unit.className = 'duration-unit';
        unit.textContent = units[index];
        cell.append(field, unit);
        wrapper.appendChild(cell);
        entry.fields.push(field);

        listen(field, 'input', event => {
          if (event.isComposing) return;
          const normalized = normalize(field.value);
          if (field.value !== normalized) field.value = normalized;
          write(entry);
        });
        listen(field, 'compositionend', () => {
          field.value = normalize(field.value);
          write(entry);
        });
        listen(field, 'change', () => write(entry, 'change'));
        listen(field, 'blur', () => {
          const value = normalize(field.value);
          if (/^\d{1,2}$/.test(value) && Number(value) <= (index === 0 ? 12 : 59)) field.value = value.padStart(2, '0');
          updateValidity(entry, false);
        });
        listen(field, 'keydown', event => {
          if (event.key === 'Enter' && index < 2) {
            event.preventDefault();
            entry.fields[index + 1].focus();
          }
        });
        listen(field, 'paste', event => {
          const pasted = normalize(event.clipboardData?.getData('text') || '');
          // A complete clock can be pasted into any segment. Out-of-range
          // digits remain visible so the user can correct them deliberately.
          const match = pasted.match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
          if (!match) return;
          event.preventDefault();
          entry.fields.forEach((part, partIndex) => { part.value = match[partIndex + 1]; });
          write(entry);
          notify(entry, 'change');
        });
      });

      wrapper.appendChild(error);
      input.parentNode.insertBefore(wrapper, input.nextSibling);
      input.hidden = true;
      input.setAttribute('aria-hidden', 'true');
      input.setAttribute('tabindex', '-1');
      // Keep type=text: type=hidden changes value's reset/default semantics.
      // Both host forms use novalidate and validate the canonical duration.
      input.dataset.durationMounted = 'true';
      associatedLabels.forEach(label => { label.htmlFor = entry.fields[0].id; });
      entries.set(input, entry);
      ['input', 'change'].forEach(type => listen(input, type, () => {
        if (!entry.notifying) syncEntry(entry);
      }));
      syncEntry(entry);
    });

    return {
      sync(target) {
        if (target === undefined) { entries.forEach(syncEntry); return true; }
        const entry = resolve(target);
        if (!entry) return false;
        syncEntry(entry);
        return true;
      },
      focus(target) {
        const entry = resolve(target);
        if (!entry) return false;
        const errors = updateValidity(entry, true);
        entry.fields[Math.max(0, errors.findIndex(Boolean))].focus();
        return true;
      },
      destroy() {
        entries.forEach(entry => {
          entry.listeners.forEach(remove => remove());
          entry.wrapper.remove();
          entry.input.hidden = entry.original.hidden;
          for (const [name, value] of [['tabindex', entry.original.tabIndex], ['aria-hidden', entry.original.ariaHidden]]) {
            if (value === null) entry.input.removeAttribute(name);
            else entry.input.setAttribute(name, value);
          }
          entry.labels.forEach(item => { item.label.htmlFor = item.htmlFor; });
          delete entry.input.dataset.durationMounted;
        });
        entries.clear();
      }
    };
  }

  return {mount, normalize, serialize, split, errorsFor};
});
