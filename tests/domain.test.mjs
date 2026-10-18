import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toDateKey, isValidDateKey, addDays, canStamp,
  calcCurrentStreak, calcBestStreak, monthGrid, monthStats, shiftMonth,
  parseBackup, planImport, BACKUP_APP_ID, BACKUP_VERSION,
} from '../js/domain.js';

test('toDateKey はローカル日付を使う', () => {
  assert.equal(toDateKey(new Date(2026, 0, 5, 0, 30)), '2026-01-05');
  assert.equal(toDateKey(new Date(2026, 9, 18, 23, 59)), '2026-10-18');
});

test('isValidDateKey は存在しない日付を弾く', () => {
  assert.ok(isValidDateKey('2024-02-29'));
  assert.ok(!isValidDateKey('2026-02-29'));
  assert.ok(!isValidDateKey('2026-13-01'));
  assert.ok(!isValidDateKey('2026-1-1'));
});

test('addDays は月・年をまたぐ', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('canStamp は未来日を拒否し過去日を許可する', () => {
  assert.ok(canStamp('2026-10-18', '2026-10-18'));
  assert.ok(canStamp('2025-01-01', '2026-10-18'));
  assert.ok(!canStamp('2026-10-19', '2026-10-18'));
});

test('calcCurrentStreak: 今日押していれば今日から数える', () => {
  assert.equal(calcCurrentStreak(['2026-10-16', '2026-10-17', '2026-10-18'], '2026-10-18'), 3);
});

test('calcCurrentStreak: 今日未押印なら昨日から数える', () => {
  assert.equal(calcCurrentStreak(['2026-10-16', '2026-10-17'], '2026-10-18'), 2);
});

test('calcCurrentStreak: 昨日も未押印なら 0', () => {
  assert.equal(calcCurrentStreak(['2026-10-15', '2026-10-16'], '2026-10-18'), 0);
});

test('calcBestStreak は最長の連続を返す', () => {
  assert.equal(calcBestStreak([]), 0);
  assert.equal(calcBestStreak(['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06']), 3);
});

test('monthGrid は日曜始まりで週ごとに区切る', () => {
  const weeks = monthGrid(2026, 10); // 2026-10-01 は木曜
  assert.deepEqual(weeks[0], [null, null, null, null, '2026-10-01', '2026-10-02', '2026-10-03']);
  assert.ok(weeks.every((w) => w.length === 7));
  assert.equal(weeks.flat().filter(Boolean).length, 31);
});

test('monthStats は今月なら今日までを対象日数にする', () => {
  const keys = ['2026-10-01', '2026-10-18', '2026-09-30'];
  assert.deepEqual(monthStats(keys, 2026, 10, '2026-10-18'), { count: 2, elapsed: 18, daysInMonth: 31 });
  assert.deepEqual(monthStats(keys, 2026, 9, '2026-10-18'), { count: 1, elapsed: 30, daysInMonth: 30 });
  assert.deepEqual(monthStats(keys, 2026, 11, '2026-10-18'), { count: 0, elapsed: 0, daysInMonth: 30 });
});

test('shiftMonth は年をまたぐ', () => {
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
});

const backup = (over = {}) => ({
  app: BACKUP_APP_ID,
  version: BACKUP_VERSION,
  profiles: [{ id: 'p1', name: 'たろう', emoji: '⭐', color: '#e4572e' }],
  stamps: [{ profileId: 'p1', date: '2026-10-18', stampedAt: '2026-10-18T20:00:00.000Z', backfilled: false }],
  ...over,
});

test('parseBackup は正しいファイルを受け付ける', () => {
  const r = parseBackup(backup());
  assert.equal(r.profiles.length, 1);
  assert.equal(r.stamps[0].memo, '');
  assert.equal(r.stamps[0].stampType, null);
});

test('parseBackup はスタンプのデザインを引き継ぐ', () => {
  const r = parseBackup(backup({
    stamps: [{ profileId: 'p1', date: '2026-10-18', stampedAt: '2026-10-18T20:00:00.000Z', stampType: 'rocket' }],
  }));
  assert.equal(r.stamps[0].stampType, 'rocket');
});

test('parseBackup は不正なファイルを拒否する', () => {
  assert.throws(() => parseBackup({ app: 'other' }));
  assert.throws(() => parseBackup(backup({ version: 99 })));
  assert.throws(() => parseBackup(backup({ stamps: [{ profileId: 'unknown', date: '2026-10-18', stampedAt: '2026-10-18T00:00:00Z' }] })));
  assert.throws(() => parseBackup(backup({ stamps: [{ profileId: 'p1', date: '2026-02-30', stampedAt: '2026-10-18T00:00:00Z' }] })));
});

test('planImport は既存データを優先する', () => {
  const incoming = parseBackup(backup({
    profiles: [{ id: 'p1', name: 'たろう' }, { id: 'p2', name: 'はなこ' }],
    stamps: [
      { profileId: 'p1', date: '2026-10-18', stampedAt: '2026-10-18T00:00:00Z' },
      { profileId: 'p1', date: '2026-10-17', stampedAt: '2026-10-17T00:00:00Z' },
    ],
  }));
  const plan = planImport(
    [{ id: 'p1', name: 'たろう' }],
    [{ profileId: 'p1', date: '2026-10-18' }],
    incoming,
  );
  assert.deepEqual(plan.profiles.map((p) => p.id), ['p2']);
  assert.deepEqual(plan.stamps.map((s) => s.date), ['2026-10-17']);
});

test('nextMilestone は次の節目を返す', async () => {
  const { nextMilestone, isMilestone } = await import('../js/domain.js');
  assert.equal(nextMilestone(2), 3);
  assert.equal(nextMilestone(3), 7);
  assert.equal(nextMilestone(365), 400);
  assert.equal(nextMilestone(420), 500);
  assert.ok(isMilestone(7));
  assert.ok(!isMilestone(8));
  assert.ok(isMilestone(500));
});

test('streakMessage は日数に応じて変わる', async () => {
  const { streakMessage } = await import('../js/domain.js');
  assert.match(streakMessage(2), /いい調子/);
  assert.match(streakMessage(3), /3日坊主/);
  assert.match(streakMessage(10), /1週間/);
  assert.match(streakMessage(30), /1か月/);
});
