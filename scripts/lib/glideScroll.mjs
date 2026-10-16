// 撮影のとき、スクロールを**ゆっくり滑らせる**（使い方の動画の録画用）。
//
// ⚠️ **一瞬で飛ぶと、見ている人にはスクロールしたことが分からない**（2026-10-16 利用者の指摘）＝
//   押す相手を探す式（`FIND_BY_TEXT` など）は `scrollIntoView` で相手を画面へ入れるが、これは**一瞬で飛ぶ**ので、
//   録画では「画面がパッと切り替わった」ように見える。
// ⚠️ **アプリには手を入れない**＝録画の道具が、撮っている画面の `scrollIntoView` だけを差し替える（撮影の間だけ）。
// ⚠️ **見えているものは動かさない**＝相手がすでに欄の中に見えていれば何もしない（毎回中央へ寄せると映像が揺れる）。

/**
 * 滑らせる長さ（ミリ秒）。距離が長いほど少し長く、ただし長すぎない（見ている人が待たされない）。
 * ⚠️ 中で自分以外を参照しない＝撮っている画面へ文字列として送る（`toString()`）。
 */
export function glideDurationMs(distancePx) {
  const d = Math.abs(distancePx);
  return Math.round(Math.min(1400, Math.max(600, 450 + d * 0.6)));
}

/** 始めと終わりをなめらかに（0〜1 → 0〜1）。⚠️ 同上＝自分以外を参照しない。 */
export function easeInOut(t) {
  const u = Math.min(1, Math.max(0, t));
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

/**
 * 撮っている画面へ送る式。`scrollIntoView` を「ゆっくり滑らせる」版に差し替える。
 * 滑り終わる時刻を `window.__tutGlideUntil`（ミリ秒・`Date.now()` の目盛り）に残す＝押す前にそこまで待つ。
 *
 * ⚠️ **一コマずつは `setTimeout` で進める**（`requestAnimationFrame` ではない）＝隠れた窓では rAF が来ず、
 *   滑りが**途中で止まったまま**押すことになる（窓をまたぐ写しで実際に踏んだ）。
 * ⚠️ **入れ子の欄は内側から**＝内側を動かすと相手の位置が変わるので、外側はその分を差し引いて決める。
 */
export const GLIDE_SCROLL_INSTALL = `(() => {
  if (window.__tutGlideInstalled) return "already";
  window.__tutGlideInstalled = true;
  window.__tutGlideUntil = 0;
  const glideDurationMs = ${glideDurationMs.toString()};
  const easeInOut = ${easeInOut.toString()};
  const scrollers = (el) => {
    const out = [];
    for (let p = el.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      const y = /(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight;
      const x = /(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth;
      if (x || y) out.push(p);
    }
    const se = document.scrollingElement;
    if (se && !out.includes(se) && (se.scrollHeight > se.clientHeight || se.scrollWidth > se.clientWidth)) out.push(se);
    return out;
  };
  // 見えていなければ、欄の中央へ来るだけ動かす（動かせる範囲に収める）。
  const need = (lo, hi, boxLo, boxHi, pos, max) => {
    if (lo >= boxLo && hi <= boxHi) return 0;
    const want = (lo + hi) / 2 - (boxLo + boxHi) / 2;
    return Math.min(max - pos, Math.max(-pos, want));
  };
  let target = null;
  Element.prototype.scrollIntoView = function () {
    if (target === this && Date.now() < window.__tutGlideUntil) return; // 同じ相手へ滑っている途中なら、やり直さない
    const r = this.getBoundingClientRect();
    let shiftX = 0;
    let shiftY = 0;
    const moves = [];
    for (const p of scrollers(this)) {
      const root = p === document.scrollingElement;
      const b = root ? { top: 0, left: 0, bottom: innerHeight, right: innerWidth } : p.getBoundingClientRect();
      const dy = need(r.top - shiftY, r.bottom - shiftY, b.top, b.bottom, p.scrollTop, p.scrollHeight - p.clientHeight);
      const dx = need(r.left - shiftX, r.right - shiftX, b.left, b.right, p.scrollLeft, p.scrollWidth - p.clientWidth);
      if (dx !== 0 || dy !== 0) moves.push({ p, x0: p.scrollLeft, y0: p.scrollTop, dx, dy });
      shiftX += dx;
      shiftY += dy;
    }
    if (moves.length === 0) return;
    const far = Math.max(...moves.map((m) => Math.max(Math.abs(m.dx), Math.abs(m.dy))));
    const dur = glideDurationMs(far);
    const t0 = Date.now();
    target = this;
    window.__tutGlideUntil = t0 + dur + 50;
    const step = () => {
      const k = easeInOut((Date.now() - t0) / dur);
      for (const m of moves) m.p.scrollTo({ left: m.x0 + m.dx * k, top: m.y0 + m.dy * k, behavior: "instant" });
      if (k < 1) setTimeout(step, 16);
    };
    step();
  };
  return "installed";
})()`;

/** 滑り終わるまでの残り（ミリ秒・0 以上）。 */
export const GLIDE_REMAINING_MS = `Math.max(0, (window.__tutGlideUntil || 0) - Date.now())`;
