const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createStore, validProfile } = require('../src/profile-store.js');

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
  };
}

function record(overrides = {}) {
  return {
    id: 'result-1', profileId: 'runner-a', date: '2026-10-18',
    distanceKm: 10, elapsedSeconds: 3000, averageHr: 155,
    ...overrides,
  };
}

test('the same record ID is independently stored in different profiles', () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  store.put('runner-a', record());
  store.put('runner-b', record({ profileId: 'runner-b', elapsedSeconds: 4200 }));
  assert.equal(store.list('runner-a')[0].elapsedSeconds, 3000);
  assert.equal(store.list('runner-b')[0].elapsedSeconds, 4200);
  assert.notEqual(store.key('runner-a'), store.key('runner-b'));
  assert.equal(storage.data.size, 2);
});

test('cross-profile writes reject without changing either profile', () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  store.put('runner-a', record());
  store.put('runner-b', record({ profileId: 'runner-b', elapsedSeconds: 4200 }));
  const before = [...storage.data.entries()];
  assert.throws(() => store.put('runner-b', record()), /归属/);
  assert.deepEqual([...storage.data.entries()], before);
});

test('duplicate image fingerprints are rejected only inside the owning profile', () => {
  const store = createStore(memoryStorage());
  store.put('runner-a', record({ fingerprint: 'image-sha-123' }));
  assert.throws(() => store.put('runner-a', record({
    id: 'result-2', date: '2026-11-01', elapsedSeconds: 2900, fingerprint: 'image-sha-123',
  })), /已有/);
  store.put('runner-b', record({ profileId: 'runner-b', fingerprint: 'image-sha-123' }));
  assert.equal(store.list('runner-a').length, 1);
  assert.equal(store.list('runner-b').length, 1);
});

test('same date/distance/time tuple is rejected even if formatting or image differs', () => {
  const store = createStore(memoryStorage());
  store.put('runner-a', record({ fingerprint: 'first-image' }));
  assert.throws(() => store.put('runner-a', record({
    id: 'result-2', distanceKm: '10.000', elapsedSeconds: '3000', fingerprint: 'another-image',
  })), /已有/);
  assert.equal(store.list('runner-a').length, 1);
});

test('editing one record preserves other records and allows its original fingerprint', () => {
  const store = createStore(memoryStorage());
  store.put('runner-a', record({ fingerprint: 'first-image' }));
  const second = record({ id: 'result-2', date: '2026-11-03', elapsedSeconds: 2920 });
  store.put('runner-a', second);
  store.put('runner-a', record({ averageHr: 153, fingerprint: 'first-image' }));
  const records = store.list('runner-a');
  assert.equal(records.length, 2);
  assert.deepEqual(records.find(r => r.id === 'result-2'), second);
  assert.equal(records.find(r => r.id === 'result-1').averageHr, 153);
  assert.equal(records[0].id, 'result-2');
});

test('deleting a shared record ID affects only the selected profile', () => {
  const store = createStore(memoryStorage());
  store.put('runner-a', record());
  store.put('runner-b', record({ profileId: 'runner-b' }));
  store.remove('runner-a', 'result-1');
  assert.deepEqual(store.list('runner-a'), []);
  assert.equal(store.list('runner-b').length, 1);
  store.remove('runner-a', 'missing-id');
  assert.equal(store.list('runner-b').length, 1);
});

test('foreign rows in a damaged profile key are not returned to that profile', () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  storage.setItem(store.key('runner-a'), JSON.stringify([
    record(), record({ id: 'private-b', profileId: 'runner-b' }), null,
  ]));
  assert.deepEqual(store.list('runner-a'), [record()]);
});

test('malformed JSON blocks reads and writes instead of resetting existing data', () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  storage.setItem(store.key('runner-a'), '[broken');
  assert.throws(() => store.list('runner-a'), /无法读取/);
  assert.throws(() => store.put('runner-a', record()), /无法读取/);
  assert.throws(() => store.remove('runner-a', 'result-1'), /无法读取/);
  assert.equal(storage.getItem(store.key('runner-a')), '[broken');
});

test('a valid JSON object is not silently treated as an empty result array', () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  storage.setItem(store.key('runner-a'), '{"results":[]}');
  assert.throws(() => store.list('runner-a'), /格式异常/);
  assert.throws(() => store.put('runner-a', record()), /格式异常/);
});

test('blocked storage reads reject rather than claiming the profile has no records', () => {
  const store = createStore({ getItem() { throw new Error('SecurityError'); } });
  assert.throws(() => store.list('runner-a'), /无法读取/);
  assert.throws(() => store.put('runner-a', record()), /无法读取/);
});

test('quota failures reject additions, edits and deletions without claiming success', () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  store.put('runner-a', record());
  const before = storage.getItem(store.key('runner-a'));
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.throws(() => store.put('runner-a', record({ averageHr: 152 })), /无法保存/);
  assert.throws(() => store.put('runner-a', record({ id: 'result-2', date: '2026-11-01' })), /无法保存/);
  assert.throws(() => store.remove('runner-a', 'result-1'), /无法保存/);
  assert.equal(storage.getItem(store.key('runner-a')), before);
});

