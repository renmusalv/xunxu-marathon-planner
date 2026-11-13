/* Screenshot OCR runs in this browser. No image is sent to an OCR service. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RaceOCR = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const MAX_FILE_BYTES = 12 * 1024 * 1024;
  const ASSET_ROOT = typeof document !== 'undefined' ? new URL('./vendor/ocr', document.baseURI).href.replace(/\/$/, '') : '/planner/vendor/ocr';
  const labels = {
    distance: /(?:总距离|总里程|跑步距离|运动距离|距离|里程|distance)/i,
    duration: /(?:净(?:计)?时(?:成绩)?|完赛(?:时间|用时|成绩)|芯片(?:时间|成绩)|总(?:用时|时长|时间)|移动(?:用时|时间|时长)|运动(?:用时|时间|时长)|持续时间|耗时|用时|duration|elapsed\s*time|moving\s*time|chip\s*time|net\s*time|finish(?:ing)?\s*time|total\s*time)/i,
    pace: /(?:平均配速|平均速度|配速|avg\.?\s*pace|average\s*pace|pace)/i,
    averageHr: /(?:平均心率|平均脉搏|(?:avg\.?|average|mean)\s*(?:heart[\s-]*rate|h\.?r\.?|pulse)|(?:heart[\s-]*rate|h\.?r\.?)\s*\(?\s*(?:avg\.?|average|mean)\b)/i,
    peakHr: /(?:最高心率|最大心率|(?:max(?:imum)?\.?|peak)\s*(?:heart[\s-]*rate|h\.?r\.?|pulse)|(?:heart[\s-]*rate|h\.?r\.?)\s*\(?\s*(?:max(?:imum)?\.?|peak)\b)/i
  };
  function normalize(text) {
    let s = String(text || '').normalize('NFKC').replace(/[：﹕]/g, ':').replace(/[′’‘]/g, "'").replace(/[″“”]/g, '"').replace(/\r/g, '\n');
    for (let n = 0; n < 3; n++) s = s.replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, '$1');
    return s.replace(/[\t ]+/g, ' ');
  }
  function validDate(y, m, d) {
    if (y < 2000 || y > 2100) return null;
    const x = new Date(Date.UTC(y, m - 1, d));
    return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
  }
  function labelValues(lines, pattern, preferAbove = false) {
    const values = [];
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(pattern);
      if (!match) continue;
      const after = lines[i].slice(match.index + match[0].length).replace(/^\s*[:=：]\s*/, '');
      values.push({text: after, adjacent: false});
      if (!after.trim()) {
        const before = i > 0 && !Object.values(labels).some(re => re.test(lines[i - 1])) ? {text: lines[i - 1], adjacent: true} : null;
        const afterLine = i + 1 < lines.length ? {text: lines[i + 1], adjacent: true} : null;
        values.push(...(preferAbove ? [before, afterLine] : [afterLine, before]).filter(Boolean));
      }
    }
    return values;
  }
  function firstValid(values, extract) {
    for (const v of values) { const n = extract(v.text); if (n !== null) return n; }
    return null;
  }
  function parseHms(s) {
    let m = s.match(/(?:^|[^\d:])(\d{1,2})\s*:\s*([0-5]\d)\s*:\s*([0-5]\d)(?![\d:])/);
    if (m) { const v = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]); return v > 0 && v <= 43200 ? v : null; }
    m = s.match(/(?:(\d{1,2})\s*(?:小时|时|h)\s*)?(\d{1,3})\s*(?:分钟|分|min)\s*(?:(\d{1,2})\s*(?:秒|s))?/i);
    if (m && (m[1] || m[3])) { const v = Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0); return v > 0 && v <= 43200 ? v : null; }
    return null;
  }
  function parsePace(s) {
    const m = s.match(/(?:^|[^\d:])(\d{1,2})\s*[:']\s*([0-5]\d)\s*(?:"|''|\/?\s*(?:km|公里|千米))?(?![\d:])/i);
    if (!m) return null;
    const v = Number(m[1]) * 60 + Number(m[2]);
    return v >= 120 && v <= 1200 ? v : null;
  }
  function durationCandidates(text) {
    const values = [];
    for (const match of text.matchAll(/(?:^|[^\d:])(\d{1,2}\s*:\s*[0-5]\d\s*:\s*[0-5]\d)(?![\d:])/g)) {
      const value = parseHms(match[1]); if (value !== null) values.push(value);
    }
    for (const match of text.matchAll(/(?:^|[^\d:])(\d{2,3})\s*:\s*([0-5]\d)(?![\d:])/g)) {
      const minutes = Number(match[1]); if (minutes >= 10) values.push(minutes * 60 + Number(match[2]));
    }
    if (!values.length) { const value = parseHms(text); if (value !== null) values.push(value); }
    return values;
  }
  function durationKind(label) {
    if (/^(?:moving\s*time|移动(?:用时|时间|时长))$/i.test(label)) return 'moving';
    if (/^(?:elapsed\s*time|total\s*time|chip\s*time|net\s*time|finish(?:ing)?\s*time|净(?:计)?时(?:成绩)?|完赛(?:时间|用时|成绩)|芯片(?:时间|成绩)|总(?:用时|时长|时间))$/i.test(label)) return 'elapsed';
    return 'unknown';
  }
  const HR_UNIT = /(?:bpm|beats?\s*(?:\/|per\s*)min(?:ute)?|b\/min|次\s*\/\s*分(?:钟)?)/gi;
  const HR_HEADER = /^(?:heart[\s-]*rate|h\.?r\.?|心率)(?:\s*\(?\s*bpm\s*\)?)?$/i;
  const HR_QUALIFIER = /\b(avg\.?|average|mean|max(?:imum)?\.?|peak)\b/gi;
  const OTHER_METRIC = /(?:cadence|stride|pace|speed|power|calories|energy|elevation|altitude|temperature|steps|zones?|resting|recovery|心率区间|步频|配速|卡路里|功率|海拔|静息|恢复心率)/i;
  function heartKind(value) { return /^(?:avg\.?|average|mean)$/i.test(value) ? 'averageHr' : 'peakHr'; }
  // Only accept bare heart-rate values or explicit bpm units. Times, percentages,
  // ranges and cadence values are deliberately not valid heart-rate candidates.
  function heartValues(text) {
    let value = normalize(text).trim();
    if (!value || /%|\d\s*[:/]\s*\d|\d\s*[-–—]\s*\d|\d[.,]\d|(?:spm|rpm|km|kcal|watts?|seconds?)\b/i.test(value)) return [];
    value = value.replace(/(\d)\s+(\d)\s+(\d)(?=\s*bpm\b)/gi, '$1$2$3').replace(HR_UNIT, ' ');
    value = value.replace(/[()\[\]{}:;,|=·•♥♡❤]/g, ' ').trim();
    if (!/^(?:\d{2,3}\s*)+$/.test(value)) return [];
    const values = value.match(/\d{2,3}/g).map(Number);
    return values.every(n => n >= 30 && n <= 240) ? values : [];
  }
  function logicalHeartLines(text) {
    return normalize(text)
      .replace(/\bheart\s*[-\n]\s*rate\b/gi, 'Heart Rate')
      .replace(/\b(avg\.?|average|mean|max(?:imum)?\.?|peak)\s*\n\s*(heart\s*rate|h\.?r\.?)\b/gi, '$1 $2')
      .replace(/(\d)\s*\n\s*(bpm)\b/gi, '$1 $2')
      .split('\n').map(s => s.trim()).filter(Boolean);
  }
  function explicitHeartLabels(line) {
    const matches = [];
    for (const kind of ['averageHr', 'peakHr']) {
      for (const match of line.matchAll(new RegExp(labels[kind].source, 'gi'))) matches.push({kind, start: match.index, end: match.index + match[0].length});
    }
    return matches.sort((a, b) => a.start - b.start);
  }
  function heartText(text, preferAbove) {
    const lines = logicalHeartLines(text), candidates = {averageHr: [], peakHr: []}, seen = new Set();
    const firstLabel = lines.findIndex(line => explicitHeartLabels(line).length);
    const textDirection = preferAbove || (firstLabel === 1 && heartValues(lines[0]).length === 1) ? 'above' : firstLabel === 0 ? 'below' : null;
    const add = (kind, values) => { seen.add(kind); if (values.length === 1) candidates[kind].push(values[0]); };
    function adjacent(index, count, direction) {
      const before = heartValues(lines[index - 1] || ''), after = heartValues(lines[index + 1] || '');
      if (direction === 'above' && before.length === count) return before;
      if (direction === 'below' && after.length === count) return after;
      if (before.length === count && after.length !== count) return before;
      if (after.length === count && before.length !== count) return after;
      if (before.length === count && before.every((n, i) => n === after[i])) return before;
      return [];
    }
    let section = false, sectionDirection = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (HR_HEADER.test(line)) { section = true; sectionDirection = heartValues(lines[i + 1] || '').length ? 'above' : 'below'; continue; }
      if (OTHER_METRIC.test(line) && !explicitHeartLabels(line).length) { section = false; sectionDirection = null; }
      let matches = explicitHeartLabels(line);
      if (!matches.length && section && !OTHER_METRIC.test(line)) {
        matches = [...line.matchAll(HR_QUALIFIER)].map(m => ({kind: heartKind(m[1]), start: m.index, end: m.index + m[0].length}));
      }
      if (!matches.length) continue;
      matches.forEach(m => seen.add(m.kind));
      const direction = sectionDirection || textDirection;
      const rowValues = adjacent(i, matches.length, direction);
      matches.forEach((match, n) => {
        const tail = line.slice(match.end, matches[n + 1]?.start ?? line.length);
        const front = line.slice(n ? matches[n - 1].end : 0, match.start);
        const after = heartValues(tail), before = heartValues(front);
        if (after.length === 1) add(match.kind, after);
        else if (n === 0 && before.length === 1) add(match.kind, before);
        else if (rowValues.length === matches.length) add(match.kind, [rowValues[n]]);
      });
    }
    const fields = {}, unresolved = [];
    for (const kind of ['averageHr', 'peakHr']) {
      const unique = [...new Set(candidates[kind])];
      fields[kind] = unique.length === 1 ? unique[0] : null;
      if (seen.has(kind) && unique.length !== 1) unresolved.push(kind);
    }
    return {fields, unresolved};
  }

  function bboxOf(items) {
    return {x0: Math.min(...items.map(x => x.bbox.x0)), y0: Math.min(...items.map(x => x.bbox.y0)), x1: Math.max(...items.map(x => x.bbox.x1)), y1: Math.max(...items.map(x => x.bbox.y1))};
  }
  function validBox(box) { return box && ['x0', 'y0', 'x1', 'y1'].every(k => Number.isFinite(box[k])) && box.x1 > box.x0 && box.y1 > box.y0; }
  function midX(box) { return (box.x0 + box.x1) / 2; }
  function midY(box) { return (box.y0 + box.y1) / 2; }
  function overlapX(a, b) { return Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)); }
  function wordsFromLayout(data) {
    if (!data) return [];
    const words = Array.isArray(data.words) ? data.words : (data.blocks || []).flatMap(block => (block.paragraphs || []).flatMap(p => (p.lines || []).flatMap(line => line.words || [])));
    return words.filter(w => w && validBox(w.bbox) && String(w.text || '').trim()).map(w => ({text: normalize(w.text).trim(), bbox: w.bbox, confidence: Number.isFinite(w.confidence) ? w.confidence : 100}));
  }
  function layoutRows(words) {
    const rows = [];
    for (const word of words.slice().sort((a, b) => midY(a.bbox) - midY(b.bbox) || a.bbox.x0 - b.bbox.x0)) {
      const h = word.bbox.y1 - word.bbox.y0;
      const row = rows.find(r => Math.abs(midY(r.bbox) - midY(word.bbox)) < Math.max(h, r.bbox.y1 - r.bbox.y0) * .45);
      if (row) { row.words.push(word); row.bbox = bboxOf(row.words); }
      else rows.push({words: [word], bbox: word.bbox});
    }
    return rows.map(row => {
      row.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
      let text = '';
      row.spans = row.words.map(word => { const start = text.length; text += word.text + ' '; return {...word, start, end: text.length - 1}; });
      row.text = text.trim(); return row;
    });
  }
  function boxForSpan(row, start, end) { return bboxOf(row.spans.filter(w => w.end > start && w.start < end)); }
  function heartLayout(data) {
    const words = wordsFromLayout(data), rows = layoutRows(words), anchors = [], sections = [];
    if (!words.length) return {fields: {}, unresolved: []};
    // Labels are located on the page before numbers are paired with them. Sparse
    // OCR often returns the left label, right label, then both values as blocks.
    for (const row of rows) {
      for (const match of explicitHeartLabels(row.text)) anchors.push({kind: match.kind, bbox: boxForSpan(row, match.start, match.end), explicit: true});
      for (const match of row.text.matchAll(/\bheart[\s-]*rate\b|\bhr\b|心率/gi)) {
        const bbox = boxForSpan(row, match.index, match.index + match[0].length);
        if (!explicitHeartLabels(row.text).some(m => m.start <= match.index && m.end >= match.index)) sections.push({bbox, row});
      }
    }
    // A qualifier can wrap above/below "Heart Rate", or sit in a card under a
    // shared Heart Rate heading. Other metric headings stop that association.
    for (const row of rows) {
      for (const match of row.text.matchAll(HR_QUALIFIER)) {
        const box = boxForSpan(row, match.index, match.index + match[0].length), kind = heartKind(match[1]);
        if (anchors.some(a => a.kind === kind && overlapX(a.bbox, box) && Math.abs(midY(a.bbox) - midY(box)) < 4)) continue;
        const h = box.y1 - box.y0;
        const section = sections.filter(s => {
          const dy = midY(box) - midY(s.bbox), nearWrap = Math.abs(dy) < 2.8 * h && overlapX(box, s.bbox) > 0;
          const belowHeading = dy > 0 && dy < 10 * h;
          if (!nearWrap && !belowHeading) return false;
          return !rows.some(r => OTHER_METRIC.test(r.text) && midY(r.bbox) > Math.min(midY(s.bbox), midY(box)) && midY(r.bbox) <= Math.max(midY(s.bbox), midY(box)) && (overlapX(r.bbox, box) > 0));
        }).sort((a, b) => Math.abs(midY(box) - midY(a.bbox)) - Math.abs(midY(box) - midY(b.bbox)))[0];
        if (section) anchors.push({kind, bbox: box, explicit: false});
      }
    }
    const values = [];
    for (const row of rows) {
      row.words.forEach((word, index) => {
        const found = heartValues(word.text);
        if (found.length !== 1 || word.confidence < 45) return;
        const previous = row.words[index - 1], next = row.words[index + 1], h = word.bbox.y1 - word.bbox.y0;
        const closeNext = next && next.bbox.x0 - word.bbox.x1 < h * 2 ? next : null;
        const closePrevious = previous && word.bbox.x0 - previous.bbox.x1 < h * 1.2 ? previous : null;
        if (closeNext && /^(?:%|(?:spm|rpm|km|kcal|w|watts?|secs?|seconds?)\b)/i.test(closeNext.text)) return;
        if ((closeNext && /^[-–—/:]$/.test(closeNext.text)) || (closePrevious && /^[-–—/:]$/.test(closePrevious.text))) return;
        if (OTHER_METRIC.test(row.text) && !explicitHeartLabels(row.text).length) return;
        const unit = /bpm|beats|次\/分/i.test(word.text) || !!(closeNext && /^(?:bpm|beats|次\/分)/i.test(closeNext.text));
        values.push({value: found[0], bbox: word.bbox, unit});
      });
    }
    const proposals = [];
    for (const anchor of anchors) {
      const scored = values.map((value, index) => {
        const h = Math.max(anchor.bbox.y1 - anchor.bbox.y0, value.bbox.y1 - value.bbox.y0), dx = Math.abs(midX(anchor.bbox) - midX(value.bbox)), dy = Math.abs(midY(anchor.bbox) - midY(value.bbox));
        const sameRow = dy < h * .55, horizontalGap = Math.max(0, value.bbox.x0 - anchor.bbox.x1, anchor.bbox.x0 - value.bbox.x1);
        const aligned = overlapX(anchor.bbox, value.bbox) > 0 || dx < 1.8 * h;
        if (sameRow ? horizontalGap > 7 * h : (!aligned || dy > 6 * h)) return null;
        // Do not reach across another Average/Maximum card to claim its value.
        if (anchors.some(other => other !== anchor && other.kind !== anchor.kind && Math.abs(midY(other.bbox) - midY(anchor.bbox)) < h && Math.abs(midX(other.bbox) - midX(value.bbox)) + h * .4 < dx)) return null;
        const score = sameRow ? horizontalGap / h + .1 : dy / h + dx / h * .35;
        return {index, value: value.value, score: score - (value.unit ? .45 : 0)};
      }).filter(Boolean).sort((a, b) => a.score - b.score);
      const best = scored[0];
      if (best && (!scored[1] || scored[1].value === best.value || scored[1].score - best.score > .55)) proposals.push({...best, kind: anchor.kind});
    }
    const fields = {}, unresolved = [];
    for (const kind of ['averageHr', 'peakHr']) {
      const matches = proposals.filter(p => p.kind === kind && !proposals.some(other => other.kind !== kind && other.index === p.index));
      const unique = [...new Set(matches.map(p => p.value))];
      if (unique.length === 1) fields[kind] = unique[0];
      else if (anchors.some(a => a.kind === kind)) unresolved.push(kind);
    }
    return {fields, unresolved};
  }
  function parse(text, layoutData) {
    const rawText = String(text || ''), normalized = normalize(rawText), lines = normalized.split('\n').map(s => s.trim()).filter(Boolean), warnings = [];
    const fields = {distanceKm: null, elapsedSeconds: null, date: null, averageHr: null, peakHr: null, paceSeconds: null};
    // Infer a shared value-above-label layout from the unambiguous distance card.
    const distanceLabelIndex = lines.findIndex(l => labels.distance.test(l));
    const preferAbove = distanceLabelIndex > 0 && /^\d+(?:[.,]\d+)?\s*(?:km|公里|千米)$/i.test(lines[distanceLabelIndex - 1]);
    const distanceValue = s => { const m = s.match(/(?:^|[^\d.])(\d{1,3}(?:[.,]\d{1,4})?)\s*(?:km|公里|千米|k\b)?/i); if (!m) return null; const n = Number(m[1].replace(',', '.')); return n > 0 && n <= 100 ? n : null; };
    fields.distanceKm = firstValid(labelValues(lines, labels.distance, preferAbove), distanceValue);
    if (fields.distanceKm === null) {
      const distances = [...normalized.matchAll(/(?:^|[^\d.])(\d{1,3}(?:[.,]\d{1,4})?)\s*(?:km|公里|千米)(?![a-z])/gi)].map(m => Number(m[1].replace(',', '.'))).filter(n => n >= 5 && n <= 50);
      const unique = [...new Set(distances)];
      if (unique.length === 1) fields.distanceKm = unique[0];
      else if (unique.length > 1) warnings.push('图片包含多个距离，请核对本次总距离。');
      if (fields.distanceKm === null && /半程马拉松|半马|half\s*marathon/i.test(normalized)) fields.distanceKm = 21.0975;
      if (fields.distanceKm === null && /(?:^|\s)10\s*[kK](?:\s|$)/.test(normalized)) fields.distanceKm = 10;
    }
    const dated = [...normalized.matchAll(/(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/g)].map(m => validDate(+m[1], +m[2], +m[3])).filter(Boolean);
    if (new Set(dated).size === 1) fields.date = dated[0];
    else if (dated.length > 1) warnings.push('检测到多个日期，请确认比赛或测试日期。');
    else if (/\d{1,2}\s*月\s*\d{1,2}\s*日/.test(normalized)) warnings.push('截图日期缺少年份，请手动补全，系统不会猜测年份。');
    const durationValues = labelValues(lines, labels.duration, preferAbove).filter(v => !/开始时间|结束时间|start\s*time|end\s*time/i.test(v.text));
    fields.elapsedSeconds = firstValid(durationValues, parseHms);
    if (fields.elapsedSeconds === null) {
      for (const {text: s} of durationValues) {
        const m = s.match(/(?:^|[^\d:])(\d{1,3})\s*:\s*([0-5]\d)(?![\d:])/);
        if (m && Number(m[1]) >= 10) { fields.elapsedSeconds = Number(m[1]) * 60 + Number(m[2]); break; }
        if (m) warnings.push('用时只有两段数字，可能是时:分或分:秒，请按 HH:MM:SS 核对。');
      }
    }
    if (fields.elapsedSeconds === null) {
      const candidates = lines.filter(l => !labels.pace.test(l) && !/开始时间|结束时间|start\s*time|end\s*time|20\d{2}[-/.年]/i.test(l)).map(parseHms).filter(n => n !== null && n >= 600);
      if (new Set(candidates).size === 1) { fields.elapsedSeconds = candidates[0]; warnings.push('用时由三段时间格式识别，请确认它是完赛用时。'); }
      else if (candidates.length > 1) warnings.push('检测到多个用时，请优先填写净计时或有效测试用时。');
    }
    const distinctDurations = [...new Set(durationValues.flatMap(v => durationCandidates(v.text)))];
    if (distinctDurations.length > 1) {
      fields.elapsedSeconds = null;
      warnings.push('检测到多个不同用时，尚未自动选择；请核对完整计时或移动用时。');
    }
    const durationKinds = new Set([...normalized.matchAll(new RegExp(labels.duration.source, 'gi'))].map(m => durationKind(m[0])));
    const durationType = fields.elapsedSeconds !== null && durationKinds.size === 1 ? [...durationKinds][0] : 'unknown';
    fields.paceSeconds = firstValid(labelValues(lines, labels.pace, preferAbove), parsePace);
    if (fields.paceSeconds === null) {
      const p = normalized.match(/(?:^|[^\d:])(\d{1,2}\s*[:']\s*[0-5]\d\s*(?:"|'')?)\s*(?:min\s*\/\s*km|\/?\s*(?:公里|千米)|\/\s*km)/i);
      if (p) fields.paceSeconds = parsePace(p[1]);
    }
    const textHearts = heartText(normalized, preferAbove), layoutHearts = heartLayout(layoutData), fieldSources = {};
    for (const kind of ['averageHr', 'peakHr']) {
      if (layoutHearts.fields[kind] !== undefined) { fields[kind] = layoutHearts.fields[kind]; fieldSources[kind] = 'layout'; }
      else if (!layoutHearts.unresolved.includes(kind)) { fields[kind] = textHearts.fields[kind]; if (fields[kind] !== null) fieldSources[kind] = 'text'; }
      if (fields[kind] === null && (textHearts.unresolved.includes(kind) || layoutHearts.unresolved.includes(kind))) warnings.push((kind === 'averageHr' ? '平均心率' : '本次最高心率') + '标签已找到，但数字位置或内容不够清楚，请核对截图后补充。');
    }
    if (fields.averageHr && fields.peakHr && fields.averageHr > fields.peakHr) { warnings.push('平均心率高于本次最高心率，识别结果需核对。'); }
    if (fields.distanceKm && fields.elapsedSeconds && fields.paceSeconds) {
      const calculated = fields.elapsedSeconds / fields.distanceKm;
      if (Math.abs(calculated - fields.paceSeconds) > Math.max(8, calculated * .05)) warnings.push('距离、用时与截图配速不一致，请确认是否为移动用时或总用时。');
    }
    if (fields.distanceKm && fields.elapsedSeconds) {
      const pace = fields.elapsedSeconds / fields.distanceKm;
      if (pace < 120 || pace > 1200) { warnings.push('距离与用时组合异常，请重新核对；不会据此直接生成计划。'); }
    }
    if (fields.peakHr) warnings.push('本次最高心率仅作为此次运动记录，不会自动填入个人最大心率。');
    const count = Object.values(fields).filter(v => v !== null).length;
    if (!count) warnings.push('没有识别到可靠字段，可参考截图手动填写。');
    return {fields, rawText, warnings: [...new Set(warnings)], fieldSources, durationType};
  }

  function abortError() { return new DOMException('已取消截图识别。', 'AbortError'); }
  function checkAbort(signal) { if (signal && signal.aborted) throw abortError(); }
  async function validateFile(file) {
    if (!file || typeof file.arrayBuffer !== 'function') throw new Error('请选择一张 PNG、JPEG 或 WebP 成绩截图。');
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) throw new Error('图片需大于 0 且不超过 12 MB。');
    const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const png = b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71 && b[4] === 13 && b[5] === 10;
    const jpeg = b[0] === 255 && b[1] === 216 && b[2] === 255;
    const webp = String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP';
    if (!png && !jpeg && !webp) throw new Error('请使用 PNG、JPEG 或 WebP 图片；HEIC、PDF 和改名文件不支持。');
    return true;
  }
  async function decodeImage(file, signal) {
    checkAbort(signal);
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const img = new Image();
        const cancel = () => { img.src = ''; reject(abortError()); };
        if (signal) signal.addEventListener('abort', cancel, {once: true});
        img.onload = () => { if (signal) signal.removeEventListener('abort', cancel); resolve(img); };
        img.onerror = () => { if (signal) signal.removeEventListener('abort', cancel); reject(new Error('图片无法解码，请重新导出截图后再试。')); };
        img.src = url;
      });
      checkAbort(signal);
      if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth * img.naturalHeight > 40000000) throw new Error('图片尺寸过大或无效，请先裁剪为成绩区域。');
      return img;
    } finally { URL.revokeObjectURL(url); }
  }
  async function prepareImage(file, signal) {
    await validateFile(file); checkAbort(signal);
    const img = await decodeImage(file, signal), longest = Math.max(img.naturalWidth, img.naturalHeight);
    const scale = Math.min(2, 2600 / longest);
    const canvas = document.createElement('canvas'); canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d', {willReadFrequently: true});
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const previewCanvas = document.createElement('canvas'), previewScale = Math.min(1, 1600 / longest);
    previewCanvas.width = Math.round(img.naturalWidth * previewScale); previewCanvas.height = Math.round(img.naturalHeight * previewScale);
    const previewCtx = previewCanvas.getContext('2d'); previewCtx.fillStyle = '#fff'; previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height); previewCtx.drawImage(img, 0, 0, previewCanvas.width, previewCanvas.height);
    const previewBlob = await new Promise(resolve => previewCanvas.toBlob(resolve, 'image/jpeg', .88));
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height), a = pixels.data;
    let dark = 0, samples = 0;
    for (let i = 0; i < a.length; i += 80) { if ((a[i] * .299 + a[i + 1] * .587 + a[i + 2] * .114) < 90) dark++; samples++; }
    const invert = dark / samples > .6;
    for (let i = 0; i < a.length; i += 4) { let v = a[i] * .299 + a[i + 1] * .587 + a[i + 2] * .114; if (invert) v = 255 - v; v = Math.max(0, Math.min(255, (v - 128) * 1.15 + 128)); a[i] = a[i + 1] = a[i + 2] = v; }
    ctx.putImageData(pixels, 0, 0); checkAbort(signal);
    return {canvas, previewBlob};
  }
  let scriptLoading;
  function loadEngine() {
    if (typeof window !== 'undefined' && window.Tesseract) return Promise.resolve(window.Tesseract);
    if (!scriptLoading) scriptLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = `${ASSET_ROOT}/tesseract.min.js`; script.async = true;
      const timer = setTimeout(() => { script.remove(); scriptLoading = null; reject(new Error('识别组件加载超时，请重试或手动录入。')); }, 25000);
      script.onload = () => { clearTimeout(timer); if (window.Tesseract) resolve(window.Tesseract); else { scriptLoading = null; reject(new Error('识别组件不可用，请重试或手动录入。')); } };
      script.onerror = () => { clearTimeout(timer); scriptLoading = null; script.remove(); reject(new Error('无法加载识别组件，请检查连接或手动录入。')); };
      document.head.appendChild(script);
    });
    return scriptLoading;
  }
  function waitWithAbort(promise, signal) {
    if (!signal) return promise;
    checkAbort(signal);
    return new Promise((resolve, reject) => {
      const abort = () => reject(abortError());
      signal.addEventListener('abort', abort, {once: true});
      promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
    });
  }
  async function recognize(file, {onProgress, signal} = {}) {
    checkAbort(signal);
    const progress = (value, status) => { if (typeof onProgress === 'function' && !(signal && signal.aborted)) onProgress({progress: Math.max(0, Math.min(1, value)), status}); };
    progress(.01, '正在检查图片');
    const {canvas, previewBlob} = await prepareImage(file, signal);
    progress(.08, '正在加载中英文识别组件');
    const Tesseract = await waitWithAbort(loadEngine(), signal); checkAbort(signal);
    let worker, timer, abortHandler, stopRequested = false;
    const stopped = new Promise((_, reject) => {
      abortHandler = () => { stopRequested = true; if (worker) worker.terminate().catch(() => {}); reject(abortError()); };
      if (signal) signal.addEventListener('abort', abortHandler, {once: true});
      timer = setTimeout(() => { stopRequested = true; if (worker) worker.terminate().catch(() => {}); reject(new Error('识别时间较长，请裁剪成绩区域后重试，也可直接手动录入。')); }, 100000);
    });
    const job = (async () => {
      worker = await Tesseract.createWorker(['eng', 'chi_sim'], 1, {
        workerPath: `${ASSET_ROOT}/worker.min.js`, corePath: `${ASSET_ROOT}/core`, langPath: `${ASSET_ROOT}/lang`,
        gzip: true, workerBlobURL: false, cacheMethod: 'none',
        logger: m => { const isText = m.status === 'recognizing text'; progress(isText ? .35 + (m.progress || 0) * .6 : .1 + (m.progress || 0) * .2, isText ? '正在读取成绩和心率' : '正在加载中英文模型'); },
        errorHandler: () => {}
      });
      if (stopRequested || (signal && signal.aborted)) { await worker.terminate(); throw abortError(); }
      await worker.setParameters({tessedit_pageseg_mode: '11', preserve_interword_spaces: '1', user_defined_dpi: '180'});
      const {data} = await worker.recognize(canvas, {}, {text: true, blocks: true});
      checkAbort(signal);
      const result = parse(data.text, data), confidence = Number.isFinite(data.confidence) ? data.confidence : null;
      if (confidence !== null && confidence < 65) result.warnings.unshift('截图识别把握较低，请逐项核对后保存。');
      progress(1, '识别完成，请核对数据');
      return {...result, confidence, previewBlob};
    })();
    try { return await Promise.race([job, stopped]); }
    catch (error) { if (error && error.name === 'AbortError') throw error; throw new Error((error && error.message) || '截图识别失败，请重试或手动填写。'); }
    finally { clearTimeout(timer); if (signal && abortHandler) signal.removeEventListener('abort', abortHandler); if (worker) await worker.terminate().catch(() => {}); canvas.width = 1; canvas.height = 1; }
  }
  return {recognize, parse, validateFile, prepareImage, MAX_FILE_BYTES};
});
