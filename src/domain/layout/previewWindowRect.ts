// 仕上がり確認を出す別窓の**置き場所**（ADR-0050 決定7）。純粋関数（§4・§7）。
//
// ⚠️ **見えない窓を作らない**＝2画面目を外した後に、覚えた位置へそのまま開くと窓が画面の外に出る
// （調査で Premiere Pro・AviUtl が踏んでいた壊れ方）。覚えた位置は**どこかの画面に入っているときだけ**使う。
// 座標はどれも**論理座標**（拡大率で割った値）＝窓の作成に渡す値と同じ単位。

export interface WindowRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 別窓の最小の大きさ＝これより小さいと絵も操作の行も収まらない。 */
export const PREVIEW_WINDOW_MIN_W = 480;
export const PREVIEW_WINDOW_MIN_H = 320;
/** 画面1枚のときの既定の大きさの上限（本体の横に並べて置く大きさ）。 */
const SINGLE_SCREEN_MAX_W = 1280;
const SINGLE_SCREEN_MAX_H = 800;
/** 2画面目に出すときの縁（画面いっぱいより少し内側＝掴んで動かせる縁を残す）。 */
const SECOND_SCREEN_INSET_RATIO = 0.05;

const centerOf = (r: WindowRect): { x: number; y: number } => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const contains = (r: WindowRect, p: { x: number; y: number }): boolean =>
  p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

/**
 * 別窓を開く位置と大きさ。
 * 1. **覚えた位置**＝中心がどこかの画面に入っていれば使う（大きさはその画面に収める）。
 * 2. **2画面目がある**＝本体の中心が入っていない画面に、縁を少し残して大きく出す。
 * 3. **画面が1枚**＝本体と同じ画面の右寄りに、並べて置ける大きさで出す。
 * 画面が1枚も分からないときは `null`（＝窓の既定に任せる）。
 */
export function pickPreviewWindowRect(
  monitors: readonly WindowRect[],
  mainRect: WindowRect | null,
  saved: WindowRect | null,
): WindowRect | null {
  if (monitors.length === 0) return null;
  if (saved) {
    const home = monitors.find((m) => contains(m, centerOf(saved)));
    if (home) {
      const w = Math.max(PREVIEW_WINDOW_MIN_W, Math.min(saved.w, home.w));
      const h = Math.max(PREVIEW_WINDOW_MIN_H, Math.min(saved.h, home.h));
      // はみ出した分だけ中へ寄せる（大きさを収めた後で、左上がその画面の中に来るように）。
      const x = Math.min(Math.max(saved.x, home.x), home.x + home.w - w);
      const y = Math.min(Math.max(saved.y, home.y), home.y + home.h - h);
      return { x, y, w, h };
    }
  }
  const mainCenter = mainRect ? centerOf(mainRect) : null;
  const other = mainCenter ? monitors.find((m) => !contains(m, mainCenter)) : undefined;
  if (other) {
    const dx = Math.round(other.w * SECOND_SCREEN_INSET_RATIO);
    const dy = Math.round(other.h * SECOND_SCREEN_INSET_RATIO);
    return { x: other.x + dx, y: other.y + dy, w: other.w - dx * 2, h: other.h - dy * 2 };
  }
  const home = (mainCenter && monitors.find((m) => contains(m, mainCenter))) ?? monitors[0];
  const w = Math.max(PREVIEW_WINDOW_MIN_W, Math.min(SINGLE_SCREEN_MAX_W, Math.round(home.w * 0.6)));
  const h = Math.max(PREVIEW_WINDOW_MIN_H, Math.min(SINGLE_SCREEN_MAX_H, Math.round(home.h * 0.7)));
  return { x: home.x + home.w - w - Math.round(home.w * 0.02), y: home.y + Math.round((home.h - h) / 2), w, h };
}
