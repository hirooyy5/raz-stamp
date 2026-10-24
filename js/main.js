import * as db from './db.js';
import {
  toDateKey, canStamp, formatDateJa, formatTimeJa, parseDateKey,
  calcCurrentStreak, calcBestStreak, monthGrid, monthStats, shiftMonth,
  parseBackup, planImport, BACKUP_APP_ID, BACKUP_VERSION,
  addDays, isMilestone, nextMilestone, streakMessage,
  isRescue, itemCount, milestonesCrossed, daysToNextItem, rescueCheck, rescueCandidate,
  ITEM_MAX, ITEM_EVERY, BACKFILL_DAYS,
} from './domain.js';
import {
  STAMP_DESIGNS, DEFAULT_STAMP, getDesign, stampSvg, capsuleSvg, rescueStampSvg, RESCUE_COLOR,
} from './stamps.js';

const RAZ_KIDS_URL = 'https://www.raz-kids.com/';
const EMOJIS = ['⭐', '🌸', '🚀', '🐱', '🐶', '🏆', '⚽', '🎵', '📚', '🌈', '🍀', '🔥'];
const COLORS = ['#e4572e', '#d53f8c', '#805ad5', '#2b6cb0', '#2c9a6a', '#d69e2e'];
const UNDO_MS = 6000;

const state = {
  profiles: [],
  activeId: null,
  stamps: new Map(), // date -> stamp（選択中プロフィールのみ）
  view: null,        // { year, month }
  tab: 'home',
  selectedType: DEFAULT_STAMP, // 選択中プロフィールが次に押すスタンプ
  itemEvents: [],    // 全員分のおくすり台帳
  rescueDismissed: null, // 「使わない」を選んだ救済候補の日
};

const $ = (sel) => document.querySelector(sel);
const today = () => toDateKey(new Date());
const activeProfile = () => state.profiles.find((p) => p.id === state.activeId);
const itemsOf = (profileId) => itemCount(state.itemEvents.filter((e) => e.profileId === profileId));
/** 連続日数用: 救済した日も含む全スタンプの日付 */
const allKeys = () => [...state.stamps.keys()];
/** 達成日数用: 学習した日だけ */
const studyKeys = () => [...state.stamps.values()].filter((r) => !isRescue(r)).map((r) => r.date);
const shortDate = (key) => `${parseDateKey(key).getMonth() + 1}/${parseDateKey(key).getDate()}`;

/** 小さな要素生成ヘルパー。文字列は textContent として入るので名前やメモが HTML として解釈されない */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') Object.entries(v).forEach(([sk, sv]) => el.style.setProperty(sk, sv));
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

/** 日付ごとに少しだけ傾きを変えて、手で押したような見た目にする */
function rotationFor(dateKey) {
  let n = 0;
  for (const ch of dateKey) n = (n * 31 + ch.charCodeAt(0)) % 997;
  return `${(n % 25) - 12}deg`;
}

/** 押したスタンプの表示。デザイン指定のない古い記録はプロフィールの絵文字で表示する */
function stampEl(profile, record, extraClass = '') {
  if (isRescue(record)) {
    return h('span', {
      class: `stamp design rescue ${extraClass}`.trim(),
      style: { '--ink': RESCUE_COLOR, '--rot': rotationFor(record.date) },
      title: 'おくすりで救済',
    }, rescueStampSvg());
  }
  const design = getDesign(record.stampType);
  if (design) {
    return h('span', {
      class: `stamp design ${extraClass}`.trim(),
      style: { '--ink': design.color, '--rot': rotationFor(record.date) },
      title: design.name,
    }, stampSvg(design.id));
  }
  return h('span', {
    class: `stamp ${extraClass}`.trim(),
    style: { '--c': profile.color, '--rot': rotationFor(record.date) },
    'aria-hidden': 'true',
  }, profile.emoji);
}

/** スタンプ選択ボタンの並び。選ぶたびに onChange(id) を呼ぶ */
function stampPicker(selected, onChange) {
  const wrap = h('div', { class: 'picker', role: 'radiogroup', 'aria-label': 'スタンプを選ぶ' });
  const draw = (sel) => wrap.replaceChildren(...STAMP_DESIGNS.map((d) =>
    h('button', {
      type: 'button',
      class: `pick ${d.id === sel ? 'is-selected' : ''}`,
      role: 'radio',
      'aria-checked': String(d.id === sel),
      style: { '--ink': d.color },
      onclick: () => { draw(d.id); onChange(d.id); },
    }, stampSvg(d.id), h('span', {}, d.name))));
  draw(selected);
  return wrap;
}

/** おくすりのスロット（上限ぶん並べ、持っている数だけカプセルを入れる） */
function itemSlots(count) {
  return h('div', { class: 'slots', 'aria-label': `おくすり ${count} / ${ITEM_MAX}` },
    Array.from({ length: ITEM_MAX }, (_, i) =>
      h('span', { class: `slot ${i < count ? 'filled' : ''}` }, i < count && capsuleSvg())));
}

