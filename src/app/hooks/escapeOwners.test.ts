// `Escape` を受け持っているものの名簿（#701 レビュー）。**受け手が自分で名乗る**ことで、
// いちばん外側の後始末（選択を解く）が同時に走るのを防ぐ。
import { describe, expect, it } from "vitest";
import { claimEscape, hasEscapeOwner } from "./escapeOwners";

describe("escapeOwners（#701）", () => {
  it("名乗っている間だけ「受け手がいる」になる", () => {
    expect(hasEscapeOwner()).toBe(false);
    const release = claimEscape();
    expect(hasEscapeOwner()).toBe(true);
    release();
    expect(hasEscapeOwner()).toBe(false);
  });

  it("重なっても数が合う（内側が外れても外側は残る）", () => {
    const outer = claimEscape();
    const inner = claimEscape();
    inner();
    expect(hasEscapeOwner()).toBe(true); // 外側はまだ受け持っている
    outer();
    expect(hasEscapeOwner()).toBe(false);
  });

  it("二重に外しても数がずれない（外し忘れの逆＝効かなくならない）", () => {
    const release = claimEscape();
    release();
    release();
    expect(hasEscapeOwner()).toBe(false);
    const other = claimEscape();
    expect(hasEscapeOwner()).toBe(true);
    other();
  });
});
