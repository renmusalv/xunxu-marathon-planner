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
    duration: /(?:净(?:计)?时(?:成绩)?|完赛(?:时间|用时|成绩)|芯片(?:时间|成绩)|总(?:用时|时长|时间)|运动(?:用时|时间|时长)|持续时间|耗时|用时|duration|elapsed\s*time|moving\s*time|chip\s*time|net\s*time|finish(?:ing)?\s*time)/i,
    pace: /(?:平均配速|平均速度|配速|avg\.?\s*pace|average\s*pace|pace)/i,
    averageHr: /(?:平均心率|平均脉搏|avg\.?\s*(?:heart\s*rate|hr)|average\s*(?:heart\s*rate|hr))/i,
    peakHr: /(?:最高心率|最大心率|max(?:imum)?\.?\s*(?:heart\s*rate|hr)|peak\s*(?:heart\s*rate|hr))/i
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
  function parse(text) {
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
    const durationValues = labelValues(lines, labels.duration, preferAbove);
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
    fields.paceSeconds = firstValid(labelValues(lines, labels.pace, preferAbove), parsePace);
    if (fields.paceSeconds === null) {
      const p = normalized.match(/(?:^|[^\d:])(\d{1,2}\s*[:']\s*[0-5]\d\s*(?:"|'')?)\s*(?:min\s*\/\s*km|\/?\s*(?:公里|千米)|\/\s*km)/i);
      if (p) fields.paceSeconds = parsePace(p[1]);
    }
    const extractHr = s => { const m = s.match(/(?:^|\D)(\d{2,3})(?!\d|[.:])/); const n = m ? +m[1] : null; return n >= 30 && n <= 240 ? n : null; };
    fields.averageHr = firstValid(labelValues(lines, labels.averageHr, preferAbove), extractHr);
    fields.peakHr = firstValid(labelValues(lines, labels.peakHr, preferAbove), extractHr);
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
    return {fields, rawText, warnings: [...new Set(warnings)]};
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
      const {data} = await worker.recognize(canvas, {}, {text: true});
      checkAbort(signal);
      const result = parse(data.text), confidence = Number.isFinite(data.confidence) ? data.confidence : null;
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
