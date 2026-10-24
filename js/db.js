// IndexedDB リポジトリ。データは端末内だけに保存し、外部には送信しない。

const DB_NAME = 'raz-stamp';
const DB_VERSION = 2; // v2: itemEvents ストアを追加

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (e.oldVersion < 1) {
        db.createObjectStore('profiles', { keyPath: 'id' });
        // 主キーを [profileId, date] にして「1人1日1スタンプ」を構造的に保証する
        const stamps = db.createObjectStore('stamps', { keyPath: ['profileId', 'date'] });
        stamps.createIndex('byProfile', 'profileId');
        db.createObjectStore('settings');
      }
      if (e.oldVersion < 2) {
        // おくすりの獲得（grant）・使用（use）の台帳。所持数はここから計算する
        const events = db.createObjectStore('itemEvents', { keyPath: 'id' });
        events.createIndex('byProfile', 'profileId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const reqToPromise = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/** ストアを開いて fn(stores) を実行し、トランザクション完了まで待つ */
async function tx(storeNames, mode, fn) {
  const db = await openDb();
  const t = db.transaction(storeNames, mode);
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  const stores = Object.fromEntries(names.map((n) => [n, t.objectStore(n)]));
  // 完了待ちは fn より先に仕掛ける（fn の途中でトランザクションが終わっても取りこぼさない）
  const done = new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('transaction aborted'));
  });
  const result = await fn(stores);
  await done;
  return result;
}

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    // 永続化できなくても動作は続ける
  }
}

// ---- profiles ----
export const listProfiles = () => tx('profiles', 'readonly', (s) => reqToPromise(s.profiles.getAll()));
export const putProfile = (profile) => tx('profiles', 'readwrite', (s) => reqToPromise(s.profiles.put(profile)));

/** プロフィールとそのスタンプ・アイテムをまとめて削除 */
export const deleteProfile = (id) =>
  tx(['profiles', 'stamps', 'itemEvents'], 'readwrite', async (s) => {
    s.profiles.delete(id);
    const keys = await reqToPromise(s.stamps.index('byProfile').getAllKeys(id));
    keys.forEach((k) => s.stamps.delete(k));
    const eventKeys = await reqToPromise(s.itemEvents.index('byProfile').getAllKeys(id));
    eventKeys.forEach((k) => s.itemEvents.delete(k));
  });

// ---- stamps ----
export const listStamps = (profileId) =>
  tx('stamps', 'readonly', (s) => reqToPromise(s.stamps.index('byProfile').getAll(profileId)));
export const listAllStamps = () => tx('stamps', 'readonly', (s) => reqToPromise(s.stamps.getAll()));

/** スタンプを追加。同じ日にすでにあれば false を返す（上書きしない） */
export const addStamp = (stamp) =>
  tx('stamps', 'readwrite', async (s) => {
    const existing = await reqToPromise(s.stamps.get([stamp.profileId, stamp.date]));
    if (existing) return false;
    s.stamps.add(stamp);
    return true;
  });

export const updateStamp = (stamp) => tx('stamps', 'readwrite', (s) => reqToPromise(s.stamps.put(stamp)));
export const deleteStamp = (profileId, date) =>
  tx('stamps', 'readwrite', (s) => reqToPromise(s.stamps.delete([profileId, date])));

// ---- item events ----
export const listAllItemEvents = () => tx('itemEvents', 'readonly', (s) => reqToPromise(s.itemEvents.getAll()));

/** おくすりで救済: 救済スタンプの追加と「使用」記録を同じトランザクションで行う */
export const addRescue = (stamp, useEvent) =>
  tx(['stamps', 'itemEvents'], 'readwrite', async (s) => {
    const existing = await reqToPromise(s.stamps.get([stamp.profileId, stamp.date]));
    if (existing) return false;
    s.stamps.add(stamp);
    s.itemEvents.add(useEvent);
    return true;
  });

export const addItemEvents = (events) =>
  tx('itemEvents', 'readwrite', (s) => { events.forEach((e) => s.itemEvents.add(e)); });

export const deleteItemEvents = (ids) =>
  tx('itemEvents', 'readwrite', (s) => { ids.forEach((id) => s.itemEvents.delete(id)); });

// ---- settings ----
export const getSetting = (key) => tx('settings', 'readonly', (s) => reqToPromise(s.settings.get(key)));
export const setSetting = (key, value) => tx('settings', 'readwrite', (s) => reqToPromise(s.settings.put(value, key)));

// ---- backup ----
export const importData = ({ profiles, stamps, itemEvents = [] }) =>
  tx(['profiles', 'stamps', 'itemEvents'], 'readwrite', (s) => {
    profiles.forEach((p) => s.profiles.put(p));
    stamps.forEach((st) => s.stamps.put(st));
    itemEvents.forEach((e) => s.itemEvents.put(e));
  });

export const clearAll = () =>
  tx(['profiles', 'stamps', 'settings', 'itemEvents'], 'readwrite', (s) => {
    s.profiles.clear();
    s.stamps.clear();
    s.settings.clear();
    s.itemEvents.clear();
  });
