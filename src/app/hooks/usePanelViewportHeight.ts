// 欄の器を「画面の残り」いっぱいにする（#1104・実機の指摘②③）。
//
// ⚠️ **実機で「最大3列しか見えない」と分かった**（2026-09-10）＝器が `76vh` の決め打ちで、
// その上に貼り付く見出しの行（`.editor-header`）と余白が乗るので、**器の下が画面からはみ出す**。
// 初期表示では帯より上の3行しか見えず、下まで送っても帯は3列ぶんしか出なかった。
//
// ⚠️ **ページのスクロールは残す**＝器の**下**に「注意」の知らせがあり、見出しの行のバッジから
// スクロールして辿り着く作りになっている（`fill` で器いっぱいにすると**その知らせに永久に届かない**）。
// だから「器を画面いっぱいにする」のではなく、**貼り付く見出しのぶんを引いた高さ**にする。
import { useEffect, useState } from "react";
import { EDITOR_HEADER_CLASS } from "../components/EditorToolbar";

/**
 * 器の高さ（CSS の式）。
 *
 * ⚠️ **純粋関数として出す**＝実際の高さは実機でしか見られないので、
 * 「何を引いているか」だけは検査で留める。`--gap` は器の下の余白ぶん。
 */
export function panelLayoutHeight(headerPx: number): string {
  const h = Number.isFinite(headerPx) ? Math.max(0, Math.round(headerPx)) : 0;
  return `calc(100vh - ${h}px - var(--gap))`;
}

/**
 * 貼り付く見出しの行（`.editor-header`）の高さ（px）。
 *
 * ⚠️ **`position: sticky; top: 0` なので、常に画面の上を占める**＝器が使えるのは
 * 「画面の高さ − この高さ」。見出しは文字の折り返しで高さが変わる（窓幅を変えると変わる）ので、
 * **測り直す**。
 * ⚠️ **測れない場では 0**（`ResizeObserver` の無い場・テスト環境）＝そのとき器は `100vh - 余白` になり、
 * いまより狭くはならない（悪化させない側へ倒す）。
 */
export function useStickyHeaderHeight(): number {
  const [px, setPx] = useState(0);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = document.querySelector(`.${EDITOR_HEADER_CLASS}`);
    if (!el) return;
    const measure = (): void => setPx(el.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return px;
}
