const test = require('node:test');
const assert = require('node:assert/strict');
const {parse, validateFile} = require('../src/ocr.js');

test('Chinese half marathon screenshot, explicit values', () => {
  const r=parse('半程马拉松\n2026年10月18日\n距离 21.0975 公里\n净计时 01:45:30\n平均配速 5′00″ /公里\n平均心率 156 bpm\n最高心率 178 bpm');
  assert.deepEqual(r.fields,{distanceKm:21.0975,elapsedSeconds:6330,date:'2026-10-18',averageHr:156,peakHr:178,paceSeconds:300});
});
test('English 10km workout with values above labels', () => {
  const r=parse('2026-10-05\n10.00 km\nDistance\n00:49:30\nElapsed time\n4:57 /km\nAverage pace\n151 bpm\nAverage heart rate\n169 bpm\nMax heart rate');
  assert.deepEqual(r.fields,{distanceKm:10,elapsedSeconds:2970,date:'2026-10-05',averageHr:151,peakHr:169,paceSeconds:297});
});
test('does not turn pace into elapsed duration', () => {
  const r=parse('10.00 公里\n平均配速 5:25/km\n平均心率 145');
  assert.equal(r.fields.elapsedSeconds,null); assert.equal(r.fields.paceSeconds,325); assert.equal(r.fields.peakHr,null);
});
test('ambiguous short time and absent year require manual confirmation', () => {
  const r=parse('半马\n10月9日\n用时 1:45\n配速 4:58');
  assert.equal(r.fields.elapsedSeconds,null); assert.equal(r.fields.date,null);
  assert.ok(r.warnings.some(x=>x.includes('HH:MM:SS'))); assert.ok(r.warnings.some(x=>x.includes('年份')));
});
test('two-part minutes over ten can be a labeled elapsed time', () => { assert.equal(parse('距离10km\n用时49:30').fields.elapsedSeconds,2970); });
test('never guesses missing fields or reverses heart-rate labels', () => {
  const r=parse('最高心率 181 bpm'); assert.equal(r.fields.averageHr,null); assert.equal(r.fields.peakHr,181); assert.equal(r.fields.distanceKm,null); assert.equal(r.fields.date,null);
});
test('clock start time is not a finish result', () => { assert.equal(parse('开始时间 10:15:00\n距离 10 km\n配速5:00/km').fields.elapsedSeconds,null); });
test('invalid dates and multiple distances remain unresolved', () => {
  const r=parse('2026-02-30\n1km 4:30\n5km 24:20\n10km 49:00'); assert.equal(r.fields.date,null); assert.equal(r.fields.distanceKm,null);
});
test('flags contradictory readings without silently changing them', () => {
  const r=parse('距离 10km\n用时 00:50:00\n平均配速4:00/km\n平均心率180\n最高心率170');
  assert.ok(r.warnings.some(x=>x.includes('不一致'))); assert.ok(r.warnings.some(x=>x.includes('高于')));
});
test('handles OCR spacing and full width text', () => {
  const r=parse('距 离 １０．０ 公里\n总 用 时 ００：５０：００\n平 均 心 率 １５０'); assert.equal(r.fields.distanceKm,10); assert.equal(r.fields.elapsedSeconds,3000); assert.equal(r.fields.averageHr,150);
});
test('rejects empty, oversized, and renamed non-image data', async () => {
  await assert.rejects(()=>validateFile(new Blob([])),/12 MB/);
  await assert.rejects(()=>validateFile(new Blob(['not an image'],{type:'image/png'})),/改名/);
  await assert.rejects(()=>validateFile({size:13*1024*1024,arrayBuffer(){}}),/12 MB/);
});

test('recognizes English heart-rate aliases and glued uppercase BPM', () => {
  for (const average of ['Avg. Heart Rate', 'Average HR', 'Mean Heart Rate', 'Heart Rate (Average)']) {
    const r = parse(`${average}: 154BPM\nMaximum HR: 181 bpm`);
    assert.equal(r.fields.averageHr, 154, average);
    assert.equal(r.fields.peakHr, 181, average);
  }
  for (const maximum of ['Max HR', 'Max. Heart Rate', 'Maximum Heart Rate', 'Peak HR', 'Heart Rate (Maximum)']) {
    assert.equal(parse(`${maximum} 180BPM`).fields.peakHr, 180, maximum);
  }
});

