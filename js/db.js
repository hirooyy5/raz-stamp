// IndexedDB リポジトリ。データは端末内だけに保存し、外部には送信しない。

const DB_NAME = 'raz-stamp';
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('profiles', { keyPath: 'id' });
      // 主キーを [profileId, date] にして「1人1日1スタンプ」を構造的に保証する
      const stamps = db.createObjectStore('stamps', { keyPath: ['profileId', 'date'] });
      stamps.createIndex('byProfile', 'profileId');
      db.createObjectStore('settings');
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

/** プロフィールとそのスタンプをまとめて削除 */
export const deleteProfile = (id) =>
  tx(['profiles', 'stamps'], 'readwrite', async (s) => {
    s.profiles.delete(id);
    const keys = await reqToPromise(s.stamps.index('byProfile').getAllKeys(id));
    keys.forEach((k) => s.stamps.delete(k));
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

// ---- settings ----
export const getSetting = (key) => tx('settings', 'readonly', (s) => reqToPromise(s.settings.get(key)));
export const setSetting = (key, value) => tx('settings', 'readwrite', (s) => reqToPromise(s.settings.put(value, key)));

// ---- backup ----
export const importData = ({ profiles, stamps }) =>
  tx(['profiles', 'stamps'], 'readwrite', (s) => {
    profiles.forEach((p) => s.profiles.put(p));
    stamps.forEach((st) => s.stamps.put(st));
  });

export const clearAll = () =>
  tx(['profiles', 'stamps', 'settings'], 'readwrite', (s) => {
    s.profiles.clear();
    s.stamps.clear();
    s.settings.clear();
  });
