(function () {
  'use strict';

  const UPDATED = '2026-11-13';
  const events = [
    {
      name: '2026诸暨西施半程马拉松', date: '2026-11-15', city: '浙江 · 诸暨', distance: '半程马拉松',
      signupState: 'closed', signupEnd: '2026-10-08T17:00:00+08:00', signupText: '报名已截止（10月8日截止）',
      routeText: '西施篮球中心起跑，经过银杏大道；本条赛事信息未收录官方赛道图。', routeMap: '待查官方赛道图',
      signupUrl: '', sourceUrl: 'https://chinamarathon.com/events/34061', sourceLabel: '赛事公告与路线信息', dateSource: '赛事信息页'
    },
    {
      name: '2026湛江半程马拉松赛', date: '2026-12-06', time: '07:00', city: '广东 · 湛江', distance: '半程马拉松',
      signupState: 'closed', signupEnd: '2026-10-28T18:00:00+08:00', signupText: '报名已截止（10月28日截止）',
      routeText: '起点：湛江时代广场（海滨大道南）；终点：湛江市体育中心。', routeMap: '路线说明已公布；官方路线图待核对',
      signupUrl: '', sourceUrl: 'https://reg.zuicool.com/en/56868', sourceLabel: '赛事规程与路线说明', dateSource: '赛事规程'
    },
    {
      name: '2026深圳南山半程马拉松', date: '2026-12-20', city: '广东 · 深圳南山', distance: '半程马拉松',
      signupState: 'unknown', signupText: '报名时间尚未查到公开公告',
      routeText: '赛道图与路线说明待组委会公布。', routeMap: '待公布',
      signupUrl: '', sourceUrl: 'https://chinamarathon.com/events/98403', sourceLabel: '赛事信息页', dateSource: '赛事目录'
    },
    {
      name: '2026重庆半程马拉松', date: '2026-12-27', time: '09:00', city: '重庆 · 巴南区', distance: '半程马拉松',
      signupState: 'closed', signupEnd: '2026-09-24T23:59:00+08:00', signupText: '报名已截止；赛事已公布候补结果',
      routeText: '碧海湾起跑，经巴滨路至融汇江山D区折返，回到碧海湾终点；赛道沿长江，整体起伏较小。', routeMap: '线路说明已公布；图示见赛事页面',
      signupUrl: '', sourceUrl: 'https://en.runninginchina.org/event/event_view/3086.html', sourceLabel: '竞赛规程与路线', dateSource: '组委会竞赛规程'
    },
    {
      name: '2026梅州马拉松', date: '2026-12-27', time: '07:30', city: '广东 · 梅州', distance: '全马 / 半马',
      signupState: 'open', signupStart: '2026-10-01T00:00:00+08:00', signupEnd: '2026-11-26T18:00:00+08:00', signupText: '报名至11月26日18:00 · 抽签',
      routeText: '半马从梅县人民广场出发，经府前大道、公园北路、剑英大道、沿江南路、梅州大桥、沿江西路、剑英纪念大桥、沿江半岛大道等路段，返回梅县人民广场。', routeMap: '线路说明已公布',
      signupUrl: 'https://reg.zuicool.com/en/12088', signupLabel: '报名入口',
      sourceUrl: 'https://www.sohu.com/a/1083106134_327710', sourceLabel: '竞赛规程与半马路线', dateSource: '梅州日报赛事公告'
    },
    {
      name: '2027粤港澳大湾区女子半程马拉松', date: '2027-01-01', time: '07:30', city: '广东 · 广州增城', distance: '女子半程马拉松',
      signupState: 'open', signupStart: '2026-11-02T10:00:00+08:00', signupEnd: '2026-11-22T18:00:00+08:00', signupText: '报名至11月22日18:00 · 超额抽签', eligibility: '仅限女性；须提交半马或10公里成绩证明，具体资格见规程。',
      routeText: '组委会尚未发布本届详细路线图。公告提及增城广场、荔湖公园、增江画廊等往届线路地标，不能视作本届最终路线。', routeMap: '本届赛道图待公布',
      signupUrl: 'https://gba-womenmarathon.sport-china.cn', signupLabel: '官方赛事入口',
      sourceUrl: 'https://ep.ycwb.com/epaper/xkb/html/2026-11/04/content_1506_771079.htm', sourceLabel: '报名时间与赛道公告', dateSource: '组委会公告'
    },
    {
      name: '2027人民保险茂名马拉松赛', date: '2027-01-10', time: '07:30', city: '广东 · 茂名电白', distance: '全马 / 半马',
      signupState: 'open', signupEnd: '2026-11-30T23:59:00+08:00', signupText: '报名已开启，11月30日截止 · 超额抽签',
      routeText: '赛道以中国第一滩为起点，沿滨海绿道串联疍家墟·塘霞俚街、歌美海公园、水东湾海洋公园等地标；半马最终路线图待组委会发布。', routeMap: '赛道方向已公布；路线图待公布',
      signupUrl: 'https://www.gusto.cn/', signupLabel: '报名平台与公告',
      sourceUrl: 'https://www.ctdsb.net/c1722_202611/2902478.html', sourceLabel: '报名与赛事公告', dateSource: '茂名市赛事发布会', eligibility: '设半程马拉松项目；报名要求及抽签规则以规程为准。'
    },
    {
      name: '2027普洱思茅马拉松', date: '2027-01-10', time: '08:00', city: '云南 · 普洱思茅', distance: '全马 / 半马',
      signupState: 'open', signupStart: '2026-09-10T14:00:00+08:00', signupEnd: '2026-11-30T22:00:00+08:00', signupText: '报名至11月30日22:00 · 抽签',
      routeText: '起点在普洱大剧院（海拔约1298米）；官方说明赛道待丈量确认后公布。', routeMap: '赛道图待公布',
      signupUrl: 'https://reg.zuicool.com/45049', signupLabel: '报名入口',
      sourceUrl: 'https://m.51sai.com/18877/des', sourceLabel: '竞赛规程与赛道公告', dateSource: '赛事规程'
    },
    {
      name: '2027扬州半程马拉松', date: '2027-03-28', city: '江苏 · 扬州', distance: '半程马拉松',
      signupState: 'unknown', signupText: '大众报名时间待官方公布', dateCertainty: '赛事日历暂列，待组委会确认',
      routeText: '目前没有核实到本届官方路线图；往届路线不能替代本届路线。', routeMap: '待公布',
      signupUrl: '', sourceUrl: 'https://www.yzmls.com/', sourceLabel: '扬州半马官方网站', dateSource: '公开赛事日历'
    },
    {
      name: '2027广元半程马拉松', date: '2027-03-28', city: '四川 · 广元', distance: '半程马拉松',
      signupState: 'unknown', signupText: '报名时间待官方公布', dateCertainty: '赛事日历暂列，待组委会确认',
      routeText: '目前没有核实到本届官方路线图或路线说明。', routeMap: '待公布',
      signupUrl: '', sourceUrl: 'https://zuicool.com/tag/615955?page=1', sourceLabel: '赛事日历信息', dateSource: '公开赛事日历'
    }
  ];

  const $ = id => document.getElementById(id);
  const list = $('eventPreviewList');
  if (!list) return;

  function shanghaiDateKey(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(date);
    const part = key => parts.find(item => item.type === key)?.value || '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  function plusSixMonths(dateKey) {
    const [year, month, day] = dateKey.split('-').map(Number);
    const end = new Date(Date.UTC(year, month - 1, day));
    end.setUTCMonth(end.getUTCMonth() + 6);
    return end.toISOString().slice(0, 10);
  }
  function registrationState(event, now) {
    if (event.signupStart && now < Date.parse(event.signupStart)) return 'pending';
    if (event.signupState === 'open' && event.signupEnd && now <= Date.parse(event.signupEnd)) return 'open';
    if (event.signupEnd && now > Date.parse(event.signupEnd)) return 'closed';
    return event.signupState === 'closed' ? 'closed' : 'pending';
  }
  function registrationLabel(event, state) {
    if (state === 'open') return '报名中';
    if (state === 'closed') return '报名已截止';
    return event.signupState === 'unknown' ? '报名待公布' : '报名待确认';
  }
  function prettyDate(value) {
    const [year, month, day] = value.split('-');
    return `${year}年${Number(month)}月${Number(day)}日`;
  }
  function createLink(url, label, className) {
    if (!url) return null;
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = label;
    link.className = className;
    return link;
  }
  function cardFor(event, state) {
    const card = document.createElement('article');
    card.className = `event-card event-card-${state}`;
    const date = document.createElement('div');
    date.className = 'event-date';
    date.innerHTML = `<strong>${Number(event.date.slice(5, 7))}<small>月</small></strong><span>${Number(event.date.slice(8, 10))}日</span>`;

    const content = document.createElement('div');
    content.className = 'event-card-content';
    const titleLine = document.createElement('div');
    titleLine.className = 'event-title-line';
    const title = document.createElement('h3');
    title.textContent = event.name;
    const badge = document.createElement('span');
    badge.className = 'event-status';
    badge.textContent = registrationLabel(event, state);
    titleLine.append(title, badge);
    content.appendChild(titleLine);

    const meta = document.createElement('p');
    meta.className = 'event-meta';
    meta.textContent = [event.city, event.distance, event.time ? `鸣枪 ${event.time}` : '', event.dateCertainty || ''].filter(Boolean).join(' · ');
    content.appendChild(meta);

    const signup = document.createElement('p');
    signup.className = 'event-signup-line';
    signup.textContent = event.signupText || '报名时间待官方公布';
    content.appendChild(signup);
    if (event.eligibility) {
      const eligibility = document.createElement('p');
      eligibility.className = 'event-eligibility';
      eligibility.textContent = event.eligibility;
      content.appendChild(eligibility);
    }

    const route = document.createElement('details');
    route.className = 'event-route';
    const summary = document.createElement('summary');
    summary.innerHTML = `<span>赛道信息</span><small>${event.routeMap}</small>`;
    const routeCopy = document.createElement('p');
    routeCopy.textContent = event.routeText;
    route.append(summary, routeCopy);
    content.appendChild(route);

    const actions = document.createElement('div');
    actions.className = 'event-actions';
    if (state === 'open' && event.signupUrl) actions.appendChild(createLink(event.signupUrl, event.signupLabel || '报名入口', 'event-action-primary'));
    const source = createLink(event.sourceUrl, event.sourceLabel || '赛事信息', 'event-action-secondary');
    if (source) actions.appendChild(source);
    content.appendChild(actions);
    card.append(date, content);
    card.dataset.state = state;
    card.dataset.name = event.name;
    card.dataset.source = event.dateSource || '';
    return card;
  }

  const today = shanghaiDateKey();
  const horizon = plusSixMonths(today);
  const now = Date.now();
  const upcoming = events.filter(event => event.date >= today && event.date <= horizon).sort((a, b) => a.date.localeCompare(b.date));
  const states = upcoming.map(event => ({event, state: registrationState(event, now)}));
  const counts = {all: states.length, open: 0, pending: 0, closed: 0};
  states.forEach(item => counts[item.state]++);
  $('eventPreviewCount').textContent = `${counts.open} 场报名中`;
  $('eventCountAll').textContent = counts.all;
  $('eventCountOpen').textContent = counts.open;
  $('eventCountPending').textContent = counts.pending;
  $('eventCountClosed').textContent = counts.closed;
  $('eventPreviewUpdated').textContent = `赛程信息更新于 ${prettyDate(UPDATED)} · 当前展示 ${prettyDate(today)} 至 ${prettyDate(horizon)}`;

  let filter = 'all';
  function render() {
    list.replaceChildren();
    const filtered = states.filter(item => filter === 'all' || item.state === filter);
    if (!filtered.length) {
      const empty = document.createElement('p');
      empty.className = 'event-empty';
      empty.textContent = filter === 'open' ? '当前收录赛事没有仍在报名的场次。' : '当前筛选下没有赛事。';
      list.appendChild(empty);
      return;
    }
    filtered.forEach(({event, state}) => list.appendChild(cardFor(event, state)));
  }
  document.querySelectorAll('[data-event-filter]').forEach(button => {
    button.addEventListener('click', () => {
      filter = button.dataset.eventFilter;
      document.querySelectorAll('[data-event-filter]').forEach(option => option.setAttribute('aria-pressed', String(option === button)));
      render();
    });
  });
  render();
})();
