import { describe, expect, it } from 'vitest';
import {
  restorePointsToDrop,
  RESTORE_POINT_MAX,
  RESTORE_POINT_MIN_INTERVAL_MS,
  shouldTakeRestorePoint,
  sortRestorePoints,
  type RestorePoint,
} from './restorePoints';

const at = (savedAt: number): RestorePoint => ({ name: `p${savedAt}`, savedAt });

describe('shouldTakeRestorePoint', () => {
  it('1つも無ければ作る（5分たつ前に壊れたとき、戻り先がゼロにならない）', () => {
    expect(shouldTakeRestorePoint([], 0)).toBe(true);
  });

  it('最短の間隔より近い保存では作らない（自動保存のたびに溜めない）', () => {
    const now = 10_000_000;
    expect(shouldTakeRestorePoint([at(now - RESTORE_POINT_MIN_INTERVAL_MS + 1)], now)).toBe(false);
    expect(shouldTakeRestorePoint([at(now - RESTORE_POINT_MIN_INTERVAL_MS)], now)).toBe(true);
  });

  it('見るのは**いちばん新しいもの**だけ（古いものが残っていても、直近が近ければ作らない）', () => {
    const now = 10_000_000;
    const points = [at(now - 60 * 60 * 1000), at(now - 1000), at(now - 2 * 60 * 60 * 1000)];
    expect(shouldTakeRestorePoint(points, now)).toBe(false);
  });
});

describe('restorePointsToDrop', () => {
  it('上限を超えたぶんを、古いほうから落とす', () => {
    const points = Array.from({ length: 5 }, (_, i) => at(i));
    expect(restorePointsToDrop(points, 3).map((p) => p.savedAt)).toEqual([2, 1, 0]);
  });

  it('これから作る1つぶんを空ける（作ってから消すと一瞬だけ上限を超える）', () => {
    const points = Array.from({ length: RESTORE_POINT_MAX, }, (_, i) => at(i));
    // ちょうど上限＝1つ落として、新しく作る場所を空ける。
    expect(restorePointsToDrop(points)).toHaveLength(1);
    expect(restorePointsToDrop(points)[0].savedAt).toBe(0); // いちばん古いもの
  });

  it('上限に満たなければ何も落とさない', () => {
    expect(restorePointsToDrop([at(1), at(2)], 5)).toEqual([]);
  });
});

describe('sortRestorePoints', () => {
  it('新しい順（戻りたいのはたいてい直前の状態）', () => {
    expect(sortRestorePoints([at(1), at(3), at(2)]).map((p) => p.savedAt)).toEqual([3, 2, 1]);
  });

  it('元の配列を変えない（純粋）', () => {
    const points = [at(1), at(3)];
    sortRestorePoints(points);
    expect(points.map((p) => p.savedAt)).toEqual([1, 3]);
  });
});
