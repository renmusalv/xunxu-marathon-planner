(function (global, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.XunxuMobileSchedule = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';

  const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const OWNED_ATTRIBUTES = ['hidden', 'inert', 'aria-hidden', 'role', 'aria-labelledby', 'aria-label', 'tabindex', 'id'];
  let instanceCount = 0;

  function parseDate(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(0);
    date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    date.setUTCHours(0, 0, 0, 0);
    return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]) ? date : null;
  }

  function offsetDate(value, days) {
    const date = parseDate(value);
    if (!date) return '';
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function localDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function shortDate(value) {
    const date = parseDate(value);
    return date ? `${date.getUTCMonth() + 1}/${date.getUTCDate()}` : '';
  }

  function resolveSelection(weeks, options) {
    const {preferredDate, today} = options || {};
    const dates = [];
    weeks.forEach((week, weekIndex) => week.days.forEach((day, dayIndex) => {
      if (parseDate(day.date)) dates.push({weekIndex, dayIndex, date: day.date});
    }));
    if (!dates.length) return null;
    return dates.find(item => item.date === preferredDate)
      || dates.find(item => item.date === today)
      || dates.find(item => item.date >= today)
      || dates[dates.length - 1];
  }

  function selectionForWeek(weeks, weekIndex, previousDate) {
    const index = Math.max(0, Math.min(weeks.length - 1, weekIndex));
    const week = weeks[index];
    if (!week || !week.days.length) return null;
    const previous = parseDate(previousDate);
    const weekday = previous?.getUTCDay();
    const sameDay = week.days.findIndex(day => parseDate(day.date)?.getUTCDay() === weekday);
    const dayIndex = sameDay >= 0 ? sameDay : Math.min(week.days.length - 1, previous ? (weekday + 6) % 7 : 0);
    return {weekIndex: index, dayIndex, date: week.days[dayIndex].date};
  }

  function nearestIndex(left, offsets) {
    let selected = 0;
    offsets.forEach((offset, index) => {
      if (Math.abs(left - offset) < Math.abs(left - offsets[selected])) selected = index;
    });
    return selected;
  }

  function create(options) {
    const root = options?.root;
    if (!root?.ownerDocument) throw new Error('A schedule root element is required.');
    const document = root.ownerDocument;
    const window = document.defaultView;
    const now = options.now || (() => new Date());
    const id = `mobile-schedule-${++instanceCount}`;
    const media = window.matchMedia('(max-width: 900px)');
    const attributes = new Map();
    const heights = new Map();
    const gridHandlers = new Map();
    const touchStarts = new WeakMap();
    let weeks = [], selected = null, context = {}, dayButtons = [], destroyed = false;
    let frame = 0, scrollFrame = 0, resizeObserver;

    function element(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function button(className, text, label, callback) {
      const node = element('button', className, text);
      node.type = 'button';
      node.setAttribute('aria-label', label);
      node.addEventListener('click', callback);
      return node;
    }

    const controls = element('nav', 'mobile-schedule-controls');
    controls.setAttribute('aria-label', '训练周与训练日');
    controls.hidden = true;
    const weekRow = element('div', 'mobile-week-row');
    const previousWeek = button('mobile-week-arrow', '‹', '上一周', () => changeWeek(selected.weekIndex - 1));
    const nextWeek = button('mobile-week-arrow', '›', '下一周', () => changeWeek(selected.weekIndex + 1));
    const weekLabel = element('label', 'mobile-week-select');
    weekLabel.htmlFor = `${id}-week`;
    weekLabel.appendChild(element('span', '', '选择训练周'));
    const weekSelect = element('select');
    weekSelect.id = `${id}-week`;
    weekSelect.setAttribute('aria-label', '选择训练周');
    weekSelect.addEventListener('change', () => changeWeek(Number(weekSelect.value)));
    weekLabel.appendChild(weekSelect);
    weekRow.append(previousWeek, weekLabel, nextWeek);
    const weekSummary = element('p', 'mobile-week-summary');
    const dayTabs = element('div', 'mobile-day-tabs');
    dayTabs.setAttribute('role', 'tablist');
    dayTabs.setAttribute('aria-label', '本周训练日');
    const dayRow = element('div', 'mobile-day-row');
    const previousDay = button('mobile-day-arrow', '‹ 前一天', '前一天', () => changeDay(selected.dayIndex - 1));
    const nextDay = button('mobile-day-arrow', '后一天 ›', '后一天', () => changeDay(selected.dayIndex + 1));
    const swipeHint = element('span', 'mobile-swipe-hint', '左右滑动切换每天');
    dayRow.append(previousDay, swipeHint, nextDay);
    const announcement = element('span', 'mobile-schedule-announcement');
    announcement.setAttribute('role', 'status');
    announcement.setAttribute('aria-live', 'polite');
    announcement.setAttribute('aria-atomic', 'true');
    controls.append(weekRow, weekSummary, dayTabs, dayRow, announcement);
    root.parentNode.insertBefore(controls, root);

    function remember(node) {
      if (!attributes.has(node)) attributes.set(node, Object.fromEntries(OWNED_ATTRIBUTES.map(name => [name, node.getAttribute(name)])));
    }

    function restore() {
      attributes.forEach((saved, node) => Object.entries(saved).forEach(([name, value]) => {
        if (value === null) node.removeAttribute(name);
        else node.setAttribute(name, value);
      }));
      heights.forEach((height, node) => { node.style.height = height; });
      root.classList.remove('is-mobile-schedule');
      resizeObserver?.disconnect();
    }

    function offsets(week) {
      const first = week.days[0]?.node.offsetLeft || 0;
      return week.days.map(day => day.node.offsetLeft - first);
    }

    function fitHeight() {
      if (destroyed || !media.matches || !selected) return;
      const week = weeks[selected.weekIndex], day = week?.days[selected.dayIndex];
      if (!day || week.grid.clientWidth === 0) return;
      const height = Math.ceil(day.node.getBoundingClientRect().height);
      if (height) week.grid.style.height = `${height}px`;
    }

    function alignSelection() {
      if (destroyed || !media.matches || !selected) return;
      const week = weeks[selected.weekIndex];
      if (!week || week.grid.clientWidth === 0) return;
      week.grid.scrollTo({left: offsets(week)[selected.dayIndex] || 0, behavior: 'auto'});
      fitHeight();
    }

    function scheduleAlignment() {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(alignSelection);
    }

    function updateDayState(announce) {
      if (!selected) return;
      const week = weeks[selected.weekIndex];
      week.days.forEach((day, index) => {
        const active = index === selected.dayIndex;
        const tab = dayButtons[index];
        tab?.setAttribute('aria-selected', String(active));
        if (tab) tab.tabIndex = active ? 0 : -1;
        if (media.matches) {
          day.node.setAttribute('role', 'tabpanel');
          day.node.setAttribute('aria-labelledby', `${id}-tab-${index}`);
          day.node.setAttribute('aria-hidden', String(!active));
          day.node.toggleAttribute('inert', !active);
          day.node.id = `${id}-day-${index}`;
          day.node.tabIndex = -1;
        }
      });
      previousDay.disabled = selected.weekIndex === 0 && selected.dayIndex === 0;
      nextDay.disabled = selected.weekIndex === weeks.length - 1 && selected.dayIndex === week.days.length - 1;
      resizeObserver?.disconnect();
      if (media.matches) resizeObserver?.observe(week.days[selected.dayIndex].node);
      fitHeight();
      if (announce) announcement.textContent = `${week.label}，${dayButtons[selected.dayIndex]?.getAttribute('aria-label') || selected.date}`;
    }

    function renderDayTabs() {
      dayTabs.replaceChildren();
      dayButtons = [];
      if (!selected) return;
      const today = localDate(now());
      const week = weeks[selected.weekIndex];
      week.days.forEach((day, index) => {
        const date = parseDate(day.date);
        const name = date ? DAY_NAMES[date.getUTCDay()] : `第 ${index + 1} 天`;
        const tab = button('mobile-day-tab', undefined, `${day.date} ${name} ${day.title}`, () => changeDay(index));
        tab.id = `${id}-tab-${index}`;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', `${id}-day-${index}`);
        tab.append(element('span', 'mobile-day-name', name), element('strong', 'mobile-day-date', date ? String(date.getUTCDate()) : String(index + 1)));
        if (day.date === today) {
          tab.classList.add('is-today');
          tab.setAttribute('aria-label', `${day.date} 今天 ${name} ${day.title}`);
        }
        tab.addEventListener('keydown', event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? week.days.length - 1 : index + (event.key === 'ArrowRight' ? 1 : -1);
          changeDay(next);
          dayButtons[selected?.dayIndex || 0]?.focus({preventScroll: true});
        });
        dayButtons.push(tab);
        dayTabs.appendChild(tab);
      });
    }

    function applyMode(announce) {
      restore();
      const mobile = media.matches && Boolean(selected);
      controls.hidden = !mobile;
      if (!mobile) {
        weeks.forEach(week => week.grid.scrollTo({left: 0, behavior: 'auto'}));
        return;
      }
      root.classList.add('is-mobile-schedule');
      weeks.forEach((week, index) => {
        const inactive = index !== selected.weekIndex;
        week.node.hidden = inactive;
        week.node.toggleAttribute('inert', inactive);
        week.node.setAttribute('aria-hidden', String(inactive));
      });
      const week = weeks[selected.weekIndex];
      weekSelect.value = String(selected.weekIndex);
      previousWeek.disabled = selected.weekIndex === 0;
      nextWeek.disabled = selected.weekIndex === weeks.length - 1;
      weekSummary.textContent = week.stats;
      renderDayTabs();
      updateDayState(announce);
      alignSelection();
      scheduleAlignment();
    }

    function changeDay(index) {
      if (!selected) return;
      const week = weeks[selected.weekIndex];
      if (index < 0) {
        if (selected.weekIndex === 0) return;
        const previous = weeks[selected.weekIndex - 1];
        selected = {weekIndex: selected.weekIndex - 1, dayIndex: previous.days.length - 1, date: previous.days[previous.days.length - 1].date};
        applyMode(true);
        return;
      }
      if (index >= week.days.length) {
        if (selected.weekIndex >= weeks.length - 1) return;
        const next = weeks[selected.weekIndex + 1];
        selected = {weekIndex: selected.weekIndex + 1, dayIndex: 0, date: next.days[0].date};
        applyMode(true);
        return;
      }
      selected = {weekIndex: selected.weekIndex, dayIndex: index, date: week.days[index].date};
      updateDayState(true);
      alignSelection();
    }

    function changeWeek(index) {
      if (!selected) return;
      selected = selectionForWeek(weeks, index, selected.date);
      applyMode(true);
    }

    function readWeeks() {
      return Array.from(root.querySelectorAll('.week')).map(node => {
        const grid = node.querySelector('.day-grid');
        if (!grid) return null;
        const days = Array.from(grid.children).filter(day => day.classList.contains('day')).map((day, index) => ({
          node: day,
          date: day.dataset.date || day.querySelector('.checkin')?.dataset.date || offsetDate(node.dataset.start, index),
          title: day.querySelector('.title')?.textContent.trim() || '训练安排'
        }));
        if (!days.length) return null;
        const label = node.querySelector('.week-title b')?.textContent.trim() || '训练周';
        const stats = Array.from(node.querySelectorAll('.week-stats > span')).map(item => item.textContent.replace(/\s+/g, ' ').trim()).join(' · ');
        return {node, grid, days, label, stats, start: node.dataset.start || days[0].date, end: node.dataset.end || days[days.length - 1].date};
      }).filter(Boolean);
    }

    function clearGridHandlers() {
      gridHandlers.forEach((handlers, grid) => {
        grid.removeEventListener('scroll', handlers.scroll);
        grid.removeEventListener('toggle', fitHeight, true);
        grid.removeEventListener('touchstart', handlers.touchStart);
        grid.removeEventListener('touchend', handlers.touchEnd);
        grid.removeEventListener('touchcancel', handlers.touchCancel);
      });
      gridHandlers.clear();
      window.cancelAnimationFrame(scrollFrame);
    }

    function refresh(nextContext) {
      if (destroyed) return;
      const input = nextContext || {};
      if (input.profileKey !== undefined && context.profileKey !== undefined && input.profileKey !== context.profileKey) selected = null;
      context = {...context, ...input};
      clearGridHandlers();
      restore();
      attributes.clear();
      heights.clear();
      weeks = readWeeks();
      weeks.forEach((week, weekIndex) => {
        remember(week.node);
        heights.set(week.grid, week.grid.style.height);
        week.days.forEach(day => remember(day.node));
        const scrollHandler = () => {
          if (!media.matches || !selected || selected.weekIndex !== weekIndex) return;
          window.cancelAnimationFrame(scrollFrame);
          scrollFrame = window.requestAnimationFrame(() => {
            if (!selected || selected.weekIndex !== weekIndex || week.grid.clientWidth === 0) return;
            const dayIndex = nearestIndex(week.grid.scrollLeft, offsets(week));
            if (dayIndex !== selected.dayIndex) {
              selected = {weekIndex, dayIndex, date: week.days[dayIndex].date};
              updateDayState(true);
            }
          });
        };
        const touchStart = event => {
          const touch = event.changedTouches?.[0];
          if (!touch) return;
          touchStarts.set(week.grid, {
            x: touch.clientX,
            y: touch.clientY,
            atLastDay: selected?.weekIndex === weekIndex && selected.dayIndex === week.days.length - 1,
            atFirstDay: selected?.weekIndex === weekIndex && selected.dayIndex === 0
          });
        };
        const touchEnd = event => {
          const start = touchStarts.get(week.grid), touch = event.changedTouches?.[0];
          touchStarts.delete(week.grid);
          if (!start || !touch || !media.matches || !selected || selected.weekIndex !== weekIndex) return;
          const dx = touch.clientX - start.x, dy = touch.clientY - start.y;
          if (Math.abs(dx) < 52 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
          if (dx < 0 && start.atLastDay && weekIndex < weeks.length - 1) changeDay(week.days.length);
          else if (dx > 0 && start.atFirstDay && weekIndex > 0) changeDay(-1);
        };
        const touchCancel = () => touchStarts.delete(week.grid);
        week.grid.addEventListener('scroll', scrollHandler, {passive: true});
        week.grid.addEventListener('touchstart', touchStart, {passive: true});
        week.grid.addEventListener('touchend', touchEnd, {passive: true});
        week.grid.addEventListener('touchcancel', touchCancel, {passive: true});
        week.grid.addEventListener('toggle', fitHeight, true);
        gridHandlers.set(week.grid, {scroll: scrollHandler, touchStart, touchEnd, touchCancel});
      });
      selected = resolveSelection(weeks, {preferredDate: selected?.date, today: localDate(now())});
      weekSelect.replaceChildren();
      weeks.forEach((week, index) => {
        const option = element('option', '', `${week.label} · ${shortDate(week.start)}—${shortDate(week.end)}`);
        option.value = String(index);
        weekSelect.appendChild(option);
      });
      applyMode(false);
    }

    function activate() { if (!destroyed) { applyMode(false); scheduleAlignment(); } }
    function reset() { selected = null; context = {}; refresh(); }
    function handleResize() { if (media.matches) scheduleAlignment(); }
    function handleMediaChange() { applyMode(false); }
    if (typeof window.ResizeObserver === 'function') resizeObserver = new window.ResizeObserver(fitHeight);
    media.addEventListener('change', handleMediaChange);
    window.addEventListener('resize', handleResize, {passive: true});
    refresh();

    return {
      refresh,
      activate,
      reset,
      selection: () => selected ? {...selected} : null,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        clearGridHandlers();
        window.cancelAnimationFrame(frame);
        media.removeEventListener('change', handleMediaChange);
        window.removeEventListener('resize', handleResize);
        restore();
        controls.remove();
      }
    };
  }

  return {create, resolveSelection, selectionForWeek, offsetDate, nearestIndex};
});