/** 今日カードの「もちもの」欄 */
function itemShelf(profile, streak) {
  const n = itemsOf(profile.id);
  const left = daysToNextItem(streak);
  const done = ITEM_EVERY - left;
  return h('section', { class: 'items', 'aria-label': 'もちもの' },
    h('div', { class: 'items-head' },
      h('span', { class: 'items-title' }, 'もちもの'),
      h('span', { class: 'muted small' }, `おくすり ${n} / ${ITEM_MAX}`)),
    h('div', { class: 'items-body' },
      itemSlots(n),
      h('div', { class: 'items-next' },
        n >= ITEM_MAX
          ? h('p', {}, 'いっぱい！ 使うと また もらえるよ')
          : [
              h('div', { class: 'segbar', 'aria-hidden': 'true' },
                Array.from({ length: ITEM_EVERY }, (_, i) => h('span', { class: i < done ? 'on' : '' }))),
              h('p', {}, '次のおくすりまで あと ', h('strong', {}, left), ' 日'),
            ]),
    ),
    h('p', { class: 'items-help' }, `${ITEM_EVERY}日連続ごとに1個もらえる。1日だけ空いた日を救済して連続記録を守れるよ（翌々日まで）`),
  );
}

// ============================================================
// データ読み込み
// ============================================================
async function loadProfiles() {
  state.profiles = (await db.listProfiles()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const saved = await db.getSetting('activeProfileId');
  state.activeId = state.profiles.some((p) => p.id === saved) ? saved : state.profiles[0]?.id ?? null;
}

async function loadStamps() {
  state.stamps = new Map();
  if (!state.activeId) {
    state.itemEvents = await db.listAllItemEvents();
    return;
  }
  for (const s of await db.listStamps(state.activeId)) state.stamps.set(s.date, s);
  const saved = await db.getSetting(`stampType:${state.activeId}`);
  state.selectedType = getDesign(saved) ? saved : DEFAULT_STAMP;
  state.rescueDismissed = await db.getSetting(`rescueDismissed:${state.activeId}`) ?? null;
  state.itemEvents = await db.listAllItemEvents();
}

async function selectStampType(id) {
  state.selectedType = id;
  await db.setSetting(`stampType:${state.activeId}`, id);
}

async function switchProfile(id) {
  state.activeId = id;
  await db.setSetting('activeProfileId', id);
  await loadStamps();
  render();
}

// ============================================================
// スタンプ操作
// ============================================================
async function stamp(dateKey, memo = '', stampType = state.selectedType) {
  const profile = activeProfile();
  if (!profile || !canStamp(dateKey, today())) return false;
  const record = {
    profileId: profile.id,
    date: dateKey,
    stampedAt: new Date().toISOString(),
    backfilled: dateKey !== today(),
    memo: memo.trim().slice(0, 200),
    stampType,
  };
  const before = allKeys();
  const ok = await db.addStamp(record);
  if (!ok) {
    showToast('この日はもう押してあります');
    return false;
  }
  state.stamps.set(dateKey, record);
  render({ popDate: dateKey });
  const beforeStreak = calcCurrentStreak(before, today());
  const streak = calcCurrentStreak(allKeys(), today());
  // 学習スタンプで連続が 5 の倍数に達したらおくすりを付与（救済では付与しない）
  const grant = await grantItems(profile, dateKey, milestonesCrossed(beforeStreak, streak));
  if (grant.granted) render();
  // 今回の押印で連続が伸びた（2日以上）ときだけ祝福する。あとから押印して連続がつながった場合も含む
  if (streak >= 2 && streak > beforeStreak) {
    setTimeout(() => celebrate(profile, streak, calcBestStreak(before), grant), 500);
  }
  showToast(`${formatDateJa(dateKey)} に「${getDesign(stampType)?.name ?? 'スタンプ'}」を押しました`, {
    label: '元に戻す',
    onClick: () => removeStamp(dateKey, { silent: true }),
  });
  return true;
}

async function grantItems(profile, dateKey, milestones) {
  let have = itemsOf(profile.id);
  const events = [];
  let full = false;
  for (const m of milestones) {
    if (have >= ITEM_MAX) {
      full = true;
      continue;
    }
    events.push({ id: crypto.randomUUID(), profileId: profile.id, type: 'grant', date: dateKey, at: new Date().toISOString(), milestone: m });
    have++;
  }
  if (events.length) {
    await db.addItemEvents(events);
    state.itemEvents.push(...events);
  }
  return { granted: events.length, full, milestones };
}

async function removeStamp(dateKey, { silent = false } = {}) {
  closeCelebration();
  const record = state.stamps.get(dateKey);
  await db.deleteStamp(state.activeId, dateKey);
  state.stamps.delete(dateKey);

  // 救済を取り消したらおくすりを戻す。学習スタンプを取り消したら、その日にもらったおくすりを（未使用の分だけ）回収する
  const mine = state.itemEvents.filter((e) => e.profileId === state.activeId && e.date === dateKey);
  let revoke = [];
  if (isRescue(record)) {
    revoke = mine.filter((e) => e.type === 'use');
  } else {
    const grants = mine.filter((e) => e.type === 'grant');
    revoke = grants.slice(0, Math.min(grants.length, itemsOf(state.activeId)));
  }
  if (revoke.length) {
    const ids = revoke.map((e) => e.id);
    await db.deleteItemEvents(ids);
    state.itemEvents = state.itemEvents.filter((e) => !ids.includes(e.id));
  }
  render();
  if (!silent) showToast(isRescue(record) ? '救済を取り消しました。おくすりは戻りました' : 'スタンプを取り消しました');
}

/** おくすりを使って、1日だけ空いた日を救済する */
async function rescue(dateKey) {
  const profile = activeProfile();
  const t = today();
  const check = rescueCheck(dateKey, t, state.stamps, itemsOf(profile.id));
  if (!check.ok) {
    showToast(check.reason);
    return;
  }
  const now = new Date().toISOString();
  const record = { profileId: profile.id, date: dateKey, stampedAt: now, backfilled: true, memo: '', stampType: null, kind: 'rescue' };
  const use = { id: crypto.randomUUID(), profileId: profile.id, type: 'use', date: dateKey, at: now };
  if (!(await db.addRescue(record, use))) {
    showToast('この日はもうスタンプがあります');
    return;
  }
  state.stamps.set(dateKey, record);
  state.itemEvents.push(use);
  render({ popDate: dateKey });
  const streak = calcCurrentStreak(allKeys(), t);
  showToast(`おくすりで ${shortDate(dateKey)} を救済！ ${streak}日連続がつながりました`, {
    label: '元に戻す',
    onClick: () => removeStamp(dateKey, { silent: true }),
  });
}

async function dismissRescue(dateKey) {
  state.rescueDismissed = dateKey;
  await db.setSetting(`rescueDismissed:${state.activeId}`, dateKey);
  renderToday();
}

async function saveStampDetails(dateKey, { memo, stampType }) {
  const record = state.stamps.get(dateKey);
  if (!record) return;
  const updated = { ...record, memo: memo.trim().slice(0, 200), stampType: stampType ?? record.stampType };
  await db.updateStamp(updated);
  state.stamps.set(dateKey, updated);
  render();
}

// ============================================================
// 描画
// ============================================================
function render(opts = {}) {
  document.documentElement.style.setProperty('--accent', activeProfile()?.color ?? '#e4572e');
  renderProfiles();
  if (state.tab === 'home') {
    renderToday(opts);
    renderCalendar(opts);
  } else if (state.tab === 'history') {
    renderHistory();
  } else {
    renderSettings();
  }
}

function renderProfiles() {
  $('#profiles').replaceChildren(
    ...state.profiles.map((p) =>
      h('button', {
        class: `chip ${p.id === state.activeId ? 'is-active' : ''}`,
        style: { '--c': p.color },
        'aria-pressed': String(p.id === state.activeId),
        onclick: () => p.id !== state.activeId && switchProfile(p.id),
      },
        h('span', { 'aria-hidden': 'true' }, p.emoji), p.name,
        itemsOf(p.id) > 0 && h('span', { class: 'chip-items', title: `おくすり ${itemsOf(p.id)}個` },
          capsuleSvg(), itemsOf(p.id)),
      ),
    ),
    h('button', { class: 'chip chip-add', onclick: () => openProfileDialog() }, '＋ 追加'),
  );
}

function renderToday({ popDate } = {}) {
  const profile = activeProfile();
  const box = $('#today');
  if (!profile) {
    box.replaceChildren(h('p', { class: 'empty' }, '「＋ 追加」から使う人を登録してください'));
    return;
  }
  const t = today();
  const record = state.stamps.get(t);
  const keys = allKeys();
  const streak = calcCurrentStreak(keys, t);
  const { count, elapsed } = monthStats(studyKeys(), ...t.split('-').slice(0, 2).map(Number), t);
  const candidate = rescueCandidate(t, state.stamps, itemsOf(profile.id));
  const banner = candidate && candidate !== state.rescueDismissed && h('div', { class: 'rescue-banner', role: 'alert' },
    h('span', { class: 'rb-icon', 'aria-hidden': 'true' }, capsuleSvg()),
    h('div', { class: 'rb-body' },
      h('strong', {}, `${formatDateJa(candidate)} のスタンプがありません`),
      h('p', {}, `おくすりを使うと、${calcCurrentStreak([...keys, candidate], t)}日連続がつながります`)),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-rescue', onclick: () => rescue(candidate) }, 'おくすりを使う'),
      h('button', { class: 'btn', onclick: () => dismissRescue(candidate) }, '使わない')),
  );

  const main = record
    ? h('div', { class: 'today-done' },
        stampEl(profile, record, popDate === t ? 'pop' : ''),
        h('p', { class: 'today-done-text' }, '今日の学習 おつかれさま！'),
        h('p', { class: 'muted small' }, `${formatTimeJa(record.stampedAt)} に押しました`),
        h('button', { class: 'btn', onclick: () => openDayDialog(t) }, record.memo ? '📝 メモを見る・編集' : '📝 メモを書く'),
      )
    : h('div', {},
        h('p', { class: 'picker-label' }, '今日のスタンプを選ぼう'),
        stampPicker(state.selectedType, async (id) => { await selectStampType(id); renderToday(); }),
        h('button', {
          class: 'stamp-button',
          style: { '--accent': getDesign(state.selectedType).color },
          onclick: () => stamp(t),
        },
          h('span', { class: 'preview', 'aria-hidden': 'true' }, stampSvg(state.selectedType)),
          '学習完了！',
          h('span', { class: 'small' }, 'タップしてスタンプ'),
        ),
      );

  box.replaceChildren(
    h('p', { class: 'today-who' }, `${profile.name} さんの今日の学習`),
    h('p', { class: 'today-date' }, formatDateJa(t)),
    ...(banner ? [banner] : []), // replaceChildren は null を文字列にしてしまうため
    main,
    h('div', { class: 'stats' },
      statEl(streak, '日', '連続'),
      statEl(count, `/${elapsed}日`, '今月'),
      statEl(calcBestStreak(keys), '日', '最高連続'),
    ),
    itemShelf(profile, streak),
    h('a', { class: 'btn btn-block', href: RAZ_KIDS_URL, target: '_blank', rel: 'noopener noreferrer' }, '📖 Raz-Kids を開く'),
  );
}

