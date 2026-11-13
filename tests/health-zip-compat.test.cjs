const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const Health = require('../src/health-import.js');

// Synthetic records only. Nothing in this fixture comes from a health export.
const now = '2026-11-13';
const healthXml = '<?xml version="1.0" encoding="UTF-8"?>'
  + '<!DOCTYPE HealthData [<!ELEMENT HealthData ANY>]>'
  + '<HealthData locale="zh_CN">'
  + '<Workout workoutActivityType="HKWorkoutActivityTypeRunning" startDate="2026-11-12 08:00:00 +0800" endDate="2026-11-12 08:52:00 +0800" duration="52" durationUnit="min" totalDistance="10" totalDistanceUnit="km" sourceName="Synthetic QA">'
  + '<WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="158" maximum="176" unit="count/min"/>'
  + '</Workout>'
  + '<Record type="HKQuantityTypeIdentifierRestingHeartRate" startDate="2026-11-12 06:00:00 +0800" endDate="2026-11-12 06:01:00 +0800" value="52" unit="count/min" sourceName="Synthetic QA"/>'
  + '</HealthData>';
const clinicalXml = '<?xml version="1.0"?><ClinicalDocument xmlns="urn:hl7-org:v3"><title>Synthetic auxiliary export</title></ClinicalDocument>';

function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}

