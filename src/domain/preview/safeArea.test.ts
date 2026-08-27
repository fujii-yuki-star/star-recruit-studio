import { describe, expect, it } from 'vitest';
import { ORIENTATION } from '../enums';
import { outsideSafeArea, safeAreaRect, SAFE_AREA_INSET } from './safeArea';

const landscape = { width: 1920, height: 1080 };
const portrait = { width: 1080, height: 1920 };

describe('safeAreaRect（安全領域の枠・#265）', () => {
  it('横型は四辺を同じだけ空ける', () => {
    const r = safeAreaRect(landscape, ORIENTATION.landscape);
    expect(r).toEqual({ x: 96, y: 54, w: 1728, h: 972 }); // 5%
  });

  /**
   * ⚠️ **横と縦で違う**＝切られやすい辺が違う。縦型は上下に UI（時刻・操作ボタン）が重なるので
   * **上下を厚く**する（左右は切られにくい）。
   */
  it('縦型は上下を厚く空ける', () => {
    const r = safeAreaRect(portrait, ORIENTATION.portrait);
    expect(r.y).toBeGreaterThan(r.x); // 上は左右より厚い
    expect(r.y + r.h).toBeLessThan(portrait.height - r.x); // 下も左右より厚い
  });

  // ⚠️ **割合で持つ**＝`canvas` の大きさが変わっても同じ見え方になる。
  it('キャンバスが大きくなっても割合は同じ', () => {
    const small = safeAreaRect({ width: 960, height: 540 }, ORIENTATION.landscape);
    expect(small.x / 960).toBeCloseTo(SAFE_AREA_INSET[ORIENTATION.landscape].left, 6);
    expect(small.w / 960).toBeCloseTo(1 - 0.05 * 2, 6);
  });

  // ⚠️ **知らない向きでも枠は出す**（横型として扱う）＝安全領域が消えるより出しすぎるほうが安全。
  it('知らない向きは横型として扱う', () => {
    expect(safeAreaRect(landscape, '1:1' as never)).toEqual(safeAreaRect(landscape, ORIENTATION.landscape));
  });

  it('極端に小さいキャンバスでも負の大きさにしない', () => {
    const r = safeAreaRect({ width: 1, height: 1 }, ORIENTATION.landscape);
    expect(r.w).toBeGreaterThanOrEqual(0);
    expect(r.h).toBeGreaterThanOrEqual(0);
  });
});

describe('outsideSafeArea（端に寄りすぎ）', () => {
  const safe = safeAreaRect(landscape, ORIENTATION.landscape);

  it('中に収まっていれば false', () => {
    expect(outsideSafeArea({ x: 200, y: 200, w: 400, h: 200 }, safe)).toBe(false);
  });

  it('四辺のどれから出ても true', () => {
    expect(outsideSafeArea({ x: 0, y: 200, w: 100, h: 100 }, safe)).toBe(true);    // 左
    expect(outsideSafeArea({ x: 200, y: 0, w: 100, h: 100 }, safe)).toBe(true);    // 上
    expect(outsideSafeArea({ x: 1850, y: 200, w: 100, h: 100 }, safe)).toBe(true); // 右
    expect(outsideSafeArea({ x: 200, y: 1050, w: 100, h: 100 }, safe)).toBe(true); // 下
  });

  // ⚠️ **ぴったり接しているのは「出ていない」**＝境界で注意が点滅しない。
  it('枠にぴったり接しているのは出ていないとする', () => {
    expect(outsideSafeArea({ x: safe.x, y: safe.y, w: safe.w, h: safe.h }, safe)).toBe(false);
  });
});
