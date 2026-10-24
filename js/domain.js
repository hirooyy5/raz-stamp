// 日付・スタンプ集計などの純粋ロジック（DOM や IndexedDB に依存しない）

export const BACKUP_APP_ID = 'raz-stamp';
export const BACKUP_VERSION = 2; // v2: アイテム（おくすり）の記録を追加

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

/** あとから押印できるのは過去何日までか（自由に埋められるとおくすりの意味がなくなるため制限する） */
export const BACKFILL_DAYS = 3;

/** 押印できるのは今日と、過去 BACKFILL_DAYS 日以内 */
export function canStamp(key, todayKey) {
  return isValidDateKey(key) && key <= todayKey && key >= addDays(todayKey, -BACKFILL_DAYS);
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

/** 祝福画面で「次の目標」として見せる連続日数の節目 */
export const STREAK_MILESTONES = [3, 7, 14, 21, 30, 50, 100, 150, 200, 365];

export function isMilestone(n) {
  return STREAK_MILESTONES.includes(n) || (n > 365 && n % 100 === 0);
}

export function nextMilestone(n) {
  return STREAK_MILESTONES.find((m) => m > n) ?? (Math.floor(n / 100) + 1) * 100;
}

export function streakMessage(n) {
  if (n >= 365) return '1年連続！ 本当に本当にすごい！';
  if (n >= 100) return '100日以上連続！ 英語が毎日の習慣になったね！';
  if (n >= 30) return '1か月以上連続！ 英語の力がしっかり身についてきてる！';
  if (n >= 14) return '2週間以上連続！ もう立派な習慣だね！';
  if (n >= 7) return '1週間以上連続！ すごい！';
  if (n >= 3) return '3日坊主クリア！ この調子で続けよう！';
  return 'いい調子！ 明日も続けよう！';
}

// ---- アイテム（おくすり）----
// おくすり: 連続記録が1日だけ途切れたとき、その日を救済して連続をつなぐアイテム

/** 連続日数がこの倍数に達するたびに1個もらえる */
export const ITEM_EVERY = 5;
/** 持てる上限 */
export const ITEM_MAX = 2;
/** 空いた日から何日後まで使えるか（2 = 翌々日まで） */
export const RESCUE_DEADLINE_DAYS = 2;

export const isRescue = (record) => record?.kind === 'rescue';

/** 台帳（grant / use）から今の所持数を計算する */
export function itemCount(events) {
  let n = 0;
  for (const e of events) n += e.type === 'grant' ? 1 : e.type === 'use' ? -1 : 0;
  return Math.max(0, Math.min(ITEM_MAX, n));
}

/** 連続日数が before → after に伸びたときに通過した ITEM_EVERY の倍数 */
export function milestonesCrossed(before, after) {
  const out = [];
  for (let m = (Math.floor(before / ITEM_EVERY) + 1) * ITEM_EVERY; m <= after; m += ITEM_EVERY) out.push(m);
  return out;
}

/** 次のおくすりまであと何日か */
export function daysToNextItem(streak) {
  return ITEM_EVERY - (streak % ITEM_EVERY);
}

/**
 * その日におくすりを使えるか。stamps は date → record の Map。
 * 使えるのは「前の日が学習スタンプ」で「1日だけ空いている」日を、期限内に救済する場合のみ。
 */
export function rescueCheck(dateKey, todayKey, stamps, count) {
  if (stamps.has(dateKey)) return { ok: false, reason: 'この日はもうスタンプがあります' };
  if (dateKey >= todayKey) return { ok: false, reason: '今日より前の日にだけ使えます' };
  if (dateKey < addDays(todayKey, -RESCUE_DEADLINE_DAYS)) {
    return { ok: false, reason: '使える期限（空いた日の翌々日まで）が過ぎています' };
  }
  const prev = stamps.get(addDays(dateKey, -1));
  if (!prev) return { ok: false, reason: '前の日もスタンプがないので、つなげる連続記録がありません' };
  const nextKey = addDays(dateKey, 1);
  const next = stamps.get(nextKey);
  if (isRescue(prev) || isRescue(next)) return { ok: false, reason: 'おくすりは2日続けて使えません' };
  if (!next && nextKey !== todayKey) return { ok: false, reason: '2日以上空いているので使えません' };
  if (count <= 0) return { ok: false, reason: 'おくすりを持っていません' };
  return { ok: true, reason: '' };
}

/** ホーム画面でお知らせする救済候補の日（新しい日を優先）。なければ null */
export function rescueCandidate(todayKey, stamps, count) {
  for (let i = 1; i <= RESCUE_DEADLINE_DAYS; i++) {
    const key = addDays(todayKey, -i);
    if (rescueCheck(key, todayKey, stamps, count).ok) return key;
  }
  return null;
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
  if (obj.version !== 1 && obj.version !== BACKUP_VERSION) throw new Error(`未対応のバージョンです（version: ${obj.version}）`);
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
      kind: s.kind === 'rescue' ? 'rescue' : 'study',
    };
  });

  const itemEvents = (Array.isArray(obj.itemEvents) ? obj.itemEvents : []).map((e) => {
    if (!e || typeof e.id !== 'string' || !ids.has(e.profileId) || !['grant', 'use'].includes(e.type)
      || !isValidDateKey(e.date) || Number.isNaN(Date.parse(e.at))) {
      throw new Error('アイテムのデータが正しくありません');
    }
    return { id: e.id, profileId: e.profileId, type: e.type, date: e.date, at: e.at, milestone: Number(e.milestone) || null };
  });
  return { profiles, stamps, itemEvents };
}

/** インポートの差分を計算する。同じプロフィール ID・同じ日付は既存データを優先する */
export function planImport(existingProfiles, existingStamps, incoming, existingEvents = []) {
  const profileIds = new Set(existingProfiles.map((p) => p.id));
  const stampKeys = new Set(existingStamps.map((s) => `${s.profileId}|${s.date}`));
  const eventIds = new Set(existingEvents.map((e) => e.id));
  return {
    profiles: incoming.profiles.filter((p) => !profileIds.has(p.id)),
    stamps: incoming.stamps.filter((s) => !stampKeys.has(`${s.profileId}|${s.date}`)),
    itemEvents: (incoming.itemEvents ?? []).filter((e) => !eventIds.has(e.id)),
  };
}
