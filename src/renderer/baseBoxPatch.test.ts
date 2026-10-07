// 描かれている場所での箱の変更を、素の箱の変更へ戻す（ADR-0054 段階1）。
// ⚠️ **往復で確かめる**＝戻した素の箱に同じ動きを当て直すと、掴んで置いた所（描かれている場所）に戻ること。
import { describe, expect, it } from "vitest";
import { applyInterpolatedTransform } from "./layout";
import { baseBoxPatchFromShown } from "./timelineLayout";

const box = { x: 100, y: 50, w: 200, h: 100, rotation: 0 };
const shownOf = (b: typeof box, tr: Parameters<typeof applyInterpolatedTransform>[1]) => {
  const r = { ...b };
  applyInterpolatedTransform(r, tr);
  return r;
};

describe("baseBoxPatchFromShown", () => {
  it("動きの無い部品はそのまま", () => {
    expect(baseBoxPatchFromShown({ box, ownTr: {} }, { x: 130, y: 70 })).toEqual({ x: 130, y: 70 });
  });

  it("平行移動の動き＝掴んだ量だけ素の箱が動く", () => {
    const tr = { x: 400, y: -20 };
    const shown = shownOf(box, tr);
    expect(baseBoxPatchFromShown({ box, ownTr: tr }, { x: shown.x + 30, y: shown.y + 10 })).toEqual({ x: 130, y: 60 });
  });

  it.each([
    [{ scale: 2 }],
    [{ scale: 0.5, x: 40 }],
    [{ scale: 1.5, x: -30, y: 25, rotation: 30 }],
  ])("拡縮・回転の動き（%o）でも、戻した箱に動きを当て直すと置いた所に戻る（往復）", (tr) => {
    const shown = shownOf(box, tr);
    const placed = { x: shown.x + 37, y: shown.y - 12, w: shown.w * 1.2, h: shown.h * 0.9, rotation: (shown.rotation ?? 0) + 15 };
    const patch = baseBoxPatchFromShown({ box, ownTr: tr }, placed);
    const back = shownOf({ ...box, ...patch } as typeof box, tr);
    expect(back.x).toBeCloseTo(placed.x, 6);
    expect(back.y).toBeCloseTo(placed.y, 6);
    expect(back.w).toBeCloseTo(placed.w, 6);
    expect(back.h).toBeCloseTo(placed.h, 6);
    expect(back.rotation).toBeCloseTo(placed.rotation, 6);
  });

  it("動かしただけ（大きさを渡さない）なら、大きさは書かない", () => {
    const patch = baseBoxPatchFromShown({ box, ownTr: { scale: 2 } }, { x: 0, y: 0 });
    expect(patch.w).toBeUndefined();
    expect(patch.h).toBeUndefined();
  });
});