// Real ZIP local headers and central-directory offsets, with multiple entries.
function archive(entries) {
  const bodies = [], directories = [];
  let offset = 0;
  for (const item of entries) {
    const name = Buffer.isBuffer(item.name) ? item.name : Buffer.from(item.name);
    const localName = item.localName ? Buffer.from(item.localName) : name;
    const plain = Buffer.from(item.text ?? healthXml);
    const method = item.stored ? 0 : 8;
    const compressed = method ? zlib.deflateRawSync(plain) : plain;
    const checksum = item.badCrc ? (crc(plain) ^ 0xff) >>> 0 : crc(plain);
    const local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(item.flags || 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(plain.length, 22);
    local.writeUInt16LE(localName.length, 26);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(item.flags || 0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(plain.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    const body = Buffer.concat([local, localName, compressed]);
    bodies.push(body);
    directories.push(Buffer.concat([central, name]));
    offset += body.length;
  }
  const directory = Buffer.concat(directories), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Blob([...bodies, directory, end]);
}

test('ZIP import accepts Chinese, traditional Chinese and arbitrary XML names by their HealthData content', async () => {
  const expected = await Health.readFile(new Blob([healthXml]), {now});
  for (const name of ['apple_health_export/导出.xml', '健康/匯出.xml', '書き出し.xml', 'données.XML', 'archive/backup/renamed-health.xml']) {
    for (const stored of [false, true]) {
      const result = await Health.readFile(archive([{name, stored, flags: 0x800}]), {now});
      assert.deepEqual(result, expected, `${name}, stored=${stored}`);
    }
  }
});

test('CDA before the localized main file does not shadow running or heart-rate records', async () => {
  const result = await Health.readFile(archive([
    {name: 'apple_health_export/export_cda.xml', text: clinicalXml},
    {name: 'apple_health_export/导出.xml'},
    {name: 'apple_health_export/workout-routes/route.gpx', text: '<gpx/>'}
  ]), {now});
  assert.equal(result.summary.totalKm, 10);
  assert.equal(result.personal.restingHr.value, 52);
  assert.equal(result.candidates[0].averageHr, 158);
  assert.equal(result.candidates[0].peakHr, 176);
});

test('XML declaration, BOM, comments and an internal DTD may precede the real HealthData root', async () => {
  const text = '\uFEFF<?xml version="1.0"?><!-- <ClinicalDocument/> -->'
    + '<!DOCTYPE HealthData [<!-- <ClinicalDocument/> --><!ELEMENT HealthData ANY>]>'
    + healthXml.slice(healthXml.indexOf('<HealthData'));
  const result = await Health.readFile(archive([{name: 'health.xml', text}]), {now});
  assert.equal(result.summary.workoutCount, 1);
});

test('HealthData text inside comments or DTD declarations is not mistaken for a document root', async () => {
  const decoys = [
    '<?xml version="1.0"?><!-- <HealthData/> --><ClinicalDocument/>',
    '<!DOCTYPE ClinicalDocument [<!ELEMENT HealthData ANY>]><ClinicalDocument/>',
    '<Other><HealthData/></Other>'
  ];
  for (const text of decoys) {
    await assert.rejects(Health.readFile(archive([{name: 'export.xml', text}]), {now}), e => e.code === 'UNSUPPORTED_FILE');
  }
});

test('an archive containing only CDA explains that no supported health data was imported', async () => {
  await assert.rejects(Health.readFile(archive([{name: 'export_cda.xml', text: clinicalXml}]), {now}), e => e.code === 'UNSUPPORTED_FILE');
});

test('different filenames containing two HealthData documents require an explicit user choice', async () => {
  await assert.rejects(Health.readFile(archive([
    {name: 'apple_health_export/export.xml'},
    {name: 'backup/导出.xml', stored: true}
  ]), {now}), e => e.code === 'AMBIGUOUS_ZIP');
});

test('Mac metadata and AppleDouble XML lookalikes do not create ambiguous health exports', async () => {
  const result = await Health.readFile(archive([
    {name: '__MACOSX/apple_health_export/export.xml', text: '<HealthData/>'},
    {name: 'apple_health_export/._导出.xml', text: '<HealthData/>'},
    {name: 'apple_health_export/导出.xml'}
  ]), {now});
  assert.equal(result.summary.workoutCount, 1);
});

test('legacy filename bytes do not prevent identifying an otherwise valid XML payload', async () => {
  const name = Buffer.concat([Buffer.from('apple_health_export/'), Buffer.from([0xb5, 0xbc, 0xb3, 0xf6]), Buffer.from('.xml')]);
  const result = await Health.readFile(archive([{name, flags: 0}]), {now});
  assert.equal(result.summary.workoutCount, 1);
});

test('local and central filename bytes must match even if both decode to the same replacement character', async () => {
  const name = Buffer.concat([Buffer.from([0xff]), Buffer.from('.xml')]);
  const localName = Buffer.concat([Buffer.from([0xfe]), Buffer.from('.xml')]);
  await assert.rejects(Health.readFile(archive([{name, localName, stored: true}]), {now}), e => e.code === 'INVALID_ZIP');
});

test('localized unsafe paths remain invalid ZIP inputs', async () => {
  for (const name of ['../导出.xml', '/导出.xml', 'folder\\导出.xml']) {
    await assert.rejects(Health.readFile(archive([{name}]), {now}), e => e.code === 'INVALID_ZIP');
  }
});

test('candidate scans are bounded and request extraction when there are too many XML documents', async () => {
  const entries = Array.from({length: 33}, (_, i) => ({name: `auxiliary-${i}.xml`, text: clinicalXml, stored: true}));
  await assert.rejects(Health.readFile(archive(entries), {now}), e => Boolean(e.code) && e.code !== 'UNSUPPORTED_FILE' && /XML/i.test(e.message) && /解压|选择/.test(e.message));
});

test('an oversized prolog reports a scanning limit rather than falsely saying the main XML is absent', async () => {
  const text = '<!--' + 'x'.repeat(1024 * 1024 + 64) + '-->' + healthXml;
  await assert.rejects(Health.readFile(archive([{name: '导出.xml', text, stored: true}]), {now}), e => Boolean(e.code) && e.code !== 'UNSUPPORTED_FILE' && /头部|前缀|扫描|过长|安全.*范围/.test(e.message));
});

test('cancellation while probing an XML entry stops the import without returning a partial report', async () => {
  const controller = new AbortController(), file = archive([{name: '导出.xml', stored: true}]);
  const slice = file.slice.bind(file);
  let streams = 0;
  file.slice = (...args) => {
    const part = slice(...args), stream = part.stream.bind(part);
    part.stream = () => {
      streams++;
      const reader = stream().getReader();
      return new ReadableStream({
        async pull(output) {
          const chunk = await reader.read();
          controller.abort();
          if (chunk.done) output.close(); else output.enqueue(chunk.value);
        },
        cancel() { return reader.cancel(); }
      });
    };
    return part;
  };
  await assert.rejects(Health.readFile(file, {now, signal: controller.signal}), e => e.code === 'ABORTED');
  assert.ok(streams >= 1);
});

test('successful root discovery still requires full XML integrity and safe declarations', async () => {
  await assert.rejects(Health.readFile(archive([{name: '导出.xml', badCrc: true}]), {now}), e => e.code === 'INVALID_ZIP');
  await assert.rejects(Health.readFile(archive([{name: '导出.xml', text: healthXml.replace('</HealthData>', '')}]), {now}), e => e.code === 'INVALID_XML');
  const unsafe = '<!DOCTYPE HealthData [<!ENTITY external SYSTEM "https://example.invalid/test">]><HealthData/>';
  await assert.rejects(Health.readFile(archive([{name: '导出.xml', text: unsafe}]), {now}), e => e.code === 'UNSAFE_XML');
});
