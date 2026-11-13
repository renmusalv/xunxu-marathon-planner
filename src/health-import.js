/* Apple Health export review. Browser memory only: no storage, network or implicit profile writes. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.XunxuHealthImport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DAY = 86400000;
  const HALF = 21.0975;
  const LIMITS = Object.freeze({ fileBytes: 256 * 1024 * 1024, xmlBytes: 256 * 1024 * 1024, textCharacters: 64 * 1024 * 1024, tagCharacters: 1024 * 1024, records: 5000000, workouts: 20000, zipEntries: 20000, zipDirectoryBytes: 16 * 1024 * 1024, compressionRatio: 300 });
  const TYPE = 'HKQuantityTypeIdentifier';
  const REST = TYPE + 'RestingHeartRate';
  const VO2 = TYPE + 'VO2Max';
  const HEART = TYPE + 'HeartRate';
  const DISTANCE = TYPE + 'DistanceWalkingRunning';

  function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
  function aborted(signal) { if (signal && signal.aborted) fail('ABORTED', '已取消健康资料读取。'); }
  function round(value, places) { const factor = Math.pow(10, places || 0); return Math.round(value * factor) / factor; }
  function numeric(value, min, max) {
    if (value === undefined || value === null || String(value).trim() === '') return null;
    const result = Number(value);
    return Number.isFinite(result) && result >= min && result <= max ? result : null;
  }
  function dateValue(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const y = Number(match[1]), m = Number(match[2]), d = Number(match[3]);
    if (y < 1900 || y > 2200) return null;
    const time = Date.UTC(y, m - 1, d), check = new Date(time);
    return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d ? time : null;
  }
  function dateString(value) { return new Date(value).toISOString().slice(0, 10); }
  function localToday() { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); }
  function stamp(value) {
    const text = String(value || '').trim();
    const match = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)(?:\s*)(Z|[+-]\d{2}:?\d{2})$/);
    if (!match || dateValue(match[1]) === null) return null;
    const parts = match[2].split(':').map(Number);
    if (parts[0] > 23 || parts[1] > 59 || parts[2] >= 60) return null;
    const offset = match[3].length === 5 ? match[3].slice(0, 3) + ':' + match[3].slice(3) : match[3];
    const time = Date.parse(match[1] + 'T' + match[2] + offset);
    return Number.isFinite(time) ? { date: match[1], time } : null;
  }
  function decodeEntities(value) {
    return value.replace(/&([^;\s]+);/g, (whole, entity) => {
      const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
      if (Object.prototype.hasOwnProperty.call(named, entity)) return named[entity];
      const code = /^#x[\da-f]+$/i.test(entity) ? parseInt(entity.slice(2), 16) : /^#\d+$/.test(entity) ? Number(entity.slice(1)) : NaN;
      if (!Number.isInteger(code) || code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) fail('INVALID_XML', '健康 XML 含有无法识别的实体，请使用健康 App 的原始导出文件。');
      return String.fromCodePoint(code);
    });
  }
  function attributes(text) {
    const result = Object.create(null);
    let position = 0;
    while (position < text.length) {
      const tail = text.slice(position);
      if (/^\s*$/.test(tail)) break;
      const match = tail.match(/^\s+([A-Za-z_][\w:.-]*)\s*=\s*(["'])([\s\S]*?)\2/);
      if (!match || Object.prototype.hasOwnProperty.call(result, match[1])) fail('INVALID_XML', '健康 XML 格式不完整，或包含重复属性。请重新导出。');
      result[match[1]] = decodeEntities(match[3]);
      position += match[0].length;
    }
    return result;
  }
  function distance(value, unit) {
    const v = numeric(value, 0, 1000000);
    if (v === null) return null;
    const factor = ({ km: 1, m: 0.001, mi: 1.609344, mile: 1.609344, miles: 1.609344 })[String(unit || '').toLowerCase()];
    const km = v * factor;
    return Number.isFinite(km) && km > 0 && km <= 500 ? km : null;
  }
  function seconds(value, unit) {
    const v = numeric(value, 0, 10000000), factor = ({ s: 1, sec: 1, min: 60, h: 3600, hr: 3600 })[String(unit || '').toLowerCase()];
    const result = v === null ? NaN : v * factor;
    return Number.isFinite(result) && result > 0 && result <= 259200 ? result : null;
  }
  function bpm(value, unit, min, max) {
    if (!['count/min', 'bpm'].includes(String(unit || '').toLowerCase())) return null;
    return numeric(value, min, max);
  }
  function vo2(value, unit) {
    const normalized = String(unit || '').replace(/\s/g, '').toLowerCase();
    if (!['ml/min·kg', 'ml/min/kg', 'ml/kg/min', 'ml/(kg*min)', 'ml/(kg·min)'].includes(normalized)) return null;
    return numeric(value, 10, 100);
  }
  function sourceName(value) { return String(value || 'Apple 健康').slice(0, 160); }
  function tagEnd(buffer) {
    if (buffer.startsWith('<!--')) { const n = buffer.indexOf('-->'); return n < 0 ? -1 : n + 2; }
    if (buffer.startsWith('<?')) { const n = buffer.indexOf('?>'); return n < 0 ? -1 : n + 1; }
    if (buffer.startsWith('<![CDATA[')) { const n = buffer.indexOf(']]>'); return n < 0 ? -1 : n + 2; }
    const declaration = /^<!DOCTYPE\b/i.test(buffer);
    let quote = null, depth = 0;
    for (let i = 1; i < buffer.length; i++) {
      const char = buffer[i];
      if (quote) { if (char === quote) quote = null; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (declaration && buffer.slice(i, i + 4) === '<!--') { const end = buffer.indexOf('-->', i + 4); if (end < 0) return -1; i = end + 2; continue; }
      if (declaration && char === '[') depth++;
      if (declaration && char === ']') depth--;
      if (char === '>' && depth === 0) return i;
    }
    return -1;
  }

  function createParser(options) {
    options = options || {};
    const today = dateValue(options.now || localToday());
    if (today === null) fail('INVALID_DATE', '分析日期无效。');
    const todayString = dateString(today), start28 = today - 28 * DAY, start30 = today - 29 * DAY;
    const oldestCandidate = today - 365 * DAY;
    const warnings = new Set();
    const workouts = [];
    const personal = { restingHr: null, vo2max: null };
    let buffer = '', rootSeen = false, rootClosed = false, stack = [], workout = null, processed = 0, skippedRuns = 0, earliestRelevant = null, exportDate = null;

    function noteDate(value) { if (value !== null && value <= today && (earliestRelevant === null || value < earliestRelevant)) earliestRelevant = value; }
    function observe(record) {
      if (![REST, VO2].includes(record.type)) return;
      const date = stamp(record.endDate || record.startDate);
      if (!date || date.date > todayString) return;
      noteDate(dateValue(date.date));
      const isRest = record.type === REST;
      const value = isRest ? bpm(record.value, record.unit, 25, 120) : vo2(record.value, record.unit);
      if (value === null) { warnings.add('部分静息心率或 VO₂max 的单位、数值无法确认，已忽略。'); return; }
      const key = isRest ? 'restingHr' : 'vo2max', ageDays = Math.floor((today - dateValue(date.date)) / DAY);
      if (ageDays > 365) return;
      if (!personal[key] || date.time > personal[key]._time) personal[key] = { value: round(value, isRest ? 0 : 1), date: date.date, unit: isRest ? 'bpm' : 'ml/kg/min', source: sourceName(record.sourceName), ageDays, stale: ageDays > (isRest ? 30 : 180), _time: date.time };
    }
    function finishWorkout() {
      if (!workout || workout.type !== 'HKWorkoutActivityTypeRunning') { workout = null; return; }
      const w = workout;
      workout = null;
      const start = stamp(w.startDate), end = stamp(w.endDate);
      if (!start || start.date > todayString || (end && end.date > todayString)) { skippedRuns++; return; }
      const day = dateValue(start.date);
      noteDate(day);
      if (day < oldestCandidate) return;
      const oldDistance = distance(w.totalDistance, w.totalDistanceUnit);
      const newDistance = w.statDistance;
      if (oldDistance !== null && newDistance !== null && Math.abs(oldDistance - newDistance) > Math.max(0.05, oldDistance * 0.02)) { skippedRuns++; warnings.add('部分跑步的距离字段互相冲突，已跳过这些记录。'); return; }
      const km = newDistance !== null ? newDistance : oldDistance;
      if (km === null) { skippedRuns++; return; }
      let elapsed = end && end.time > start.time && end.time - start.time <= 259200000 ? (end.time - start.time) / 1000 : null;
      const active = seconds(w.duration, w.durationUnit);
      if (elapsed !== null && active !== null && active > elapsed + 5) { warnings.add('部分跑步活动时长大于起止时间差，计时需重新核对。'); elapsed = null; }
      let averageHr = w.averageHr, peakHr = w.peakHr;
      if (averageHr !== null && peakHr !== null && averageHr > peakHr) { averageHr = null; peakHr = null; warnings.add('部分跑步的平均心率大于最高心率，未采用这些心率值。'); }
      if (workouts.length >= LIMITS.workouts) fail('TOO_MANY_WORKOUTS', '近一年跑步记录过多，请选取较小的导出范围。');
      workouts.push({ date: start.date, distanceKm: round(km, 4), elapsedSeconds: elapsed === null ? null : round(elapsed), activeSeconds: active === null ? null : round(active), averageHr: averageHr === null ? null : round(averageHr), peakHr: peakHr === null ? null : round(peakHr), sourceName: sourceName(w.sourceName), course: w.indoor ? 'treadmill' : 'unknown', _start: start.time, _end: end ? end.time : null });
    }
    function processTag(tag) {
      if (++processed > LIMITS.records) fail('TOO_MANY_RECORDS', '健康文件记录过多，请先导出较小范围。');
      if (tag.startsWith('<!--') || tag.startsWith('<?')) return;
      if (/^<!DOCTYPE\b/i.test(tag)) {
        if (rootSeen || /<!ENTITY\b|\bSYSTEM\s+["']|\bPUBLIC\s+["']/i.test(tag)) fail('UNSAFE_XML', '不读取含外部引用或自定义实体的 XML，请使用 Apple 健康原始导出。');
        return;
      }
      if (tag.startsWith('<!')) fail('INVALID_XML', '健康 XML 含有不支持的声明，请使用原始 export.xml。');
      if (/^<\//.test(tag)) {
        const close = tag.match(/^<\/([A-Za-z_][\w:.-]*)\s*>$/);
        if (!close || stack.pop() !== close[1]) fail('INVALID_XML', '健康 XML 未完整闭合，请重新导出。');
        if (close[1] === 'Workout') finishWorkout();
        if (close[1] === 'HealthData') rootClosed = true;
        return;
      }
      const match = tag.match(/^<([A-Za-z_][\w:.-]*)([\s\S]*?)\/?\s*>$/);
      if (!match) fail('INVALID_XML', '无法识别健康 XML 格式。');
      const name = match[1], selfClosing = /\/\s*>$/.test(tag), attrText = match[2].replace(/\/\s*$/, '');
      const attrs = attributes(attrText);
      if (rootClosed) fail('INVALID_XML', '健康 XML 含有多个根节点。');
      if (!rootSeen) { if (name !== 'HealthData') fail('UNSUPPORTED_FILE', '请选择 Apple 健康导出的 export.xml 或包含它的 ZIP 文件。'); rootSeen = true; }
      else if (name === 'HealthData') fail('INVALID_XML', '健康 XML 含有重复根节点。');
      if (!selfClosing) { stack.push(name); if (stack.length > 64) fail('INVALID_XML', '健康 XML 嵌套过深。'); }
      if (name === 'Record') observe(attrs);
      else if (name === 'ExportDate') { const parsed = stamp(attrs.value); if (parsed) exportDate = parsed.date; }
      else if (name === 'Workout') {
        if (workout) fail('INVALID_XML', '健康 XML 包含嵌套运动记录。');
        workout = { ...attrs, type: attrs.workoutActivityType, statDistance: null, averageHr: null, peakHr: null, indoor: false };
        if (selfClosing) finishWorkout();
      } else if (name === 'WorkoutStatistics' && workout) {
        if (attrs.type === DISTANCE) workout.statDistance = distance(attrs.sum, attrs.unit);
        if (attrs.type === HEART) { workout.averageHr = bpm(attrs.average, attrs.unit, 30, 240); workout.peakHr = bpm(attrs.maximum, attrs.unit, 30, 250); }
      } else if (name === 'MetadataEntry' && workout && ['HKIndoorWorkout', 'HKMetadataKeyIndoorWorkout'].includes(attrs.key)) workout.indoor = ['1', 'true', 'yes'].includes(String(attrs.value).toLowerCase());
      if (name === 'HealthData' && selfClosing) rootClosed = true;
    }
    function push(chunk) {
      buffer += chunk;
      for (;;) {
        const opening = buffer.indexOf('<');
        if (opening < 0) { if (buffer.trim().replace(/^\uFEFF/, '')) fail('INVALID_XML', '健康 XML 含有无法识别的文本。'); buffer = ''; return; }
        if (buffer.slice(0, opening).trim().replace(/^\uFEFF/, '')) fail('INVALID_XML', '健康 XML 含有无法识别的文本。');
        buffer = buffer.slice(opening);
        const end = tagEnd(buffer);
        if (end < 0) { if (buffer.length > LIMITS.tagCharacters) fail('INVALID_XML', '健康 XML 单条记录过长或未闭合。'); return; }
        if (end + 1 > LIMITS.tagCharacters) fail('INVALID_XML', '健康 XML 单条记录过长。');
        const tag = buffer.slice(0, end + 1);
        buffer = buffer.slice(end + 1);
        processTag(tag);
      }
    }
    function finish() {
      if (buffer.trim() || !rootSeen || !rootClosed || stack.length || workout) fail('INVALID_XML', '健康 XML 不完整，请重新导出并选择完整文件。');
      const deduped = [], sorted = workouts.sort((a, b) => a._start - b._start);
      let duplicates = 0;
      for (const item of sorted) {
        const duplicate = deduped.slice(-20).find(other => Math.abs(other._start - item._start) <= 60000 && other._end !== null && item._end !== null && Math.abs(other._end - item._end) <= 60000 && Math.abs(other.distanceKm - item.distanceKm) <= Math.max(0.1, item.distanceKm * 0.01));
        if (!duplicate) { deduped.push(item); continue; }
        duplicates++;
        const mergedAverage = duplicate.averageHr === null ? item.averageHr : duplicate.averageHr;
        const mergedPeak = duplicate.peakHr === null ? item.peakHr : duplicate.peakHr;
        if (mergedAverage === null || mergedPeak === null || mergedAverage <= mergedPeak) { duplicate.averageHr = mergedAverage; duplicate.peakHr = mergedPeak; }
        else warnings.add('重复记录间心率数据互相冲突，未合并冲突的心率值。');
        if (item.course === 'treadmill') duplicate.course = 'treadmill';
      }
      const recent = deduped.filter(w => dateValue(w.date) >= start28 && w.date < todayString);
      const days = new Set(recent.map(w => w.date));
      const weeks = Array.from({ length: 4 }, (_, index) => {
        const start = start28 + index * 7 * DAY, end = start + 6 * DAY;
        const records = recent.filter(w => dateValue(w.date) >= start && dateValue(w.date) <= end);
        return { start: dateString(start), end: dateString(end), distanceKm: round(records.reduce((total, w) => total + w.distanceKm, 0), 1), workoutCount: records.length, runningDays: new Set(records.map(w => w.date)).size, hasRecords: records.length > 0 };
      });
      const last30 = deduped.filter(w => dateValue(w.date) >= start30 && w.date <= todayString);
      const totalKm = recent.reduce((total, w) => total + w.distanceKm, 0);
      const candidates = deduped.filter(w => Math.abs(w.distanceKm - 10) <= 0.2 || Math.abs(w.distanceKm - HALF) <= 0.45).sort((a, b) => b._start - a._start).slice(0, 40).map(w => ({ date: w.date, distanceKm: w.distanceKm, standardDistanceKm: Math.abs(w.distanceKm - 10) <= 0.2 ? 10 : HALF, elapsedSeconds: w.elapsedSeconds, activeSeconds: w.activeSeconds, averageHr: w.averageHr, peakHr: w.peakHr, sourceName: w.sourceName, course: w.course, source: 'apple_health', effort: 'unknown', durationType: 'unknown', durationBasis: w.elapsedSeconds !== null ? 'start_end' : w.activeSeconds !== null ? 'active_only' : 'unknown', confirmed: false, include: false }));
      if (duplicates) warnings.add('已合并 ' + duplicates + ' 条起止时间及距离相近的重复跑步记录，避免多设备重复计量。');
      if (skippedRuns) warnings.add('有 ' + skippedRuns + ' 条跑步记录缺少可靠日期或距离，未计入汇总。');
      if (!recent.length) warnings.add('最近 28 个完整日没有可用跑步记录；这不代表没有训练，请核对导出范围。');
      if (earliestRelevant === null || earliestRelevant > start28) warnings.add('文件中的可用历史未覆盖整个 28 日窗口；周均值可能低估，请确认记录完整后再应用。');
      if (exportDate && exportDate < dateString(today - DAY)) warnings.add('导出日期早于昨天，最近训练可能尚未包含在文件中。');
      Object.values(personal).filter(Boolean).forEach(value => { if (value.stale) warnings.add((value.unit === 'bpm' ? '静息心率' : 'VO₂max') + '记录较旧，建议更新后再采用。'); delete value._time; });
      return {
        source: 'apple_health', analyzedOn: todayString, exportDate,
        window: { start: dateString(start28), end: dateString(today - DAY), days: 28 },
        summary: { weeklyKm: recent.length ? round(totalKm / 4, 1) : null, runDaysPerWeek: recent.length ? round(days.size / 4, 2) : null, longestRunKm: last30.length ? round(Math.max(...last30.map(w => w.distanceKm)), 1) : null, workoutCount: recent.length, runningDays: days.size, totalKm: round(totalKm, 1), activeWeeks: weeks.filter(w => w.hasRecords).length, coverageDays: earliestRelevant === null ? 0 : Math.min(28, Math.max(0, Math.floor((today - earliestRelevant) / DAY))), weeks },
        coverage: { completeness: 'unverified', earliestRelevantDate: earliestRelevant === null ? null : dateString(earliestRelevant), hasHistoryBeforeWindow: earliestRelevant !== null && earliestRelevant <= start28 },
        personal, candidates, duplicatesRemoved: duplicates, skippedRunningWorkouts: skippedRuns,
        warnings: Array.from(warnings),
        limitations: ['统计仅代表文件中记录的跑步；未记录的日期不等于休息。请确认近 28 日记录完整后应用周跑量。', '日常训练不等于比赛或全力测试。候选成绩的比赛性质、标准距离、完整计时与路线仍需逐条核对。', '活动时长可能扣除暂停；起止时间差只是可核对的完整时间线索，不等于官方比赛成绩。', '本次最高心率不会作为个人最大心率；设备 VO₂max 为估算参考。']
      };
    }
    return { push, finish };
  }

  function parseAppleHealth(xml, options) {
    if (typeof xml !== 'string') fail('UNSUPPORTED_FILE', '请读取 Apple 健康 XML 文本。');
    if (xml.length > LIMITS.textCharacters) fail('FILE_TOO_LARGE', '请使用文件导入读取大型健康 XML。');
    const parser = createParser(options);
    parser.push(xml);
    return parser.finish();
  }

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
    return table;
  })();
  function crcUpdate(crc, bytes) { for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return crc >>> 0; }
  async function zipPayload(file, signal) {
    aborted(signal);
    const tailStart = Math.max(0, file.size - 65557), tail = new Uint8Array(await file.slice(tailStart).arrayBuffer());
    const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === tail.length) { end = i; break; }
    if (end < 0) fail('INVALID_ZIP', 'ZIP 文件不完整，请重新导出或解压后选择 export.xml。');
    const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), offset = view.getUint32(end + 16, true);
    if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0 || view.getUint16(end + 8, true) !== count || count === 0xffff || size === 0xffffffff || offset === 0xffffffff) fail('UNSUPPORTED_ZIP', '暂不读取分卷或 ZIP64；请解压后选择 export.xml。');
    if (count > LIMITS.zipEntries || size > LIMITS.zipDirectoryBytes || offset + size > tailStart + end) fail('INVALID_ZIP', 'ZIP 目录过大或损坏，请解压后选择 export.xml。');
    const central = new Uint8Array(await file.slice(offset, offset + size).arrayBuffer()), directory = new DataView(central.buffer, central.byteOffset, central.byteLength);
    let position = 0, target = null;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (let i = 0; i < count; i++) {
      aborted(signal);
      if (position + 46 > central.length || directory.getUint32(position, true) !== 0x02014b50) fail('INVALID_ZIP', 'ZIP 目录损坏。');
      const nameLength = directory.getUint16(position + 28, true), extraLength = directory.getUint16(position + 30, true), commentLength = directory.getUint16(position + 32, true), next = position + 46 + nameLength + extraLength + commentLength;
      if (next > central.length) fail('INVALID_ZIP', 'ZIP 目录损坏。');
      const name = decoder.decode(central.slice(position + 46, position + 46 + nameLength));
      if (/(^|\/)export\.xml$/i.test(name)) {
        if (target) fail('AMBIGUOUS_ZIP', 'ZIP 含有多个 export.xml，请解压后选择需要的那个文件。');
        if (name.startsWith('/') || name.includes('\\') || name.split('/').some(part => part === '..')) fail('INVALID_ZIP', 'ZIP 中健康文件的路径无效。');
        target = { flags: directory.getUint16(position + 8, true), method: directory.getUint16(position + 10, true), crc: directory.getUint32(position + 16, true), compressed: directory.getUint32(position + 20, true), uncompressed: directory.getUint32(position + 24, true), local: directory.getUint32(position + 42, true), name };
      }
      position = next;
    }
    if (!target) fail('UNSUPPORTED_FILE', 'ZIP 中没有 Apple 健康的 export.xml。请从健康 App 重新导出。');
    if (target.flags & 1) fail('UNSUPPORTED_ZIP', '无法读取加密 ZIP，请先解密并选择 export.xml。');
    if (![0, 8].includes(target.method)) fail('UNSUPPORTED_ZIP', '此 ZIP 压缩方式不受支持，请解压后选择 export.xml。');
    if (!target.uncompressed || target.uncompressed > LIMITS.xmlBytes || !target.compressed || target.uncompressed / target.compressed > LIMITS.compressionRatio) fail('FILE_TOO_LARGE', '健康 XML 超过安全读取范围，请减少导出范围或选择较小文件。');
    if (target.local + 30 > offset) fail('INVALID_ZIP', 'ZIP 文件定位信息损坏。');
    const localBytes = await file.slice(target.local, target.local + 30).arrayBuffer(), local = new DataView(localBytes);
    if (local.getUint32(0, true) !== 0x04034b50 || local.getUint16(6, true) !== target.flags || local.getUint16(8, true) !== target.method) fail('INVALID_ZIP', 'ZIP 文件头不一致。');
    const nameLength = local.getUint16(26, true), start = target.local + 30 + nameLength + local.getUint16(28, true);
    if (start + target.compressed > offset) fail('INVALID_ZIP', 'ZIP 数据不完整。');
    const localName = decoder.decode(await file.slice(target.local + 30, target.local + 30 + nameLength).arrayBuffer());
    if (localName !== target.name) fail('INVALID_ZIP', 'ZIP 文件名不一致。');
    let stream = file.slice(start, start + target.compressed).stream();
    if (target.method === 8) {
      try { stream = stream.pipeThrough(new DecompressionStream('deflate-raw')); }
      catch (_) { fail('ZIP_UNAVAILABLE', '当前浏览器暂不支持直接解压此 ZIP。请在“文件”App 解压，再选择 export.xml。'); }
    } else if (target.compressed !== target.uncompressed) fail('INVALID_ZIP', 'ZIP 文件大小不一致。');
    return { stream, expectedSize: target.uncompressed, expectedCrc: target.crc };
  }

  async function readFile(file, options) {
    options = options || {};
    aborted(options.signal);
    if (!file || typeof file.slice !== 'function' || typeof file.stream !== 'function' || !Number.isFinite(file.size) || file.size <= 0) fail('UNSUPPORTED_FILE', '请选择完整的 Apple 健康 XML 或 ZIP 文件。');
    if (file.size > LIMITS.fileBytes) fail('FILE_TOO_LARGE', '文件超过 256 MB，请减少导出范围或使用较小的 export.xml。');
    let payload;
    try {
      const magic = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      const isZip = magic[0] === 0x50 && magic[1] === 0x4b;
      payload = isZip ? await zipPayload(file, options.signal) : { stream: file.stream(), expectedSize: file.size, expectedCrc: null };
    } catch (error) {
      if (error.code) throw error;
      fail('READ_FAILED', '未能打开健康文件，请重新选择完整的 export.xml 或 ZIP。');
    }
    const parser = createParser(options), reader = payload.stream.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0, crc = 0xffffffff, lastYield = Date.now();
    const cancel = () => { reader.cancel().catch(() => {}); };
    options.signal?.addEventListener('abort', cancel, { once: true });
    try {
      if (typeof options.onProgress === 'function') options.onProgress(0);
      for (;;) {
        aborted(options.signal);
        const result = await reader.read();
        aborted(options.signal);
        if (result.done) break;
        bytes += result.value.byteLength;
        if (bytes > LIMITS.xmlBytes || bytes > payload.expectedSize) fail('FILE_TOO_LARGE', '健康文件解压后超出声明大小或安全范围。');
        crc = crcUpdate(crc, result.value);
        parser.push(decoder.decode(result.value, { stream: true }));
        if (typeof options.onProgress === 'function') options.onProgress(Math.min(0.99, bytes / payload.expectedSize));
        if (Date.now() - lastYield > 16) { await new Promise(resolve => setTimeout(resolve, 0)); lastYield = Date.now(); }
      }
      if (bytes !== payload.expectedSize || (payload.expectedCrc !== null && ((crc ^ 0xffffffff) >>> 0) !== payload.expectedCrc)) fail('INVALID_ZIP', '健康文件校验失败，内容可能损坏，请重新导出。');
      parser.push(decoder.decode());
      const result = parser.finish();
      if (typeof options.onProgress === 'function') options.onProgress(1);
      return result;
    } catch (error) {
      await reader.cancel().catch(() => {});
      if (error.code) throw error;
      fail('READ_FAILED', '未能读取健康文件。请确认文件完整；ZIP 可先解压再选择 export.xml。');
    } finally { options.signal?.removeEventListener('abort', cancel); reader.releaseLock(); }
  }

  return Object.freeze({ parseAppleHealth, readFile, limits: LIMITS });
});
