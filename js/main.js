import * as db from './db.js';
import {
  toDateKey, canStamp, formatDateJa, formatTimeJa, parseDateKey,
  calcCurrentStreak, calcBestStreak, monthGrid, monthStats, shiftMonth,
  parseBackup, planImport, BACKUP_APP_ID, BACKUP_VERSION,
  addDays, isMilestone, nextMilestone, streakMessage,
} from './domain.js';
import { STAMP_DESIGNS, DEFAULT_STAMP, getDesign, stampSvg } from './stamps.js';

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
};

const $ = (sel) => document.querySelector(sel);
const today = () => toDateKey(new Date());
const activeProfile = () => state.profiles.find((p) => p.id === state.activeId);

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
  if (!state.activeId) return;
  for (const s of await db.listStamps(state.activeId)) state.stamps.set(s.date, s);
  const saved = await db.getSetting(`stampType:${state.activeId}`);
  state.selectedType = getDesign(saved) ? saved : DEFAULT_STAMP;
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
  const before = [...state.stamps.keys()];
  const ok = await db.addStamp(record);
  if (!ok) {
    showToast('この日はもう押してあります');
    return false;
  }
  state.stamps.set(dateKey, record);
  render({ popDate: dateKey });
  const after = [...state.stamps.keys()];
  const streak = calcCurrentStreak(after, today());
  // 今回の押印で連続が伸びた（2日以上）ときだけ祝福する。あとから押印して連続がつながった場合も含む
  if (streak >= 2 && streak > calcCurrentStreak(before, today())) {
    setTimeout(() => celebrate(profile, streak, calcBestStreak(before)), 500);
  }
  showToast(`${formatDateJa(dateKey)} に「${getDesign(stampType)?.name ?? 'スタンプ'}」を押しました`, {
    label: '元に戻す',
    onClick: () => removeStamp(dateKey, { silent: true }),
  });
  return true;
}

async function removeStamp(dateKey, { silent = false } = {}) {
  closeCelebration();
  await db.deleteStamp(state.activeId, dateKey);
  state.stamps.delete(dateKey);
  render();
  if (!silent) showToast('スタンプを取り消しました');
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
      }, h('span', { 'aria-hidden': 'true' }, p.emoji), p.name),
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
  const keys = [...state.stamps.keys()];
  const { count, elapsed } = monthStats(keys, ...t.split('-').slice(0, 2).map(Number), t);

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
    main,
    h('div', { class: 'stats' },
      statEl(calcCurrentStreak(keys, t), '日', '連続'),
      statEl(count, `/${elapsed}日`, '今月'),
      statEl(calcBestStreak(keys), '日', '最高連続'),
    ),
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
  const { count, elapsed, daysInMonth } = monthStats([...state.stamps.keys()], year, month, t);
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
    const label = `${month}月${day}日 ${record ? 'スタンプあり' : future ? '' : 'スタンプなし'}`;
    return h('button', { class: cls, disabled: future, 'aria-label': label, onclick: () => openDayDialog(key) },
      h('span', { class: 'num' }, day),
      record && stampEl(profile, record, popDate === key ? 'pop' : ''),
      record?.backfilled && h('span', { class: 'backfill-mark', title: 'あとから押印' }, '後'),
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
      h('span', {}, '日付をタップすると押し忘れの記録・取り消しができます'),
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
  box.replaceChildren(
    h('h2', {}, `${profile.name} さんの押印履歴（全 ${records.length} 日）`),
    ...[...byMonth].map(([ym, list]) => {
      const [y, m] = ym.split('-').map(Number);
      return h('section', { class: 'hist-month' },
        h('h3', {}, h('span', {}, `${y}年 ${m}月`), h('span', { class: 'muted' }, `${list.length} 日`)),
        h('ul', { class: 'hist-list' }, list.map((r) =>
          h('li', {}, h('button', { class: 'hist-item', onclick: () => openDayDialog(r.date) },
            stampEl(profile, r),
            h('div', { class: 'hist-main' },
              h('div', { class: 'hist-date' }, formatDateJa(r.date), r.backfilled && h('span', { class: 'tag' }, 'あとから押印')),
              h('div', { class: 'hist-meta' }, `押した日時: ${formatStampedAt(r.stampedAt)}`),
              r.memo && h('div', { class: 'hist-memo' }, `📝 ${r.memo}`),
            ),
          )),
        )),
      );
    }),
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
    all.forEach((s) => counts.set(s.profileId, (counts.get(s.profileId) ?? 0) + 1));
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

function celebrate(profile, streak, prevBest) {
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

  if (!canStamp(dateKey, t)) return;
  const isToday = dateKey === t;
  let chosen = state.selectedType;
  openDialog(
    h('h2', {}, formatDateJa(dateKey)),
    h('p', {}, isToday
      ? '今日の学習を記録しますか？'
      : 'この日はまだスタンプがありません。学習したのに押し忘れていた場合は、あとから押せます。'),
    h('div', { class: 'field' }, h('span', {}, 'スタンプを選ぶ'), stampPicker(chosen, (id) => { chosen = id; })),
    h('label', { class: 'field' }, h('span', {}, 'メモ（任意）'), memo),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: closeDialog }, 'キャンセル'),
      h('button', {
        class: 'btn btn-primary',
        onclick: async () => { closeDialog(); await stamp(dateKey, memo.value, chosen); },
      }, isToday ? 'スタンプを押す' : 'あとから押す'),
    ),
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
  const plan = planImport(state.profiles, await db.listAllStamps(), incoming);
  if (!plan.profiles.length && !plan.stamps.length) {
    await confirmDialog({ title: '追加するデータはありません', message: 'バックアップの内容はすべて登録済みです。', alertOnly: true });
    return;
  }
  const ok = await confirmDialog({
    title: 'バックアップから復元しますか？',
    message: `使う人 ${plan.profiles.length} 人、スタンプ ${plan.stamps.length} 日分を追加します。同じ日のスタンプがすでにある場合は、今のデータを残します。`,
    okLabel: '復元する',
  });
  if (!ok) return;
  await db.importData({
    profiles: plan.profiles.map((p, i) => ({ ...p, createdAt: new Date(Date.now() + i).toISOString() })),
    stamps: plan.stamps,
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
