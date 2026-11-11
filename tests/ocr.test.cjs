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
