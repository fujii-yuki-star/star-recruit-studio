import { describe, expect, it } from "vitest";
import { PREVIEW_TOP_RESERVE_PX, containBox, fallbackWidthCss } from "./previewFit";

describe("containBox（プレビュー内接・縦型はみ出し対策）", () => {
  it("横型（16:9）は幅が制約＝幅に合わせて高さが決まる", () => {
    // availW=1600, availH=1000。幅比=1600/1920=0.833, 高さ比=1000/1080=0.926 → 幅が min。
    expect(containBox(1920, 1080, 1600, 1000)).toEqual({ width: 1600, height: 900 });
  });

  it("【縦型 9:16】高さが制約＝はみ出さないよう高さに合わせて幅が決まる（本バグの要）", () => {
    // 縦型 canvas 1080x1920 を availW=900, availH=588（viewport 720 のプレビュー高予算）に内接。
    // 幅比=900/1080=0.833, 高さ比=588/1920=0.30625 → 高さが min。box 高さ = 1920*0.30625 = 588 ≤ availH。
    const box = containBox(1080, 1920, 900, 588);
    expect(box).toEqual({ width: 330, height: 588 });
    expect(box.height).toBeLessThanOrEqual(588); // availH を超えない＝画面内に収まる
  });

  it("使える領域が 0/負なら {0,0}（計測前として扱う）", () => {
    expect(containBox(1080, 1920, 0, 588)).toEqual({ width: 0, height: 0 });
    expect(containBox(1080, 1920, 900, 0)).toEqual({ width: 0, height: 0 });
    expect(containBox(0, 0, 900, 588)).toEqual({ width: 0, height: 0 });
  });
});

describe("fallbackWidthCss（JS 計測前/空振り時の縦型はみ出し防止）", () => {
  it("縦型は幅を (100vh − 予備) × cw/ch で絞る＝箱高さが viewport 内に収まる", () => {
    expect(fallbackWidthCss(1080, 1920)).toBe(
      `min(100%, calc((100vh - ${PREVIEW_TOP_RESERVE_PX}px) * 1080 / 1920))`,
    );
  });

  it("横型も同式（幅は 100% 側が効きやすい）", () => {
    expect(fallbackWidthCss(1920, 1080)).toBe(
      `min(100%, calc((100vh - ${PREVIEW_TOP_RESERVE_PX}px) * 1920 / 1080))`,
    );
  });

  it("不正な canvas は 100%（従来動作）へフォールバック", () => {
    expect(fallbackWidthCss(0, 1920)).toBe("100%");
  });
});
