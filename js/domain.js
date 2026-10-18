// 日付・スタンプ集計などの純粋ロジック（DOM や IndexedDB に依存しない）

export const BACKUP_APP_ID = 'raz-stamp';
export const BACKUP_VERSION = 1;

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const pad = (n) => String(n).padStart(2, '0');

/** Date → "YYYY-MM-DD"（端末のローカル日付） */
export function toDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "YYYY-MM-DD" → ローカル時刻 0:00 の Date */
export function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isValidDateKey(key) {
  if (typeof key !== 'string' || !DATE_KEY_RE.test(key)) return false;
  return toDateKey(parseDateKey(key)) === key;
}

export function addDays(key, n) {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

/** 押印できるのは今日以前の日付のみ */
export function canStamp(key, todayKey) {
  return isValidDateKey(key) && key <= todayKey;
}

export function formatDateJa(key) {
  const d = parseDateKey(key);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`;
}

export function formatTimeJa(iso) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 現在の連続日数。今日がまだ未押印なら昨日から数える
 * （夜に学習する子でも、朝の時点で連続が 0 に見えないようにするため）。
 */
export function calcCurrentStreak(dateKeys, todayKey) {
  const set = new Set(dateKeys);
  let cursor = set.has(todayKey) ? todayKey : addDays(todayKey, -1);
  let count = 0;
  while (set.has(cursor)) {
    count++;
    cursor = addDays(cursor, -1);
  }
  return count;
}

export function calcBestStreak(dateKeys) {
  const sorted = [...new Set(dateKeys)].sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const key of sorted) {
    run = prev && addDays(prev, 1) === key ? run + 1 : 1;
    best = Math.max(best, run);
    prev = key;
  }
  return best;
}

/** 日曜始まりの月カレンダー。前後の空きマスは null */
export function monthGrid(year, month) {
  const first = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells = Array(first.getDay()).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${year}-${pad(month)}-${pad(d)}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** 月の達成日数と、その月の「対象日数」（今月なら今日まで、未来の月は 0） */
export function monthStats(dateKeys, year, month, todayKey) {
  const prefix = `${year}-${pad(month)}-`;
  const count = dateKeys.filter((k) => k.startsWith(prefix)).length;
  const daysInMonth = new Date(year, month, 0).getDate();
  const lastKey = `${prefix}${pad(daysInMonth)}`;
  const firstKey = `${prefix}01`;
  let elapsed;
  if (todayKey < firstKey) elapsed = 0;
  else if (todayKey > lastKey) elapsed = daysInMonth;
  else elapsed = parseDateKey(todayKey).getDate();
  return { count, elapsed, daysInMonth };
}

export function shiftMonth(year, month, delta) {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** バックアップ JSON を検証し、正規化したデータを返す。不正なら Error を投げる */
export function parseBackup(obj) {
  if (!obj || obj.app !== BACKUP_APP_ID) throw new Error('このアプリのバックアップファイルではありません');
  if (obj.version !== BACKUP_VERSION) throw new Error(`未対応のバージョンです（version: ${obj.version}）`);
  if (!Array.isArray(obj.profiles) || !Array.isArray(obj.stamps)) throw new Error('ファイルの形式が正しくありません');

  const profiles = obj.profiles.map((p) => {
    if (!p || typeof p.id !== 'string' || typeof p.name !== 'string' || !p.name.trim()) {
      throw new Error('プロフィールのデータが正しくありません');
    }
    return { id: p.id, name: p.name.trim().slice(0, 20), emoji: String(p.emoji || '⭐'), color: String(p.color || '#e4572e') };
  });
  const ids = new Set(profiles.map((p) => p.id));

  const stamps = obj.stamps.map((s) => {
    if (!s || !ids.has(s.profileId) || !isValidDateKey(s.date) || Number.isNaN(Date.parse(s.stampedAt))) {
      throw new Error('スタンプのデータが正しくありません');
    }
    return {
      profileId: s.profileId,
      date: s.date,
      stampedAt: s.stampedAt,
      backfilled: Boolean(s.backfilled),
      memo: typeof s.memo === 'string' ? s.memo.slice(0, 200) : '',
      stampType: typeof s.stampType === 'string' ? s.stampType.slice(0, 32) : null,
    };
  });
  return { profiles, stamps };
}

/** インポートの差分を計算する。同じプロフィール ID・同じ日付は既存データを優先する */
export function planImport(existingProfiles, existingStamps, incoming) {
  const profileIds = new Set(existingProfiles.map((p) => p.id));
  const stampKeys = new Set(existingStamps.map((s) => `${s.profileId}|${s.date}`));
  return {
    profiles: incoming.profiles.filter((p) => !profileIds.has(p.id)),
    stamps: incoming.stamps.filter((s) => !stampKeys.has(`${s.profileId}|${s.date}`)),
  };
}
