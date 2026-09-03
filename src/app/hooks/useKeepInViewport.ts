// 前へ出したものを**画面の中に収める**（#1023＝実機の指摘）。
//
// ⚠️ **見切れると、そこにある項目へ永久に手が届かない**＝メニューの下の方
// （「この欄を閉じる」「下へ移す」など）がソフトの外へ出ると、**押しようがない**。
// スクロールで追えるものでもない（`position: fixed` なので画面ごと動かない）。
//
// ⚠️ **大きさを見積もらない**＝もとは「1項目 34px × 件数 ＋ 余白8px」で高さを見積もって
// 寄せていたが、**実際は見積もりより大きくなる**（長い項目が2行に折り返す・余白や枠の実寸が違う）。
// 見積もりが小さいと**寄せたつもりで見切れる**。実物を測れば、その食い違いが構造的に無くなる。
//
// ⚠️ **描く前に直す**（`useLayoutEffect`）＝描いた後に直すと、**一瞬ずれた場所に出てから飛ぶ**。
//
// ⚠️ **画面より大きいときは、収まるところまで縮めて中でスクロールさせる**＝
// 上端で止めるだけだと**下がはみ出したまま**（＝下の項目に手が届かない）。
import { useLayoutEffect, useState, type RefObject } from "react";

/** 画面の端から最低これだけ空ける（枠にぴったり貼り付くと押しにくい）。 */
export const EDGE_MARGIN_PX = 8;

/**
 * **画面より大きいものは、収まるところまで縮めて中でスクロールさせる**（#1023）。
 *
 * ⚠️ **上端で止めるだけでは足りない**＝止めても**下がはみ出したまま**で、
 * そこにある項目に手が届かない（`position: fixed` なので画面ごとスクロールもできない）。
 *
 * ⚠️ **寄せ方が違うものでも、この規則は共有する**＝メニューは「押した点」に出し、
 * 色の面は「トリガーの下、入らなければ上」に出す＝**置き方は違うが、はみ出しの始末は同じ**。
 * 別々に書くと片方だけ直る（このリポジトリで繰り返している型）。
 *
 * @param height 中身の実寸（`scrollHeight`＝縮める前の高さ）。
 * @param viewportHeight 画面の高さ。
 */
export function overflowFallback(
  height: number,
  viewportHeight: number,
): { maxHeight: number; overflowY: "auto" } | null {
  const room = viewportHeight - EDGE_MARGIN_PX * 2;
  return height > room ? { maxHeight: room, overflowY: "auto" } : null;
}

export interface ViewportFit {
  /** 実際に置く位置（画面内に収めた後）。 */
  style: { left: number; top: number; maxHeight?: number; overflowY?: "auto" };
}

/**
 * `ref` の中身を測り、`x`/`y` を**画面の中へ収めた**位置を返す。
 *
 * @param ref 測る相手（`position: fixed` で置かれているもの）。
 * @param x 置きたい位置（左）。
 * @param y 置きたい位置（上）。
 * @param active 出ている間だけ測る（閉じているときに測らない）。
 */
export function useKeepInViewport(
  ref: RefObject<HTMLElement | null>,
  x: number,
  y: number,
  active: boolean,
): ViewportFit {
  // ⚠️ **最初は言われた場所に置く**＝測る前の1フレームは、要求どおりの位置で描く。
  // `useLayoutEffect` は描く前に走るので、ずれたまま見えることは無い。
  const [fit, setFit] = useState<ViewportFit["style"]>({ left: x, top: y });

  useLayoutEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el || typeof window === "undefined") return;
    // ⚠️ **中身の実寸で測る**＝`maxHeight` を掛けた後の高さではなく、掛ける前の高さが要る
    // （掛けた後を測ると、2回目以降は「収まっている」と読めて縮んだままになる）。
    const w = el.offsetWidth;
    const h = el.scrollHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const over = overflowFallback(h, vh);
    const left = Math.max(EDGE_MARGIN_PX, Math.min(x, vw - w - EDGE_MARGIN_PX));
    const top = over ? EDGE_MARGIN_PX : Math.max(EDGE_MARGIN_PX, Math.min(y, vh - h - EDGE_MARGIN_PX));
    setFit((prev) =>
      prev.left === left && prev.top === top && (prev.maxHeight ?? null) === (over?.maxHeight ?? null)
        ? prev // 変わらないなら同じものを返す（測るたびに描き直さない）
        : { left, top, ...(over ?? {}) },
    );
    // ⚠️ **中身が変わったら測り直す**＝項目の数や文言が変わると大きさも変わる。
  }, [ref, x, y, active]);

  // ⚠️ **閉じたときに位置を戻す効果は置かない**＝出し直すと前回の位置が1回だけ残るが、
  // 上の `useLayoutEffect` は**描く前**に走って直すので、**ずれた位置が見えることは無い**。
  // （置くと「効果の中で同期に state を更新している」ことになり、描き直しが連鎖する。）
  return { style: fit };
}
