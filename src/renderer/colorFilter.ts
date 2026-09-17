// 色の調整（ADR-0044 ①）を SVG の `<filter>` へ落とす。**純粋関数**。
//
// ⚠️ **プレビューと書き出しは同じ道を通る**＝`layoutToSvg` が作った SVG を canvas で焼いて PNG にするので、
// **ここで効く表現は必ず一致する**（ADR-0044・⚠️ ただし**場面の中**だけ＝場面をまたぐ `xfade` は別）。
//
// ⚠️ **`color-interpolation-filters="sRGB"` を必ず付ける**＝SVG フィルタの既定は **linearRGB** で、
// 「明るさ 0.5」が画面上 **187** になる（実測）。**数字と見た目が合わなくなる**ので、付け忘れない。
//
// ⚠️ **判定を関数へ出す**（`CLAUDE.md §7`）＝SVG を組む所に埋めると、
// **焼いてみないと確かめられない**（＝誰も確かめない）形になる。

import type { ColorAdjust } from '../domain/template/types';

/** 何もしない値（未指定＝この値と同じ＝従来の出力は不変）。 */
export const COLOR_ADJUST_NEUTRAL = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
  temperature: 0,
} as const;

/**
 * **調整が要るか**（未指定・素の値なら `false`）。
 *
 * ⚠️ **要らないときは `<filter>` を出さない**＝出すと、**フィルタを通るだけで絵がわずかに変わる**
 * （縁の扱い・色空間の往復）。**従来の出力は不変**という約束を守るため、素通しにする。
 */
export function needsColorFilter(adjust: ColorAdjust | undefined): boolean {
  if (!adjust) return false;
  return (
    (adjust.brightness ?? 1) !== 1
    || (adjust.contrast ?? 1) !== 1
    || (adjust.saturation ?? 1) !== 1
    || (adjust.temperature ?? 0) !== 0
  );
}

/** 同じ調整は**同じ id**＝`<defs>` を共有できる（影と同じ流儀・重複は `layoutToSvg` が畳む）。 */
export function colorFilterId(adjust: ColorAdjust): string {
  const v = [adjust.brightness ?? 1, adjust.contrast ?? 1, adjust.saturation ?? 1, adjust.temperature ?? 0];
  return `color-${v.join('_').replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

/**
 * 色の調整を `<filter>` の中身へ。
 *
 * - **明るさ**＝`feComponentTransfer` の `slope`（RGB を同じ割合で持ち上げる）
 * - **コントラスト**＝同じく `slope` ＋ `intercept`（中心 0.5 のまま伸ばす）
 * - **彩度**＝`feColorMatrix type="saturate"`
 * - **色温度**＝赤と青を逆向きに動かす（暖色＝赤を上げ青を下げる）
 *
 * ⚠️ **順番が結果を変える**＝明るさ→コントラスト→彩度→色温度の順で掛ける。
 * 入れ替えると同じ数字でも別の絵になるので、**画面の並びとこの順番を揃える**。
 */
export function colorFilterBody(adjust: ColorAdjust): string {
  const b = adjust.brightness ?? 1;
  const c = adjust.contrast ?? 1;
  const s = adjust.saturation ?? 1;
  const t = adjust.temperature ?? 0;
  const parts: string[] = [];
  if (b !== 1 || c !== 1) {
    // 明るさ（slope=b）→ コントラスト（中心 0.5 を保って伸ばす）を1つの一次変換にまとめる。
    //   v1 = b·v ／ v2 = (v1 − 0.5)·c + 0.5 = (b·c)·v + 0.5·(1 − c)
    // ⚠️ **intercept に b を掛けない**（PR #1201 レビュー 🔴）＝掛けると
    // `b·[(v − 0.5)·c + 0.5]` ＝**コントラスト→明るさ**の順になり、**書いてある順と逆**になる。
    // 片方だけ動かすと式が一致するので、**両方動かす検査**でしか見つからない（実際、見つけたのはレビュー）。
    const slope = b * c;
    const intercept = 0.5 * (1 - c);
    const fn = (ch: string): string => `<feFunc${ch} type="linear" slope="${round(slope)}" intercept="${round(intercept)}"/>`;
    parts.push(`<feComponentTransfer>${fn('R')}${fn('G')}${fn('B')}</feComponentTransfer>`);
  }
  if (s !== 1) parts.push(`<feColorMatrix type="saturate" values="${round(s)}"/>`);
  if (t !== 0) {
    // 赤と青を逆向きへ。±1 で ±20% ぶん（それ以上動かすと色が壊れる）。
    const r = round(1 + t * 0.2);
    const bl = round(1 - t * 0.2);
    parts.push(`<feColorMatrix type="matrix" values="${r} 0 0 0 0  0 1 0 0 0  0 0 ${bl} 0 0  0 0 0 1 0"/>`);
  }
  return parts.join('');
}

/** 小数を短く（SVG を無駄に長くしない・同じ値なら同じ文字列＝id も安定）。 */
function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** `<defs>` ごと返す（呼ぶ側はこれを並べ、`filter="url(#id)"` を付ける）。 */
export function colorFilterDefs(adjust: ColorAdjust): string {
  const id = colorFilterId(adjust);
  // ⚠️ **`color-interpolation-filters="sRGB"`**＝既定（linearRGB）だと数字と見た目が合わない。
  return `<defs><filter id="${id}" color-interpolation-filters="sRGB">${colorFilterBody(adjust)}</filter></defs>`;
}
