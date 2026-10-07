// @vitest-environment jsdom
// 前へ出したものが**画面の中に収まる**（#1023＝実機の指摘）。
//
// ⚠️ **見切れると、そこにある項目へ永久に手が届かない**＝メニューの下の方
// （「この欄を閉じる」「下へ移す」など）がソフトの外へ出ると押しようがない
// （`position: fixed` なので画面ごとスクロールもできない）。
import { beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useRef } from "react";
import { EDGE_MARGIN_PX, overflowFallback, useKeepInViewport } from "./useKeepInViewport";

/** jsdom には配置が無いので、測る値をこちらで決める。 */
function Box({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { style } = useKeepInViewport(ref, x, y, true);
  // ⚠️ **測る値は ref コールバックで入れる**＝jsdom には配置が無く `offsetWidth` は常に 0。
  // 描画中に入れても**まだ要素が無く**、`useLayoutEffect` の中で入れても**測った後**になる。
  // ref コールバックは要素が付いた瞬間・レイアウト効果より**前**に走るので、ここが唯一の場所。
  const attach = (el: HTMLDivElement | null): void => {
    ref.current = el;
    if (!el) return;
    Object.defineProperty(el, "offsetWidth", { value: w, configurable: true });
    Object.defineProperty(el, "scrollHeight", { value: h, configurable: true });
  };
  return <div ref={attach} data-testid="box" style={{ position: "fixed", ...style }} />;
}

const at = (x: number, y: number, w = 200, h = 300): CSSStyleDeclaration =>
  (render(<Box x={x} y={y} w={w} h={h} />).getByTestId("box") as HTMLElement).style;

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
});

describe("useKeepInViewport（#1023）", () => {
  it("収まる場所なら、言われたところに出す", () => {
    const s = at(100, 100);
    expect(s.left).toBe("100px");
    expect(s.top).toBe("100px");
  });

  // ⚠️ **ここが実機で起きたこと**＝下の方で開くと、下側の項目が画面の外へ出ていた。
  it("下がはみ出すなら、上へ寄せる（画面の中に収める）", () => {
    const s = at(100, 700); // 700 + 300 = 1000 > 800
    expect(s.top).toBe(`${800 - 300 - EDGE_MARGIN_PX}px`);
  });

  it("右がはみ出すなら、左へ寄せる", () => {
    const s = at(900, 100); // 900 + 200 = 1100 > 1000
    expect(s.left).toBe(`${1000 - 200 - EDGE_MARGIN_PX}px`);
  });

  it("左・上へ出そうとしても、画面の外へは出さない", () => {
    const s = at(-50, -50);
    expect(s.left).toBe(`${EDGE_MARGIN_PX}px`);
    expect(s.top).toBe(`${EDGE_MARGIN_PX}px`);
  });

  // ⚠️ **上端で止めるだけでは足りない**＝止めても下がはみ出したままになる。
  it("画面より高いときは、収まるところまで縮めて中でスクロールさせる", () => {
    const s = at(100, 100, 200, 1200); // 画面（800）より高い
    expect(s.top).toBe(`${EDGE_MARGIN_PX}px`);
    expect(s.maxHeight).toBe(`${800 - EDGE_MARGIN_PX * 2}px`);
    expect(s.overflowY).toBe("auto");
  });
});

// ⚠️ **はみ出しの始末は、置き方が違うものでも共有する**（メニューと色の面）。
describe("overflowFallback（縮めて中でスクロール）", () => {
  it("収まるなら何もしない", () => {
    expect(overflowFallback(300, 800)).toBeNull();
  });

  it("画面より高いときだけ、収まる高さを返す", () => {
    expect(overflowFallback(1200, 800)).toEqual({ maxHeight: 800 - EDGE_MARGIN_PX * 2, overflowY: "auto" });
  });

  // ⚠️ **端の余白ぶんも数える**＝画面と同じ高さでも、余白があるので入らない。
  it("画面とちょうど同じ高さでも、余白のぶん入らない", () => {
    expect(overflowFallback(800, 800)).not.toBeNull();
  });
});
