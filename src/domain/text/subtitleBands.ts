// 字幕帯の積み方（ADR-0031 同時字幕）。純粋関数（副作用なし・§7 テスト対象）。
//
// **描画（renderer）と焼き出し（domain・#633）が同じ関数を共有する**ためここに置く。
// 場面形式は「1つの字幕層に帯を積む」、タイムライン形式は「行ごとの字幕クリップ」だが、
// **どこに置くか（y）は同じ規則**でなければ、焼く前と焼いた後で字幕の位置が変わる（ADR-0001 の流儀）。
import { DEFAULT_LINE_HEIGHT } from '../template/textStyle';
import { wrapText } from './textWrap';

/** 字幕帯の背景の上下パディング（em）。`sceneSvg` の `bgHeight = 行間×行数 + 0.6*fontSize` と一致（帯の下端＝y + 行間 + これ）。 */
export const SUBTITLE_BAND_PAD_EM = 0.6;
/** 同時字幕（ADR-0031）で2人目以降を上へ積むときの帯間の余白（em）。**実際の折返し行数**で詰めたうえで、この隙間を空ける（重ならない）。 */
export const SUBTITLE_STACK_GAP_EM = 0.4;

/**
 * 同時字幕（ADR-0031）の帯を下→上に積んだときの、各帯の anchor y と上端 top（キャンバス座標・px）。
 * `bandTexts[0]` が下（primary）＝`baseY`。以降は**実際の折返し行数**（`wrapText`）で詰め、`anchorBottom` の
 * 上伸び（行が増えると上端が上がる）を見込んで次帯の下端を前帯の上端＋gap 上へ置く＝2行でも重ならない。
 *
 * 描画（`layoutScene`）・はみ出し判定（`subtitleOverflowsCanvas`）・焼き出し（`bakeTimelineProject`）が
 * この1つを共有する（drift 防止・#533 P1/P2・#633）。
 */
export function stackedSubtitleBands(
  bandTexts: string[],
  baseY: number,
  w: number,
  fontSize: number,
  maxLines: number,
): { y: number; top: number }[] {
  const lineHeightPx = fontSize * DEFAULT_LINE_HEIGHT;
  const bottomOffsetPx = lineHeightPx + fontSize * SUBTITLE_BAND_PAD_EM; // anchor y から帯の下端まで
  const gapPx = fontSize * SUBTITLE_STACK_GAP_EM;
  const out: { y: number; top: number }[] = [];
  let prevTop = Number.POSITIVE_INFINITY;
  bandTexts.forEach((t, i) => {
    const y = i === 0 ? baseY : prevTop - gapPx - bottomOffsetPx;
    const n = wrapText(t, w, fontSize, maxLines).length; // 実際の折返し行数（描画と同じ wrapText）
    const top = y - (n - 1) * lineHeightPx; // この帯の上端（anchorBottom で上へ伸びるぶんを反映）
    out.push({ y, top });
    prevTop = top;
  });
  return out;
}

/**
 * 文字アイテムが**実際に描かれる**矩形（キャンバス座標・px）。
 *
 * ⚠️ **「置いた箱」ではなく「描かれるもの」で見る**（α-6 出口監査 ℹ️）＝字幕は `anchorBottom` で
 * 上へ伸び、高さは**実際の折返し行数**＋帯のパディングで決まるので、`h` をそのまま使うと
 * **画面外の判定（`subtitleItemOutOfCanvas`）と別の矩形**を見ることになる。
 * 「端に寄った文字」の注意（`outsideSafeArea`）と画面外の断りが**同じものを見る**ようにここへ出す。
 */
export function drawnTextRect(item: {
  x: number; y: number; w: number; h: number; rotation?: number;
  text: string; fontSize: number; maxLines: number; anchorBottom?: boolean; isSubtitle?: boolean;
}): { x: number; y: number; w: number; h: number; rotation?: number } {
  // 字幕でなければ置いた箱のまま（写真・見出しは箱に収める前提で組んである）。
  if (!item.isSubtitle) return { x: item.x, y: item.y, w: item.w, h: item.h, rotation: item.rotation };
  const n = wrapText(item.text, item.w, item.fontSize, item.maxLines).length;
  const lineHeightPx = item.fontSize * DEFAULT_LINE_HEIGHT;
  return {
    x: item.x,
    y: item.y - (item.anchorBottom ? (n - 1) * lineHeightPx : 0), // 帯背景の上端（`sceneSvg` と一致）
    w: item.w,
    h: lineHeightPx * n + item.fontSize * SUBTITLE_BAND_PAD_EM,
    rotation: item.rotation,
  };
}
