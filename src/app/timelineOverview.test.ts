// タイムラインの全体図の帯（#1319 c2）の計算。
import { describe, expect, it } from "vitest";
import { overviewNeeded, overviewViewport, scrollLeftCenteredAt } from "./timelineOverview";

describe("overviewViewport", () => {
  it("名前の欄（貼り付き）を除いた幅が、見えている時間になる", () => {
    // 枠 600px・名前の欄 100px・36px/秒・送り 360px（10秒）→ 10〜(360+500)/36 秒
    const v = overviewViewport(360, 600, 100, 36, 60);
    expect(v.startSec).toBeCloseTo(10, 5);
    expect(v.endSec).toBeCloseTo(860 / 36, 5);
  });

  it("全体の長さを越えない・始まりは 0 より前にならない", () => {
    expect(overviewViewport(-50, 600, 100, 36, 5)).toEqual({ startSec: 0, endSec: 5 });
    expect(overviewViewport(10_000, 600, 100, 36, 60)).toEqual({ startSec: 60, endSec: 60 });
  });

  it("倍率・長さが 0 なら空", () => {
    expect(overviewViewport(0, 600, 100, 0, 60)).toEqual({ startSec: 0, endSec: 0 });
    expect(overviewViewport(0, 600, 100, 36, 0)).toEqual({ startSec: 0, endSec: 0 });
  });
});

describe("overviewNeeded", () => {
  it("全体が収まっていれば出さない・はみ出していれば出す", () => {
    expect(overviewNeeded({ startSec: 0, endSec: 60 }, 60)).toBe(false);
    expect(overviewNeeded({ startSec: 0, endSec: 59 }, 60)).toBe(true);
    expect(overviewNeeded({ startSec: 0, endSec: 0 }, 0)).toBe(false);
  });
});

describe("scrollLeftCenteredAt", () => {
  it("その時刻が見えている帯の真ん中に来る", () => {
    // 見えている帯は 500px。30秒×36=1080 → 1080-250=830
    expect(scrollLeftCenteredAt(30, 600, 100, 36, 5000)).toBe(830);
  });
  it("0 より前・最大より先へは送らない", () => {
    expect(scrollLeftCenteredAt(1, 600, 100, 36, 5000)).toBe(0);
    expect(scrollLeftCenteredAt(200, 600, 100, 36, 5000)).toBe(5000);
  });
});
