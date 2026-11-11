(function (root) {
  'use strict';
  const prefix = 'xunxu-records-v2:';
  function validProfile(id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('档案标识无效，请重新选择档案。');
    return id;
  }
  function createStore(storage) {
    function list(profileId) {
      validProfile(profileId);
      let data;
      try { data = JSON.parse(storage.getItem(prefix + profileId) || '[]'); }
      catch { throw new Error('成绩资料无法读取。请保留浏览器数据并刷新后重试。'); }
      if (!Array.isArray(data)) throw new Error('成绩资料格式异常。');
      return data.filter(r => r && r.profileId === profileId && typeof r.id === 'string');
    }
    function write(profileId, data) {
      validProfile(profileId);
      if (data.some(r => r.profileId !== profileId)) throw new Error('不能把其他档案的资料写入当前档案。');
      try { storage.setItem(prefix + profileId, JSON.stringify(data)); }
      catch { throw new Error('当前浏览器无法保存成绩，可能空间不足或禁用了存储。请先解决后重试。'); }
    }
    function put(profileId, record) {
      validProfile(profileId);
      if (record.profileId !== profileId || typeof record.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(record.id)) throw new Error('成绩归属与当前档案不一致。');
      const records = list(profileId);
      const duplicate = records.find(r => r.id !== record.id && (
        (record.fingerprint && r.fingerprint === record.fingerprint) ||
        (r.date === record.date && Number(r.distanceKm) === Number(record.distanceKm) && Number(r.elapsedSeconds) === Number(record.elapsedSeconds))
      ));
      if (duplicate) throw new Error('这个档案已有同一天、同距离和用时的成绩，请编辑原记录，避免重复计算。');
      if (!records.some(r => r.id === record.id) && records.length >= 100) throw new Error('每个档案最多保存 100 条成绩，请先整理旧记录。');
      const next = records.filter(r => r.id !== record.id).concat(record).sort((a,b) => String(b.date).localeCompare(String(a.date)));
      write(profileId, next);
      return next;
    }
    function remove(profileId, recordId) {
      const records = list(profileId);
      write(profileId, records.filter(r => r.id !== recordId));
    }
    return {list, put, remove, key: id => prefix + validProfile(id)};
  }
  let dbPromise;
  function db() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      if (!root.indexedDB) return reject(new Error('浏览器未开放图片存储；仍可手动保存成绩。'));
      const request = root.indexedDB.open('xunxu-profile-images-v2', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('images', {keyPath:'key'});
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { dbPromise = null; reject(new Error('截图无法保存，请检查浏览器存储设置。')); };
    });
    return dbPromise;
  }
  async function imageOp(profileId, recordId, mode, blob) {
    validProfile(profileId);
    if (typeof recordId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(recordId)) throw new Error('图片标识无效。');
    const database = await db(), key = profileId + ':' + recordId;
    return new Promise((resolve,reject) => {
      const tx = database.transaction('images', mode === 'get' ? 'readonly':'readwrite');
      const store = tx.objectStore('images');
      const req = mode === 'get' ? store.get(key) : mode === 'delete' ? store.delete(key) : store.put({key,profileId,recordId,blob});
      let result;
      req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(mode === 'get' ? (result?.profileId === profileId && result?.recordId === recordId ? result.blob : null) : undefined);
      tx.onerror = tx.onabort = () => reject(new Error('截图存储失败，请检查可用空间后重试。'));
    });
  }
  const api = {createStore,validProfile,putImage:(p,id,b)=>imageOp(p,id,'put',b),getImage:(p,id)=>imageOp(p,id,'get'),removeImage:(p,id)=>imageOp(p,id,'delete')};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProfileStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
