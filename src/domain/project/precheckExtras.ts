// 書き出し前チェックの追加検査（#346）。純粋関数（§7 テスト対象）。
//
// ⚠️ **判定は描画と同じ関数を通す**（`layoutScene` が作ったアイテムを見る／折返しは `wrapText`）＝
// 別に数え直すと「チェックは通ったのに動画では切れている」が起きる。
import { wrapText } from '../text/textWrap';
import type { Asset, Scene } from './types';

/** 文字が切り詰められたか（`wrapText` は入りきらない末尾を `…` にする）。 */
function isTruncated(lines: readonly string[]): boolean {
  const last = lines[lines.length - 1];
  return typeof last === 'string' && last.endsWith('…');
}

/**
 * その場面に**切り詰められた文字**があるか（#346）。
 *
 * ⚠️ **「はみ出す」とは別の壊れ方**＝はみ出し（`subtitleOverflowsCanvas`）は画面の外へ出るもの、
 * こちらは**枠に入りきらず末尾が `…` に置き換わる**もの。後者は画面の中で完結するので
 * **見ただけでは「そう書いたのか」「切れたのか」が分からない**（だから書き出す前に知らせる）。
 * ⚠️ **描画と同じ数字で測る**＝`layoutScene` が作った文字アイテム（幅・字の大きさ・行数の上限）を
 * そのまま `wrapText` に通す。
 */
export function truncatedTexts(
  items: readonly { kind: string; text?: string; w?: number; fontSize?: number; maxLines?: number }[],
): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (it.kind !== 'text') continue;
    const { text, w, fontSize, maxLines } = it;
    if (!text || !w || !fontSize || !maxLines) continue;
    if (isTruncated(wrapText(text, w, fontSize, maxLines))) out.push(text);
  }
  return out;
}

/**
 * 引き伸ばしでぼやける素材（#346）。**描く枠より元の絵が小さい**ものを返す。
 *
 * ⚠️ **「小さい」だけでは判断しない**＝ロゴのように小さく置く素材は、元が小さくても問題ない。
 * **描かれる枠の大きさと比べる**（`layoutScene` のアイテムが持つ `w`/`h`）。
 * ⚠️ **少しの不足では出さない**＝等倍付近で警告を出すと、ほぼ全部の場面に注意が付いて読まれなくなる。
 */
export const BLURRY_SCALE_THRESHOLD = 1.5;

export function blurryAssets(
  items: readonly { kind: string; assetId?: string | null; w?: number; h?: number }[],
  assets: readonly Asset[],
): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (it.kind !== 'image' || !it.assetId || !it.w || !it.h) continue;
    const meta = assets.find((a) => a.assetId === it.assetId)?.metadata;
    const srcW = meta?.width;
    const srcH = meta?.height;
    // ⚠️ **測れていない素材は出さない**＝取り込み時に測れなかっただけで、ぼやけるとは限らない
    //（§2-5＝直しようが無い注意を出さない）。
    if (typeof srcW !== 'number' || typeof srcH !== 'number' || srcW <= 0 || srcH <= 0) continue;
    // 枠を覆うのに要る倍率（縦横のきつい側）。
    const need = Math.max(it.w / srcW, it.h / srcH);
    if (need >= BLURRY_SCALE_THRESHOLD && !out.includes(it.assetId)) out.push(it.assetId);
  }
  return out;
}

/**
 * 早口になりすぎるか（#346）。1秒あたりの文字数で見る。
 *
 * ⚠️ **「セリフの長さ」とは別**＝あちらは文字数そのもの（読みやすさ）、こちらは**尺に対して**多いか。
 * 短い場面に長いセリフを入れると、声は最後まで鳴るのに**場面が先に切り替わる**（声が途中で切れる）。
 * 目安は日本語の読み上げでおよそ 7〜8 文字/秒（ずんだもんの既定の速さ）。
 */
export const MAX_CHARS_PER_SEC = 9;

export function tooFastScenes(scene: Scene, lineTexts: readonly string[]): boolean {
  const chars = lineTexts.reduce((n, t) => n + t.length, 0);
  if (chars === 0 || !(scene.durationSec > 0)) return false;
  return chars / scene.durationSec > MAX_CHARS_PER_SEC;
}
