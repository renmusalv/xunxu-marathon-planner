const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const Health = require('../src/health-import.js');

const now = '2026-11-13';
const xml = content => '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE HealthData [<!ELEMENT HealthData ANY>]><HealthData locale="en_US">' + content + '</HealthData>';
const workout = (date, distance = 10, extras = '', body = '') => `<Workout workoutActivityType="HKWorkoutActivityTypeRunning" startDate="${date} 08:00:00 +0800" endDate="${date} 09:00:00 +0800" duration="55" durationUnit="min" totalDistance="${distance}" totalDistanceUnit="km" sourceName="Watch" ${extras}>${body}</Workout>`;
const record = (type, date, value, unit, source = 'Watch') => `<Record type="HKQuantityTypeIdentifier${type}" startDate="${date} 08:00:00 +0800" endDate="${date} 08:01:00 +0800" value="${value}" unit="${unit}" sourceName="${source}"/>`;
function crc(bytes) { let c = 0xffffffff; for (const byte of bytes) { c ^= byte; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return (c ^ 0xffffffff) >>> 0; }
function zip(text, options = {}) {
  const name = Buffer.from(options.name || 'apple_health_export/export.xml');
  const plain = Buffer.from(text), compressed = options.stored ? plain : zlib.deflateRawSync(plain), method = options.stored ? 0 : 8;
  const local = Buffer.alloc(30), directory = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(options.flags || 0, 6); local.writeUInt16LE(method, 8); local.writeUInt32LE(crc(plain), 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(plain.length, 22); local.writeUInt16LE(name.length, 26);
  directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(options.flags || 0, 8); directory.writeUInt16LE(method, 10); directory.writeUInt32LE(options.badCrc ? 5 : crc(plain), 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(options.size || plain.length, 24); directory.writeUInt16LE(name.length, 28);
  const before = Buffer.concat([local, name, compressed]), central = Buffer.concat([directory, name]);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(before.length, 16);
  return new Blob([before, central, end]);
}

test('28 complete days exclude today, preserve four observed weeks, and include today in longest run', () => {
  const result = Health.parseAppleHealth(xml(workout('2026-10-16', 8) + workout('2026-10-23', 12) + workout('2026-10-30', 10) + workout('2026-11-12', 14) + workout(now, 18)), { now });
  assert.deepEqual(result.window, { start: '2026-10-16', end: '2026-11-12', days: 28 });
  assert.equal(result.summary.weeklyKm, 11);
  assert.equal(result.summary.runDaysPerWeek, 1);
  assert.equal(result.summary.workoutCount, 4);
  assert.equal(result.summary.longestRunKm, 18);
  assert.deepEqual(result.summary.weeks.map(w => w.distanceKm), [8, 12, 10, 14]);
  assert.equal(result.coverage.completeness, 'unverified');
  assert.equal(result.summary.activeWeeks, 4);
});

test('running only; walking and all-day distance samples are not added as training', () => {
  const result = Health.parseAppleHealth(xml(workout('2026-11-10', 10) + workout('2026-11-11', 20).replace('HKWorkoutActivityTypeRunning', 'HKWorkoutActivityTypeWalking') + record('DistanceWalkingRunning', '2026-11-12', 80, 'km')), { now });
  assert.equal(result.summary.totalKm, 10);
  assert.equal(result.summary.workoutCount, 1);
});

test('overlapping duplicates merge without double-counting; two separate sessions in one day remain', () => {
  const first = workout('2026-11-10', 10);
  const duplicate = workout('2026-11-10', 10, '', '<WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="145" maximum="170" unit="count/min"/>').replace('sourceName="Watch"', 'sourceName="WorkOutDoors"');
  const evening = workout('2026-11-10', 5).replaceAll('08:00:00', '18:00:00').replaceAll('09:00:00', '19:00:00');
  const result = Health.parseAppleHealth(xml(first + duplicate + evening), { now });
  assert.equal(result.summary.totalKm, 15);
  assert.equal(result.summary.runningDays, 1);
  assert.equal(result.summary.workoutCount, 2);
  assert.equal(result.duplicatesRemoved, 1);
  assert.equal(result.candidates[0].averageHr, 145);
});

test('modern WorkoutStatistics and old totalDistance units both convert accurately', () => {
  const modern = workout('2026-11-11', 0, '', '<WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" sum="10000" unit="m"/>').replace('totalDistance="0" totalDistanceUnit="km"', '');
  const imperial = workout('2026-11-12', 6.213711922).replace('totalDistanceUnit="km"', 'totalDistanceUnit="mi"');
  const result = Health.parseAppleHealth(xml(modern + imperial), { now });
  assert.equal(result.summary.totalKm, 20);
  assert.equal(result.candidates.length, 2);
});

test('GPS distances and time bases remain unconfirmed; workout duration never becomes race time implicitly', () => {
  const result = Health.parseAppleHealth(xml(workout('2026-11-12', 10.11)), { now });
  const item = result.candidates[0];
  assert.equal(item.distanceKm, 10.11);
  assert.equal(item.standardDistanceKm, 10);
  assert.equal(item.elapsedSeconds, 3600);
  assert.equal(item.activeSeconds, 3300);
  assert.equal(item.durationBasis, 'start_end');
  assert.equal(item.durationType, 'unknown');
  assert.equal(item.effort, 'unknown');
  assert.equal(item.confirmed, false);
  assert.equal(item.include, false);
});

test('latest recognized resting HR and VO2 units are isolated from workout peak HR', () => {
  const result = Health.parseAppleHealth(xml(record('RestingHeartRate', '2026-11-01', 55, 'count/min') + record('RestingHeartRate', '2026-11-12', 52, 'count/min', 'A &amp; B') + record('VO2Max', '2026-11-10', 48.53, 'mL/min·kg') + workout('2026-11-11', 10, '', '<WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="149.2" maximum="178" unit="count/min"/>')), { now });
  assert.equal(result.personal.restingHr.value, 52);
  assert.equal(result.personal.restingHr.source, 'A & B');
  assert.equal(result.personal.vo2max.value, 48.5);
  assert.equal(result.personal.maxHr, undefined);
  assert.equal(result.candidates[0].peakHr, 178);
  assert.equal(result.candidates[0].averageHr, 149);
});

test('invalid units, future values, invalid dates and conflicting values are not silently repaired', () => {
  const conflicting = workout('2026-11-11', 10, '', '<WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" sum="15" unit="km"/>');
  const badHeart = workout('2026-11-12', 10, '', '<WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="180" maximum="150" unit="count/min"/>');
  const result = Health.parseAppleHealth(xml(conflicting + badHeart + workout('2026-02-30') + workout('2026-11-20') + record('RestingHeartRate', '2026-11-12', 50, 'count/s') + record('VO2Max', '2026-11-14', 49, 'mL/min·kg')), { now });
  assert.equal(result.summary.workoutCount, 1);
  assert.equal(result.personal.restingHr, null);
  assert.equal(result.personal.vo2max, null);
  assert.equal(result.candidates[0].averageHr, null);
  assert.equal(result.candidates[0].peakHr, null);
  assert.ok(result.warnings.length >= 3);
});

test('empty or partial exports never assert zero training, complete coverage, or stable continuity', () => {
  const empty = Health.parseAppleHealth(xml(''), { now });
  assert.equal(empty.summary.weeklyKm, null);
  assert.equal(empty.summary.runDaysPerWeek, null);
  assert.equal(empty.summary.longestRunKm, null);
  assert.equal(empty.coverage.completeness, 'unverified');
  assert.equal(empty.summary.recentConsistency, undefined);
  const partial = Health.parseAppleHealth(xml(workout('2026-11-12')), { now });
  assert.equal(partial.summary.coverageDays, 1);
  assert.ok(partial.warnings.some(x => x.includes('未覆盖')));
});

test('stale physiology dates are surfaced and old candidates expire', () => {
  const result = Health.parseAppleHealth(xml(record('RestingHeartRate', '2026-09-01', 50, 'count/min') + record('VO2Max', '2026-01-01', 45, 'mL/min·kg') + workout('2025-01-01')), { now });
  assert.equal(result.personal.restingHr.stale, true);
  assert.equal(result.personal.vo2max.stale, true);
  assert.equal(result.candidates.length, 0);
});

test('indoor running is clearly marked and absent heart rate stays absent', () => {
  const result = Health.parseAppleHealth(xml(workout('2026-11-11', 21.2, '', '<MetadataEntry key="HKIndoorWorkout" value="1"/>')), { now });
  assert.equal(result.candidates[0].course, 'treadmill');
  assert.equal(result.candidates[0].averageHr, null);
  assert.equal(result.candidates[0].peakHr, null);
});

test('external entities, unknown entity expansion and malformed documents are rejected', () => {
  assert.throws(() => Health.parseAppleHealth('<!DOCTYPE HealthData SYSTEM "https://example.com/external"><HealthData/>', { now }), e => e.code === 'UNSAFE_XML');
  assert.throws(() => Health.parseAppleHealth('<!DOCTYPE HealthData [<!ENTITY a "secret">]><HealthData/>', { now }), e => e.code === 'UNSAFE_XML');
  assert.throws(() => Health.parseAppleHealth(xml(record('RestingHeartRate', '2026-11-12', 50, 'count/min', '&unknown;')), { now }), e => e.code === 'INVALID_XML');
  assert.throws(() => Health.parseAppleHealth('<HealthData><Workout/></Wrong>', { now }), e => e.code === 'INVALID_XML');
  assert.throws(() => Health.parseAppleHealth('<NotHealth/>', { now }), e => e.code === 'UNSUPPORTED_FILE');
  assert.throws(() => Health.parseAppleHealth('<HealthData>', { now }), e => e.code === 'INVALID_XML');
});

test('streamed XML and compressed ZIP produce identical review data with progress', async () => {
  const source = xml(workout('2026-11-12') + record('RestingHeartRate', '2026-11-11', 53, 'count/min'));
  const progress = [];
  const plain = await Health.readFile(new Blob([source]), { now });
  const compressed = await Health.readFile(zip(source), { now, onProgress: value => progress.push(value) });
  assert.deepEqual(compressed, plain);
  assert.equal(progress[0], 0);
  assert.equal(progress.at(-1), 1);
  assert.equal(compressed.rawText, undefined);
});

test('stored ZIP and a root export.xml entry are supported', async () => {
  const result = await Health.readFile(zip(xml(workout('2026-11-12')), { stored: true, name: 'export.xml' }), { now });
  assert.equal(result.summary.workoutCount, 1);
});

test('ZIP corruption, encryption, path attacks, missing export and over-sized declarations are rejected', async () => {
  const source = xml(workout('2026-11-12'));
  await assert.rejects(Health.readFile(zip(source, { badCrc: true }), { now }), e => e.code === 'INVALID_ZIP');
  await assert.rejects(Health.readFile(zip(source, { flags: 1 }), { now }), e => e.code === 'UNSUPPORTED_ZIP');
  await assert.rejects(Health.readFile(zip(source, { name: '../export.xml' }), { now }), e => e.code === 'INVALID_ZIP');
  await assert.rejects(Health.readFile(zip('<?xml version="1.0"?><ClinicalDocument/>', { name: 'export_cda.xml' }), { now }), e => e.code === 'UNSUPPORTED_FILE');
  await assert.rejects(Health.readFile(zip(source, { size: Health.limits.xmlBytes + 1 }), { now }), e => e.code === 'FILE_TOO_LARGE');
  const cut = zip(source); await assert.rejects(Health.readFile(cut.slice(0, cut.size - 8), { now }), e => e.code === 'INVALID_ZIP');
});

test('cancellation stops ingestion and invalid XML cannot create partial results', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(Health.readFile(new Blob([xml('')]), { now, signal: controller.signal }), e => e.code === 'ABORTED');
  await assert.rejects(Health.readFile(new Blob([xml(workout('2026-11-12')).slice(0, -10)]), { now }), e => e.code === 'INVALID_XML');
});

test('chunk boundaries can split XML entities, tags and multi-byte source names', async () => {
  const source = Buffer.from(xml(record('RestingHeartRate', '2026-11-12', 52, 'count/min', '手表 &amp; 跑步')));
  const file = new Blob([source]);
  file.stream = () => new ReadableStream({ start(controller) { for (let i = 0; i < source.length; i += 3) controller.enqueue(new Uint8Array(source.subarray(i, i + 3))); controller.close(); } });
  const result = await Health.readFile(file, { now });
  assert.equal(result.personal.restingHr.source, '手表 & 跑步');
});

test('future-ending workouts and oversized tags are rejected or excluded without partial data', () => {
  const futureEnd = workout('2026-11-12').replace('endDate="2026-11-12', 'endDate="2026-11-14');
  const result = Health.parseAppleHealth(xml(futureEnd), { now });
  assert.equal(result.summary.workoutCount, 0);
  assert.equal(result.candidates.length, 0);
  assert.throws(() => Health.parseAppleHealth(xml('<Record sourceName="' + 'a'.repeat(Health.limits.tagCharacters) + '"/>'), { now }), e => e.code === 'INVALID_XML');
});

test('deduplicating different heart-rate fields cannot create average HR above peak HR', () => {
  const average = workout('2026-11-12', 10, '', '<WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="180" unit="count/min"/>');
  const peak = workout('2026-11-12', 10, '', '<WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" maximum="150" unit="count/min"/>');
  const result = Health.parseAppleHealth(xml(average + peak), { now });
  assert.equal(result.summary.workoutCount, 1);
  assert.equal(result.candidates[0].averageHr, 180);
  assert.equal(result.candidates[0].peakHr, null);
  assert.ok(result.warnings.some(value => value.includes('重复记录间心率')));
});