test('joins wrapped English labels without needing a distance card', () => {
  const r = parse('Avg.\nHeart\nRate\n154\nBPM\nMax.\nHeart Rate\n181BPM');
  assert.equal(r.fields.averageHr, 154);
  assert.equal(r.fields.peakHr, 181);
});

test('maps the Average and Maximum columns under a shared Heart Rate heading', () => {
  const r = parse('HEART RATE\nAverage Maximum\n153BPM 176BPM');
  assert.equal(r.fields.averageHr, 153);
  assert.equal(r.fields.peakHr, 176);
  const above = parse('Heart Rate (bpm)\n154 178\nAvg. Max.');
  assert.equal(above.fields.averageHr, 154);
  assert.equal(above.fields.peakHr, 178);
});

test('handles one shared heart-rate section with value-above-label cards', () => {
  const r = parse('Heart Rate\n155 BPM\nAverage\n182 BPM\nMaximum\nCadence\n177 spm\nAverage');
  assert.equal(r.fields.averageHr, 155);
  assert.equal(r.fields.peakHr, 182);
});

test('leaves contradictory duplicate heart-rate cards unresolved', () => {
  const r = parse('Avg Heart Rate 150 BPM\nAvg Heart Rate 165 BPM\nMax HR 180 BPM');
  assert.equal(r.fields.averageHr, null);
  assert.equal(r.fields.peakHr, 180);
  assert.ok(r.warnings.some(x => x.includes('平均心率标签已找到')));
});

test('does not infer heart rate from charts, zones, cadence or a label without data', () => {
  for (const source of [
    'Heart Rate\n120 140 160 180\n00:10 00:20 00:30',
    'Heart Rate Zones\nMaximum 90–100%\n172–190 bpm\n00:10',
    'Avg HR\nCadence 175 spm\nMax HR\n180 spm',
    'Avg HR 155–175 bpm\nMax HR 90%',
    'Average Pace 5:10\nMax Cadence 190 spm',
    'Average Heart Rate\nMax Heart Rate 180 bpm'
  ]) {
    const r = parse(source);
    assert.equal(r.fields.averageHr, null, source);
    if (!source.endsWith('Max Heart Rate 180 bpm')) assert.equal(r.fields.peakHr, null, source);
  }
});

function layoutWord(text, x, y, width = text.length * 10, height = 20, confidence = 96) {
  return {text, confidence, bbox: {x0: x, y0: y, x1: x + width, y1: y + height}};
}
function layoutData(words) { return {blocks: [{paragraphs: [{lines: [{words}]}]}]}; }

test('uses word positions when sparse OCR interleaves two English heart-rate cards', () => {
  const data = layoutData([
    layoutWord('Avg.', 20, 100), layoutWord('Heart', 70, 100), layoutWord('Rate', 130, 100),
    layoutWord('Max', 360, 100), layoutWord('Heart', 400, 100), layoutWord('Rate', 460, 100),
    layoutWord('153', 20, 140, 66, 34), layoutWord('BPM', 96, 148),
    layoutWord('178', 360, 140, 66, 34), layoutWord('BPM', 436, 148)
  ]);
  const r = parse('Avg. Heart Rate\nMax Heart Rate\n153BPM\n178BPM', data);
  assert.equal(r.fields.averageHr, 153);
  assert.equal(r.fields.peakHr, 178);
  assert.deepEqual(r.fieldSources, {averageHr: 'layout', peakHr: 'layout'});
});

test('pairs value-above-label cards independently of OCR reading order', () => {
  const data = layoutData([
    layoutWord('162', 40, 90, 78, 40), layoutWord('bpm', 128, 108),
    layoutWord('181', 330, 90, 78, 40), layoutWord('bpm', 418, 108),
    layoutWord('Average', 40, 145), layoutWord('HR', 122, 145),
    layoutWord('Maximum', 330, 145), layoutWord('HR', 412, 145)
  ]);
  const r = parse('162 bpm\n181 bpm\nAverage HR\nMaximum HR', data);
  assert.equal(r.fields.averageHr, 162);
  assert.equal(r.fields.peakHr, 181);
});