function statEl(num, unit, label) {
  return h('div', { class: 'stat' },
    h('div', { class: 'stat-num' }, num, h('small', {}, unit)),
    h('div', { class: 'stat-label' }, label),
  );
}

function renderCalendar({ popDate } = {}) {
  const profile = activeProfile();
  const box = $('#calendar');
  if (!profile) {
    box.replaceChildren();
    return;
  }
  const t = today();
  const { year, month } = state.view;
  const { count, elapsed, daysInMonth } = monthStats(studyKeys(), year, month, t);
  const isCurrentMonth = t.startsWith(`${year}-${String(month).padStart(2, '0')}`);

  const go = (delta) => {
    state.view = shiftMonth(year, month, delta);
    renderCalendar();
  };

  const dows = ['日', '月', '火', '水', '木', '金', '土'].map((d, i) =>
    h('div', { class: `cal-dow ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}` }, d));

  const cells = monthGrid(year, month).flat().map((key, i) => {
    if (!key) return h('div', { class: 'cal-day is-empty', 'aria-hidden': 'true' });
    const record = state.stamps.get(key);
    const future = key > t;
    const dow = i % 7;
    const day = parseDateKey(key).getDate();
    const cls = ['cal-day', dow === 0 && 'sun', dow === 6 && 'sat', key === t && 'is-today', future && 'is-future']
      .filter(Boolean).join(' ');
    const label = `${month}月${day}日 ${isRescue(record) ? 'おくすりで救済' : record ? 'スタンプあり' : future ? '' : 'スタンプなし'}`;
    return h('button', { class: cls, disabled: future, 'aria-label': label, onclick: () => openDayDialog(key) },
      h('span', { class: 'num' }, day),
      record && stampEl(profile, record, popDate === key ? 'pop' : ''),
      record?.backfilled && !isRescue(record) && h('span', { class: 'backfill-mark', title: 'あとから押印' }, '後'),
    );
  });

  box.replaceChildren(
    h('div', { class: 'cal-head' },
      h('button', { class: 'btn cal-nav', 'aria-label': '前の月', onclick: () => go(-1) }, '◀'),
      h('h2', { class: 'cal-title' }, `${year}年 ${month}月`),
      h('button', { class: 'btn cal-nav', 'aria-label': '次の月', onclick: () => go(1) }, '▶'),
    ),
    h('p', { class: 'cal-summary' },
      'この月の達成 ', h('strong', {}, count), ` / ${isCurrentMonth ? `${elapsed}日（今日まで）` : `${daysInMonth}日`}`,
      !isCurrentMonth && ' ',
      !isCurrentMonth && h('button', {
        class: 'btn small',
        style: { 'min-height': '36px', padding: '4px 12px' },
        onclick: () => { state.view = viewOf(t); renderCalendar(); },
      }, '今月に戻る'),
    ),
    h('div', { class: 'cal-grid' }, dows, cells),
    h('div', { class: 'legend' },
      h('span', {}, '🟧 枠 = 今日'),
      h('span', {}, '「後」= あとから押したスタンプ'),
      h('span', {}, '点線の SAFE! = おくすりで救済した日（達成日数には数えません）'),
      h('span', {}, `日付をタップすると、押し忘れの記録（${BACKFILL_DAYS}日前まで）やおくすりの使用ができます`),
    ),
  );
}