test('profile IDs reject non-strings and ambiguous key separators', () => {
  for (const id of [undefined, null, 123, {}, '', 'a:b', 'a/b', 'a b', 'x'.repeat(101)]) {
    assert.throws(() => validProfile(id), /档案标识无效/);
  }
});

test('record IDs reject non-strings before they can be saved and disappear from list', () => {
  for (const id of [undefined, null, 123, {}, '', 'a:b', 'x'.repeat(101)]) {
    const storage = memoryStorage();
    const store = createStore(storage);
    assert.throws(() => store.put('runner-a', record({ id })), undefined, `id=${String(id)}`);
    assert.equal(storage.data.size, 0);
  }
});

// A narrow IndexedDB test double: it records requested keys, models transaction
// completion/rollback, and can return rows with mismatched ownership metadata.
function fakeIndexedDb({ abortWrites = false, openError = false } = {}) {
  const rows = new Map();
  const calls = [];
  const database = {
    createObjectStore() {},
    transaction(name, mode) {
      assert.equal(name, 'images');
      const tx = {
        objectStore() {
          function request(operation, key, value) {
            const req = {};
            calls.push({ operation, key, mode });
            queueMicrotask(() => {
              req.result = operation === 'get' ? rows.get(key) : key;
              req.onsuccess?.();
              queueMicrotask(() => {
                if (abortWrites && operation !== 'get') { tx.onabort?.(); return; }
                if (operation === 'put') rows.set(key, value);
                if (operation === 'delete') rows.delete(key);
                tx.oncomplete?.();
              });
            });
            return req;
          }
          return {
            get: key => request('get', key),
            put: value => request('put', value.key, value),
            delete: key => request('delete', key),
          };
        },
      };
      return tx;
    },
  };
  return {
    rows, calls,
    open() {
      const req = { result: database };
      queueMicrotask(() => {
        if (openError) req.onerror?.();
        else { req.onupgradeneeded?.(); req.onsuccess?.(); }
      });
      return req;
    },
  };
}

function imageApi(indexedDB) {
  const sandbox = { module: { exports: {} }, indexedDB };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/profile-store.js'), 'utf8'), sandbox);
  return sandbox.module.exports;
}

test('IndexedDB uses profile:record keys so same IDs cannot overwrite or delete another profile image', async () => {
  const indexedDB = fakeIndexedDb();
  const api = imageApi(indexedDB);
  const a = new Blob(['private image A']);
  const b = new Blob(['private image B']);
  await api.putImage('runner-a', 'result-1', a);
  await api.putImage('runner-b', 'result-1', b);
  assert.equal(await api.getImage('runner-a', 'result-1'), a);
  assert.equal(await api.getImage('runner-b', 'result-1'), b);
  await api.removeImage('runner-a', 'result-1');
  assert.equal(await api.getImage('runner-a', 'result-1'), null);
  assert.equal(await api.getImage('runner-b', 'result-1'), b);
  assert.ok(indexedDB.calls.some(c => c.key === 'runner-a:result-1'));
  assert.ok(indexedDB.calls.some(c => c.key === 'runner-b:result-1'));
});

test('IndexedDB checks stored ownership metadata before returning image bytes', async () => {
  const indexedDB = fakeIndexedDb();
  const api = imageApi(indexedDB);
  indexedDB.rows.set('runner-a:result-1', {
    key: 'runner-a:result-1', profileId: 'runner-b', recordId: 'result-1', blob: new Blob(['B']),
  });
  assert.equal(await api.getImage('runner-a', 'result-1'), null);
  indexedDB.rows.set('runner-a:result-1', {
    key: 'runner-a:result-1', profileId: 'runner-a', recordId: 'result-2', blob: new Blob(['A2']),
  });
  assert.equal(await api.getImage('runner-a', 'result-1'), null);
});

test('IndexedDB transaction abort rejects even after a request success event', async () => {
  const indexedDB = fakeIndexedDb({ abortWrites: true });
  const api = imageApi(indexedDB);
  await assert.rejects(() => api.putImage('runner-a', 'result-1', new Blob(['A'])), /存储失败/);
  assert.equal(indexedDB.rows.size, 0);
  indexedDB.rows.set('runner-a:result-1', { profileId: 'runner-a', recordId: 'result-1', blob: new Blob(['A']) });
  await assert.rejects(() => api.removeImage('runner-a', 'result-1'), /存储失败/);
  assert.equal(indexedDB.rows.size, 1);
});

test('unavailable or failed IndexedDB rejects without fake success', async () => {
  const disabled = imageApi(undefined);
  await assert.rejects(() => disabled.putImage('runner-a', 'result-1', new Blob(['A'])), /未开放图片存储/);
  const failed = imageApi(fakeIndexedDb({ openError: true }));
  await assert.rejects(() => failed.putImage('runner-a', 'result-1', new Blob(['A'])), /截图无法保存/);
});

test('image record IDs reject non-strings rather than coerce into another key', async () => {
  for (const id of [undefined, null, 123, {}, '', 'a:b']) {
    const indexedDB = fakeIndexedDb();
    const api = imageApi(indexedDB);
    await assert.rejects(() => api.putImage('runner-a', id, new Blob(['A'])), undefined, `id=${String(id)}`);
    assert.equal(indexedDB.calls.length, 0);
  }
});
