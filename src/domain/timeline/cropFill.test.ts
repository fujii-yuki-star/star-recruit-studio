import { describe, expect, it } from 'vitest';

import { CROP_ALIGN_X, CROP_ALIGN_Y, FIT } from '../enums';
import { fillPlacement } from './cropFill';

// 素材 200×100（横長）、枠 100×100（正方形）を基本形にする。
const SRC = { w: 200, h: 100 };
const BOX = { w: 100, h: 100 };

describe('fillPlacement（残った素材を枠いっぱいに映す・#634）', () => {
  it('切り抜きが無ければ、枠に cover で当てはめた素材全体の矩形になる', () => {
    // cover＝縦を満たす倍率 1（100/100）と横を満たす倍率 0.5 の大きい方＝1 → 200×100。
    const p = fillPlacement(SRC, BOX, undefined, FIT.cover);
    expect(p).toEqual({ x: -50, y: 0, w: 200, h: 100 });
  });

  it('左を半分切ると、残った半分（100×100）がちょうど枠を満たす', () => {
    const p = fillPlacement(SRC, BOX, { left: 0.5 }, FIT.cover);
    // 残り 100×100 → 倍率 1。素材全体は 200×100 で、隠した 100px ぶん左へ出る。
    expect(p).toEqual({ x: -100, y: 0, w: 200, h: 100 });
  });

  it('切り抜きを増やすほど素材は拡大される（残りが枠を満たすため）', () => {
    const half = fillPlacement(SRC, BOX, { left: 0.5 }, FIT.cover);
    const quarter = fillPlacement(SRC, BOX, { left: 0.75 }, FIT.cover);
    expect(quarter.w).toBeGreaterThan(half.w);
    // 残り 50×100 → 縦で満たす倍率 1 と横 2 の大きい方＝2 → 素材は 400×200。
    expect(quarter).toEqual({ x: -300, y: -50, w: 400, h: 200 });
  });

  it('contain は残った部分が枠に収まる（はみ出さない）', () => {
    const p = fillPlacement(SRC, BOX, { left: 0.5, right: 0.25 }, FIT.contain);
    // 残り 50×100 → 収める倍率＝min(100/50, 100/100)=1 → 素材 200×100、残りは 50×100。
    expect(p.w).toBe(200);
    // 残った部分の左端＝x + 100*1 ＝ 枠の中で中央寄せ（余り 50 の半分）。
    expect(p.x + SRC.w * 0.5).toBeCloseTo(25, 6);
  });

  it('stretch は縦横それぞれ枠に合わせる（比率が崩れる）', () => {
    const p = fillPlacement(SRC, BOX, { left: 0.5 }, FIT.stretch);
    // 残り 100×100 を 100×100 へ＝横倍率 1・縦倍率 1 → 素材 200×100。
    expect(p).toEqual({ x: -100, y: 0, w: 200, h: 100 });
    const tall = fillPlacement(SRC, { w: 100, h: 400 }, { left: 0.5 }, FIT.stretch);
    // 縦だけ 4 倍になる（cover なら横も 4 倍）。
    expect(tall.w).toBe(200);
    expect(tall.h).toBe(400);
  });

  it('寄せは残った部分を枠のどこへ置くかを変える（cover で余る軸）', () => {
    const c = { top: 0.5 } as const;
    // 素材 200×100 の上半分を隠す＝残り 200×50 → cover 倍率＝max(0.5, 2)=2 → 素材 400×200。
    const left = fillPlacement(SRC, BOX, c, FIT.cover, { x: CROP_ALIGN_X.left });
    const right = fillPlacement(SRC, BOX, c, FIT.cover, { x: CROP_ALIGN_X.right });
    const center = fillPlacement(SRC, BOX, c, FIT.cover);
    expect(left.x).toBe(0);
    expect(right.x).toBe(BOX.w - 400);
    expect(center.x).toBe((BOX.w - 400) / 2);
    // 縦は余らないので寄せても動かない。
    expect(left.y).toBe(fillPlacement(SRC, BOX, c, FIT.cover, { y: CROP_ALIGN_Y.top }).y);
  });

  it('縦の寄せも同じ（contain で余る軸）', () => {
    const p = (y?: 'top' | 'middle' | 'bottom') =>
      fillPlacement({ w: 100, h: 100 }, { w: 100, h: 200 }, { left: 0.5 }, FIT.contain, { y });
    // 残り 50×100 を収める倍率＝min(2, 2)=2 → 残りは 100×200 で縦は余らない…ので枠を変える。
    const q = (y?: 'top' | 'middle' | 'bottom') =>
      fillPlacement({ w: 100, h: 100 }, { w: 100, h: 400 }, { left: 0.5 }, FIT.contain, { y });
    expect(q(CROP_ALIGN_Y.top).y).toBe(0);
    expect(q(CROP_ALIGN_Y.bottom).y).toBeGreaterThan(q(CROP_ALIGN_Y.top).y);
    expect(q().y).toBeCloseTo((q(CROP_ALIGN_Y.top).y + q(CROP_ALIGN_Y.bottom).y) / 2, 6);
    expect(p().w).toBe(200);
  });

  it('壊れたデータ（合計が1以上）でも 0 で割らず、有限の矩形を返す', () => {
    const p = fillPlacement(SRC, BOX, { left: 0.9, right: 0.9 }, FIT.cover);
    expect(Number.isFinite(p.w)).toBe(true);
    expect(Number.isFinite(p.x)).toBe(true);
    expect(p.w).toBeGreaterThan(0);
  });

  it('負の指定は 0 として扱う（切り抜き無しと同じ）', () => {
    expect(fillPlacement(SRC, BOX, { left: -0.5 }, FIT.cover)).toEqual(fillPlacement(SRC, BOX, undefined, FIT.cover));
  });
});