function renderHistory() {
  const profile = activeProfile();
  const box = $('#history');
  if (!profile) {
    box.replaceChildren(h('p', { class: 'empty' }, '使う人が登録されていません'));
    return;
  }
  const records = [...state.stamps.values()].sort((a, b) => b.date.localeCompare(a.date));
  if (!records.length) {
    box.replaceChildren(h('h2', {}, `${profile.name} さんの押印履歴`), h('p', { class: 'empty' }, 'まだスタンプがありません'));
    return;
  }
  const byMonth = new Map();
  for (const r of records) {
    const ym = r.date.slice(0, 7);
    if (!byMonth.has(ym)) byMonth.set(ym, []);
    byMonth.get(ym).push(r);
  }
  const ledger = state.itemEvents.filter((e) => e.profileId === profile.id).sort((a, b) => b.at.localeCompare(a.at));
  box.replaceChildren(
    h('h2', {}, `${profile.name} さんの押印履歴（学習 ${studyKeys().length} 日）`),
    ...[...byMonth].map(([ym, list]) => {
      const [y, m] = ym.split('-').map(Number);
      return h('section', { class: 'hist-month' },
        h('h3', {}, h('span', {}, `${y}年 ${m}月`), h('span', { class: 'muted' },
          `学習 ${list.filter((r) => !isRescue(r)).length} 日`,
          list.some(isRescue) && ` ／ 救済 ${list.filter(isRescue).length} 日`)),
        h('ul', { class: 'hist-list' }, list.map((r) =>
          h('li', {}, h('button', { class: 'hist-item', onclick: () => openDayDialog(r.date) },
            stampEl(profile, r),
            h('div', { class: 'hist-main' },
              h('div', { class: 'hist-date' }, formatDateJa(r.date),
                isRescue(r) ? h('span', { class: 'tag tag-rescue' }, 'おくすりで救済')
                  : r.backfilled && h('span', { class: 'tag' }, 'あとから押印')),
              h('div', { class: 'hist-meta' }, `${isRescue(r) ? '使った' : '押した'}日時: ${formatStampedAt(r.stampedAt)}`),
              r.memo && h('div', { class: 'hist-memo' }, `📝 ${r.memo}`),
            ),
          )),
        )),
      );
    }),
    ...(ledger.length ? [h('section', { class: 'hist-month' },
      h('h3', {}, h('span', {}, 'おくすりの記録'), h('span', { class: 'muted' }, `いま ${itemsOf(profile.id)} / ${ITEM_MAX} 個`)),
      h('ul', { class: 'hist-list' }, ledger.map((e) =>
        h('li', { class: 'hist-item' },
          h('span', { class: `ledger-icon ${e.type}` }, capsuleSvg()),
          h('div', { class: 'hist-main' },
            h('div', { class: 'hist-date' }, e.type === 'grant'
              ? `＋1 ゲット（${e.milestone ?? ITEM_EVERY}日連続）`
              : `−1 使用（${formatDateJa(e.date)} を救済）`),
            h('div', { class: 'hist-meta' }, formatStampedAt(e.at)),
          )))))] : []),
  );
}