test('recognizes a Heart Rate heading with two statistic sublabels from layout', () => {
  const data = layoutData([
    layoutWord('Heart', 20, 20), layoutWord('Rate', 80, 20),
    layoutWord('Average', 20, 80), layoutWord('Maximum', 320, 80),
    layoutWord('157', 20, 120, 66, 34), layoutWord('bpm', 96, 128),
    layoutWord('184', 320, 120, 66, 34), layoutWord('bpm', 396, 128)
  ]);
  const r = parse('Heart Rate\nAverage\nMaximum\n157 bpm\n184 bpm', data);
  assert.equal(r.fields.averageHr, 157);
  assert.equal(r.fields.peakHr, 184);
});

test('layout never substitutes nearby cadence or zone percentages for missing heart rate', () => {
  const data = layoutData([
    layoutWord('Average', 20, 20), layoutWord('HR', 110, 20),
    layoutWord('Max', 320, 20), layoutWord('HR', 370, 20),
    layoutWord('175', 20, 60, 60, 32), layoutWord('spm', 90, 68),
    layoutWord('90', 320, 60, 60, 32), layoutWord('%', 390, 68)
  ]);
  const r = parse('Average HR\n175 spm\nMax HR\n90%', data);
  assert.equal(r.fields.averageHr, null);
  assert.equal(r.fields.peakHr, null);
});

test('ambiguous adjacent card values stay blank instead of choosing a random number', () => {
  const data = layoutData([
    layoutWord('Avg', 100, 100), layoutWord('HR', 140, 100),
    layoutWord('150', 105, 60, 48, 20), layoutWord('170', 105, 140, 48, 20)
  ]);
  const r = parse('150\nAvg HR\n170', data);
  assert.equal(r.fields.averageHr, null);
  assert.ok(r.warnings.some(x => x.includes('数字位置')));
});

test('single workout peak remains a result field and is not a physiological maximum', () => {
  const r = parse('Average HR 152 bpm\nMax HR 181 bpm');
  assert.equal(r.fields.peakHr, 181);
  assert.equal(r.fields.maxHr, undefined);
  assert.ok(r.warnings.some(x => x.includes('不会自动填入个人最大心率')));
});

test('only explicit elapsed and moving labels identify the timing type', () => {
  for (const label of ['Elapsed Time', 'Total Time', 'Chip Time', 'Net Time', 'Finish Time', 'Finishing Time', '总用时', '总时间', '净计时成绩', '完赛时间', '芯片成绩']) {
    const result = parse(`${label}: 00:52:00`);
    assert.equal(result.durationType, 'elapsed', label);
    assert.equal(result.fields.elapsedSeconds, 3120, label);
  }
  for (const label of ['Moving Time', '移动用时', '移动时间']) {
    const result = parse(`${label}: 51:30`);
    assert.equal(result.durationType, 'moving', label);
    assert.equal(result.fields.elapsedSeconds, 3090, label);
  }
  for (const text of ['Duration: 00:52:00', '用时 00:52:00', '运动时间 00:52:00', '00:52:00', 'Elapsed Time']) {
    assert.equal(parse(text).durationType, 'unknown', text);
  }
});

test('conflicting or mixed timing labels cannot claim a confirmed timing type', () => {
  for (const text of [
    'Elapsed Time 00:52:00\nMoving Time 00:50:00',
    'Elapsed Time 00:52:00 Moving Time 00:50:00',
    'Total Time 52:00\nChip Time 51:30',
    'Elapsed Time 00:52:00\nElapsed Time 00:53:00'
  ]) {
    const result = parse(text);
    assert.equal(result.durationType, 'unknown', text);
    assert.equal(result.fields.elapsedSeconds, null, text);
  }
  for (const text of ['Elapsed Time 00:52:00\nMoving Time 00:52:00', 'Elapsed Time 00:52:00\nDuration 00:52:00']) {
    const result = parse(text);
    assert.equal(result.durationType, 'unknown', text);
    assert.equal(result.fields.elapsedSeconds, 3120, text);
  }
  assert.equal(parse('Elapsed Time\nStart Time 10:15:00').durationType, 'unknown');
});

test('an unambiguous duration in sparse card text retains its explicit Elapsed Time label', () => {
  const result = parse('Distance\nElapsed Time\n10.00 km\n00:52:00\nAverage Pace\n5:12 /km');
  assert.equal(result.fields.elapsedSeconds, 3120);
  assert.equal(result.durationType, 'elapsed');
  assert.equal(Object.keys(result.fields).length, 6);
});
