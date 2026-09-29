// 仕上がり確認の別窓の置き場所（ADR-0050 決定7）。
import { describe, expect, it } from 'vitest';
import { PREVIEW_WINDOW_MIN_H, PREVIEW_WINDOW_MIN_W, pickPreviewWindowRect } from './previewWindowRect';

const left = { x: 0, y: 0, w: 1920, h: 1040 };
const right = { x: 1920, y: 0, w: 2560, h: 1400 };
const mainOnLeft = { x: 100, y: 50, w: 1600, h: 900 };

describe('pickPreviewWindowRect（別窓の置き場所・ADR-0050）', () => {
  it('2画面目があれば、本体の居ない画面に縁を少し残して大きく出す', () => {
    const r = pickPreviewWindowRect([left, right], mainOnLeft, null)!;
    expect(r).toEqual({ x: 1920 + 128, y: 70, w: 2560 - 256, h: 1400 - 140 });
  });

  it('画面が1枚なら、本体と同じ画面の右寄りに並べて置ける大きさで出す', () => {
    const r = pickPreviewWindowRect([left], mainOnLeft, null)!;
    expect(r.w).toBe(1152); // 1920×0.6（上限 1280 の内）
    expect(r.h).toBe(728); // 1040×0.7（上限 800 の内）
    expect(r.x + r.w).toBeLessThanOrEqual(left.w);
    expect(r.y).toBeGreaterThanOrEqual(0);
  });

  it('覚えた位置が画面に入っていれば、そのまま使う', () => {
    const saved = { x: 2000, y: 100, w: 1200, h: 800 };
    expect(pickPreviewWindowRect([left, right], mainOnLeft, saved)).toEqual(saved);
  });

  // 2画面目を外した後に、覚えた位置へ開くと窓が見えない（調査の Premiere Pro・AviUtl の壊れ方）。
  it('覚えた位置がどの画面にも入っていなければ捨てて、既定へ戻す', () => {
    const saved = { x: 2000, y: 100, w: 1200, h: 800 }; // 右の画面を外した
    const r = pickPreviewWindowRect([left], mainOnLeft, saved)!;
    expect(r.x + r.w).toBeLessThanOrEqual(left.w);
    expect(r).not.toEqual(saved);
  });

  it('覚えた大きさが画面より大きければ画面に収め、はみ出した分だけ中へ寄せる', () => {
    const saved = { x: 1500, y: 600, w: 3000, h: 900 }; // 中心（3000, 1050）は右の画面
    const r = pickPreviewWindowRect([left, right], mainOnLeft, saved)!;
    expect(r.w).toBe(right.w);
    expect(r.x).toBe(right.x);
    expect(r.y + r.h).toBeLessThanOrEqual(right.y + right.h);
  });

  it('小さすぎる覚えは最小の大きさまで広げる', () => {
    const r = pickPreviewWindowRect([left], mainOnLeft, { x: 10, y: 10, w: 100, h: 50 })!;
    expect(r.w).toBe(PREVIEW_WINDOW_MIN_W);
    expect(r.h).toBe(PREVIEW_WINDOW_MIN_H);
  });

  it('本体の位置が分からなければ、最初の画面へ', () => {
    const r = pickPreviewWindowRect([left, right], null, null)!;
    expect(r.x + r.w).toBeLessThanOrEqual(left.w);
  });

  it('画面が分からなければ null（窓の既定に任せる）', () => {
    expect(pickPreviewWindowRect([], mainOnLeft, null)).toBeNull();
  });
});