function formatStampedAt(iso) {
  return `${formatDateJa(toDateKey(new Date(iso)))} ${formatTimeJa(iso)}`;
}

function renderSettings() {
  const counts = new Map();
  const box = $('#settings');
  box.replaceChildren(h('p', { class: 'muted' }, '読み込み中…'));
  db.listAllStamps().then((all) => {
    all.filter((s) => !isRescue(s)).forEach((s) => counts.set(s.profileId, (counts.get(s.profileId) ?? 0) + 1));
    box.replaceChildren(
      h('section', { class: 'set-section' },
        h('h2', {}, '使う人'),
        state.profiles.map((p) =>
          h('div', { class: 'profile-row' },
            h('span', { class: 'stamp', style: { '--c': p.color, '--rot': '0deg' }, 'aria-hidden': 'true' }, p.emoji),
            h('span', { class: 'name' }, p.name, h('span', { class: 'tag' }, `${counts.get(p.id) ?? 0} 日`)),
            h('button', { class: 'btn', onclick: () => openProfileDialog(p) }, '編集'),
            h('button', { class: 'btn btn-danger', onclick: () => confirmDeleteProfile(p, counts.get(p.id) ?? 0) }, '削除'),
          )),
        h('button', { class: 'btn', onclick: () => openProfileDialog() }, '＋ 使う人を追加'),
      ),
      h('section', { class: 'set-section' },
        h('h2', {}, 'バックアップ'),
        h('p', { class: 'muted small' },
          'データはこの端末の中だけに保存されています。ブラウザのデータ削除や端末の故障に備えて、月に1回ほどバックアップファイルを保存しておくと安心です。'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-primary', onclick: exportBackup }, '⬇️ バックアップを保存'),
          h('button', { class: 'btn', onclick: () => $('#import-file').click() }, '⬆️ バックアップから復元'),
        ),
      ),
      h('section', { class: 'set-section' },
        h('h2', {}, 'データの削除'),
        h('button', { class: 'btn btn-danger', onclick: confirmClearAll }, 'すべてのデータを削除'),
      ),
      h('section', { class: 'set-section' },
        h('h2', {}, 'このアプリについて'),
        h('p', { class: 'muted small' },
          'Raz-Kids などの英語学習を毎日記録するための非公式アプリです。Raz-Kids / Learning A-Z とは関係ありません。',
          'Raz-Kids のアカウント情報は扱わず、学習データを外部に送信することもありません。'),
      ),
    );
  });
}

// ============================================================
// 連続記録の祝福画面
// ============================================================
const CONFETTI_COLORS = ['#e4572e', '#2b6cb0', '#d53f8c', '#805ad5', '#c27c0e', '#2c9a6a', '#f6c448'];
const STREAK_ROW_MAX = 14;

function celebrate(profile, streak, prevBest, grant = null) {
  closeCelebration();
  const t = today();
  const end = state.stamps.has(t) ? t : addDays(t, -1);
  const shown = Math.min(streak, STREAK_ROW_MAX);
  const days = Array.from({ length: shown }, (_, i) => addDays(end, i - shown + 1));
  const next = nextMilestone(streak);
  const progress = Math.round((streak / next) * 100);
  const newBest = streak > prevBest && prevBest > 0;
  const milestone = isMilestone(streak);

  const overlay = h('div', { class: 'celebrate', id: 'celebrate', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${streak}日連続` },
    h('div', { class: 'confetti', 'aria-hidden': 'true' },
      Array.from({ length: milestone ? 90 : 50 }, (_, i) => h('i', {
        style: {
          left: `${Math.random() * 100}%`,
          background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          'animation-delay': `${Math.random() * 0.8}s`,
          'animation-duration': `${2.2 + Math.random() * 1.8}s`,
          '--drift': `${Math.round(Math.random() * 160 - 80)}px`,
          '--spin': `${Math.round(Math.random() * 720 - 360)}deg`,
        },
      }))),
    h('div', { class: `celebrate-card ${milestone ? 'is-milestone' : ''}` },
      h('p', { class: 'celebrate-who' }, `${profile.name} さん`),
      milestone && h('p', { class: 'celebrate-badge' }, `🏅 ${streak}日 達成！`),
      h('p', { class: 'celebrate-count' }, h('span', { class: 'num' }, streak), h('span', { class: 'unit' }, '日連続！')),
      h('p', { class: 'celebrate-msg' }, streakMessage(streak)),
      h('div', { class: 'streak-row', 'aria-label': `直近${shown}日の記録` },
        streak > STREAK_ROW_MAX && h('span', { class: 'streak-more' }, `…+${streak - STREAK_ROW_MAX}`),
        days.map((d, i) => h('span', { class: 'streak-day', style: { 'animation-delay': `${0.3 + i * 0.07}s` } },
          stampEl(profile, state.stamps.get(d) ?? { date: d }),
          h('small', {}, `${parseDateKey(d).getMonth() + 1}/${parseDateKey(d).getDate()}`))),
      ),
      h('div', { class: 'celebrate-next' },
        h('div', { class: 'bar' }, h('span', { style: { width: `${progress}%` } })),
        h('p', {}, `次の目標 ${next}日まで あと `, h('strong', {}, next - streak), ' 日'),
      ),
      newBest && h('p', { class: 'celebrate-best' }, `👑 自己ベスト更新！（これまでの最高 ${prevBest}日）`),
      grant?.granted > 0 && h('div', { class: 'celebrate-item' },
        h('span', { class: 'ci-icon', 'aria-hidden': 'true' }, capsuleSvg()),
        h('div', { class: 'ci-body' },
          h('strong', {}, `おくすりを ${grant.granted}個 ゲット！`),
          h('p', {}, '連続記録が1日途切れても守れるよ'),
          h('div', { class: 'ci-slots' }, h('span', { class: 'muted small' }, 'もちもの'), itemSlots(itemsOf(profile.id)))),
      ),
      grant?.full && !grant.granted && h('p', { class: 'celebrate-full' },
        `${grant.milestones.at(-1)}日連続！ でも もちものがいっぱい（${ITEM_MAX}/${ITEM_MAX}）なので、今回はおくすりをもらえません`),
      h('button', { class: 'btn btn-primary celebrate-ok', onclick: closeCelebration }, 'やったね！'),
    ),
  );
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCelebration(); });
  document.body.append(overlay);
  overlay.querySelector('.celebrate-ok').focus();
}

function closeCelebration() {
  document.getElementById('celebrate')?.remove();
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCelebration(); });

// ============================================================
// ダイアログ
// ============================================================
const dlg = $('#dlg');

function openDialog(...children) {
  dlg.replaceChildren(...children);
  dlg.oncancel = null;
  if (!dlg.open) dlg.showModal();
}
const closeDialog = () => dlg.open && dlg.close();

/** 確認ダイアログ。OK なら true を返す */
function confirmDialog({ title, message, okLabel = 'OK', danger = false, alertOnly = false }) {
  return new Promise((resolve) => {
    const done = (v) => { closeDialog(); resolve(v); };
    openDialog(
      h('h2', {}, title),
      h('p', {}, message),
      h('div', { class: 'btn-row' },
        !alertOnly && h('button', { class: 'btn', onclick: () => done(false) }, 'キャンセル'),
        h('button', { class: `btn ${danger ? 'btn-danger solid' : 'btn-primary'}`, onclick: () => done(true) }, okLabel),
      ),
    );
    dlg.addEventListener('cancel', () => resolve(false), { once: true });
  });
}

function openDayDialog(dateKey) {
  const profile = activeProfile();
  const record = state.stamps.get(dateKey);
  const t = today();
  const memo = h('textarea', { maxlength: '200', placeholder: '例: Level M「The Lion and the Mouse」を読んだ' });
  memo.value = record?.memo ?? '';

  if (isRescue(record)) {
    openDialog(
      h('h2', {}, formatDateJa(dateKey)),
      h('div', { class: 'center' }, stampEl(profile, record)),
      h('p', { class: 'center' }, 'おくすりで救済した日です'),
      h('p', { class: 'muted small center' }, `使った日時: ${formatStampedAt(record.stampedAt)}`),
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn btn-danger',
          onclick: async () => {
            const ok = await confirmDialog({
              title: '救済を取り消しますか？',
              message: `${formatDateJa(dateKey)} の救済を取り消して、おくすりを1個戻します。連続記録はここで途切れます。`,
              okLabel: '取り消す',
              danger: true,
            });
            if (ok) await removeStamp(dateKey);
          },
        }, '救済を取り消す'),
        h('button', { class: 'btn btn-primary', onclick: closeDialog }, '閉じる'),
      ),
    );
    return;
  }

  if (record) {
    let chosen = record.stampType;
    const preview = h('div', { class: 'center' }, stampEl(profile, record));
    openDialog(
      h('h2', {}, formatDateJa(dateKey)),
      preview,
      h('p', { class: 'muted small center' },
        `押した日時: ${formatStampedAt(record.stampedAt)}`, record.backfilled && '（あとから押印）'),
      h('div', { class: 'field' }, h('span', {}, 'スタンプを変える'),
        stampPicker(chosen, (id) => {
          chosen = id;
          preview.replaceChildren(stampEl(profile, { ...record, stampType: id }));
        })),
      h('label', { class: 'field' }, h('span', {}, 'メモ（読んだ本など）'), memo),
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn btn-danger',
          onclick: async () => {
            const ok = await confirmDialog({
              title: 'スタンプを取り消しますか？',
              message: `${formatDateJa(dateKey)} のスタンプを取り消します。`,
              okLabel: '取り消す',
              danger: true,
            });
            if (ok) await removeStamp(dateKey);
          },
        }, 'スタンプを取り消す'),
        h('button', { class: 'btn', onclick: closeDialog }, '閉じる'),
        h('button', { class: 'btn btn-primary', onclick: async () => { await saveStampDetails(dateKey, { memo: memo.value, stampType: chosen }); closeDialog(); } }, '保存'),
      ),
    );
    return;
  }

  if (dateKey > t) return;
  let chosen = state.selectedType;
  const picker = () => h('div', { class: 'field' }, h('span', {}, 'スタンプを選ぶ'), stampPicker(chosen, (id) => { chosen = id; }));
  const memoField = () => h('label', { class: 'field' }, h('span', {}, 'メモ（任意）'), memo);

  if (dateKey === t) {
    openDialog(
      h('h2', {}, formatDateJa(dateKey)),
      h('p', {}, '今日の学習を記録しますか？'),
      picker(),
      memoField(),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: closeDialog }, 'キャンセル'),
        h('button', { class: 'btn btn-primary', onclick: async () => { closeDialog(); await stamp(dateKey, memo.value, chosen); } }, 'スタンプを押す'),
      ),
    );
    return;
  }

  // 過去の空いた日: 「あとから押す（学習した）」と「おくすりで守る（学習しなかった）」の2択
  const n = itemsOf(profile.id);
  const rc = rescueCheck(dateKey, t, state.stamps, n);
  openDialog(
    h('h2', {}, formatDateJa(dateKey)),
    h('p', {}, 'この日はまだスタンプがありません。'),
    h('section', { class: 'option' },
      h('h3', {}, '📖 あとから押す'),
      h('p', { class: 'muted small' }, '学習したけど、スタンプを押し忘れた日'),
      canStamp(dateKey, t)
        ? [picker(), memoField(),
            h('button', { class: 'btn btn-primary btn-block', onclick: async () => { closeDialog(); await stamp(dateKey, memo.value, chosen); } }, 'あとから押す')]
        : h('p', { class: 'reason' }, `${BACKFILL_DAYS}日より前の日には、あとから押せません`),
    ),
    h('section', { class: 'option' },
      h('h3', { class: 'option-rescue' }, h('span', { class: 'opt-icon', 'aria-hidden': 'true' }, capsuleSvg()), 'おくすりで守る'),
      h('p', { class: 'muted small' }, '学習できなかった日を救済して、連続記録をつなぐ'),
      rc.ok
        ? h('button', { class: 'btn btn-rescue btn-block', onclick: async () => { closeDialog(); await rescue(dateKey); } },
            `おくすりを使う（残り ${n}個 → ${n - 1}個）`)
        : h('p', { class: 'reason' }, rc.reason),
    ),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: closeDialog }, 'キャンセル')),
  );
}

function openProfileDialog(profile = null, { required = false } = {}) {
  const name = h('input', { type: 'text', maxlength: '20', required: true, placeholder: '例: たろう', autocomplete: 'off' });
  name.value = profile?.name ?? '';
  const usedEmojis = new Set(state.profiles.filter((p) => p !== profile).map((p) => p.emoji));
  const usedColors = new Set(state.profiles.filter((p) => p !== profile).map((p) => p.color));
  const defEmoji = profile?.emoji ?? EMOJIS.find((e) => !usedEmojis.has(e)) ?? EMOJIS[0];
  const defColor = profile?.color ?? COLORS.find((c) => !usedColors.has(c)) ?? COLORS[0];

  const radio = (group, value, checked, content, extra = {}) =>
    h('label', { class: 'choice' },
      h('input', { type: 'radio', name: group, value, checked, 'aria-label': value }),
      h('span', extra, content));

  const form = h('form', { method: 'dialog' },
    h('h2', {}, required ? 'はじめに：使う人を登録' : profile ? '使う人を編集' : '使う人を追加'),
    required && h('p', { class: 'muted small' }, '兄弟で使うときは、あとから設定で人数を増やせます。'),
    h('label', { class: 'field' }, h('span', {}, '名前'), name),
    h('div', { class: 'field' }, h('span', {}, 'スタンプの絵柄'),
      h('div', { class: 'choices' }, EMOJIS.map((e) => radio('emoji', e, e === defEmoji, e)))),
    h('div', { class: 'field' }, h('span', {}, 'スタンプの色'),
      h('div', { class: 'choices' }, COLORS.map((c) => radio('color', c, c === defColor, '', { class: 'swatch', style: { '--c': c } })))),
    h('div', { class: 'btn-row' },
      !required && h('button', { type: 'button', class: 'btn', onclick: closeDialog }, 'キャンセル'),
      h('button', { type: 'submit', class: 'btn btn-primary' }, '保存'),
    ),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const trimmed = name.value.trim();
    if (!trimmed) {
      name.focus();
      return;
    }
    const fd = new FormData(form);
    const saved = {
      id: profile?.id ?? crypto.randomUUID(),
      name: trimmed,
      emoji: fd.get('emoji'),
      color: fd.get('color'),
      createdAt: profile?.createdAt ?? new Date().toISOString(),
    };
    await db.putProfile(saved);
    closeDialog();
    await loadProfiles();
    if (!profile) await switchProfile(saved.id);
    else render();
  });

  openDialog(form);
  // 初回登録はキャンセル不可（Esc で閉じない）
  dlg.oncancel = required ? (e) => e.preventDefault() : null;
  name.focus();
}

async function confirmDeleteProfile(profile, count) {
  const ok = await confirmDialog({
    title: `${profile.name} さんを削除しますか？`,
    message: `${profile.name} さんのスタンプ ${count} 日分もすべて削除されます。元に戻せません。`,
    okLabel: '削除する',
    danger: true,
  });
  if (!ok) return;
  await db.deleteProfile(profile.id);
  await loadProfiles();
  await db.setSetting('activeProfileId', state.activeId);
  await loadStamps();
  render();
  if (!state.profiles.length) openProfileDialog(null, { required: true });
}

async function confirmClearAll() {
  const first = await confirmDialog({
    title: 'すべてのデータを削除しますか？',
    message: '全員分のプロフィールとスタンプが削除されます。先にバックアップを保存することをおすすめします。',
    okLabel: '次へ',
    danger: true,
  });
  if (!first) return;
  const second = await confirmDialog({
    title: '本当に削除しますか？',
    message: 'この操作は元に戻せません。',
    okLabel: 'すべて削除する',
    danger: true,
  });
  if (!second) return;
  await db.clearAll();
  await loadProfiles();
  await loadStamps();
  render();
  openProfileDialog(null, { required: true });
}

// ============================================================
// バックアップ
// ============================================================
async function exportBackup() {
  const data = {
    app: BACKUP_APP_ID,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    profiles: state.profiles,
    stamps: await db.listAllStamps(),
    itemEvents: await db.listAllItemEvents(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `raz-stamp-backup-${today()}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  await db.setSetting('lastBackupAt', data.exportedAt);
  showToast('バックアップファイルを保存しました');
}

async function importBackup(file) {
  let incoming;
  try {
    incoming = parseBackup(JSON.parse(await file.text()));
  } catch (err) {
    await confirmDialog({ title: '読み込めませんでした', message: err instanceof SyntaxError ? 'JSON ファイルではありません' : err.message, alertOnly: true });
    return;
  }
  const plan = planImport(state.profiles, await db.listAllStamps(), incoming, await db.listAllItemEvents());
  if (!plan.profiles.length && !plan.stamps.length && !plan.itemEvents.length) {
    await confirmDialog({ title: '追加するデータはありません', message: 'バックアップの内容はすべて登録済みです。', alertOnly: true });
    return;
  }
  const ok = await confirmDialog({
    title: 'バックアップから復元しますか？',
    message: `使う人 ${plan.profiles.length} 人、スタンプ ${plan.stamps.length} 日分、おくすりの記録 ${plan.itemEvents.length} 件を追加します。同じ日のスタンプがすでにある場合は、今のデータを残します。`,
    okLabel: '復元する',
  });
  if (!ok) return;
  await db.importData({
    profiles: plan.profiles.map((p, i) => ({ ...p, createdAt: new Date(Date.now() + i).toISOString() })),
    stamps: plan.stamps,
    itemEvents: plan.itemEvents,
  });
  await loadProfiles();
  await loadStamps();
  render();
  showToast('復元しました');
}

// ============================================================
// トースト
// ============================================================
let toastTimer = null;
function showToast(message, action = null) {
  const el = $('#toast');
  clearTimeout(toastTimer);
  el.replaceChildren(
    h('span', {}, message),
    action && h('button', { onclick: () => { el.hidden = true; action.onClick(); } }, action.label),
  );
  el.hidden = false;
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? UNDO_MS : 2500);
}

// ============================================================
// 起動
// ============================================================
function viewOf(dateKey) {
  const [year, month] = dateKey.split('-').map(Number);
  return { year, month };
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== tab; });
  if (tab === 'home') state.view = viewOf(today());
  render();
  window.scrollTo(0, 0);
}

async function init() {
  state.view = viewOf(today());
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) await importBackup(file);
  });

  // 日付が変わってからアプリに戻ってきたときに「今日」を更新する
  let lastDay = today();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && today() !== lastDay) {
      lastDay = today();
      state.view = viewOf(lastDay);
      render();
    }
  });

  await db.requestPersistence();
  await loadProfiles();
  await loadStamps();
  render();
  if (!state.profiles.length) openProfileDialog(null, { required: true });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
