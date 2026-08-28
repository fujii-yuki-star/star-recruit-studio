// 書き出し前チェックの追加検査（#346）。純粋関数（§7 テスト対象）。
//
// ⚠️ **判定は描画と同じ関数を通す**（`layoutScene` が作ったアイテムを見る／折返しは `wrapText`）＝
// 別に数え直すと「チェックは通ったのに動画では切れている」が起きる。
import { wrapText } from '../text/textWrap';
import type { Asset, Scene } from './types';

/**
 * 文字が切り詰められたか（#346）。
 *
 * ⚠️ **「末尾が `…`」では見ない**（レビュー 🟡）＝利用者が自分で「つづく…」と書いて**枠に
 * 収まっている**文字まで要対応になり、示した次の行動（短くする・小さくする）に従っても
 * **永久に消えない**（§2-5＝行き止まりの案内）。**切った事実**＝折り返した結果を繋いだものが
 * 元の文と違うか、で見る。
 *
 * ⚠️ **両側から改行を落として比べる**（PR #877 レビュー 🟡）＝`wrapText` には安全弁があり、
 * **枠が1文字より狭いときは折り返さずに元の文をそのまま返す**（改行も消費しない）。
 * 片側だけ落とすと、その経路で**改行を含む文が必ず「切れている」になる**（誤検知）。
 * ⚠️ **狭すぎる枠そのものは別の壊れ方**＝文が枠からはみ出す（切り詰めではない）。ここでは扱わない
 *（「切れている文字」の案内〔短くする・小さくする〕では直らないため。見つけたら別で起票する）。
 */
function isTruncated(text: string, lines: readonly string[]): boolean {
  const strip = (v: string): string => v.replace(/\n/g, '');
  return strip(lines.join('')) !== strip(text);
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
    if (isTruncated(text, wrapText(text, w, fontSize, maxLines))) out.push(text);
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
  items: readonly { kind: string; assetId?: string | null; w?: number; h?: number; fit?: string }[],
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
    // ⚠️ **収め方で式が違う**（レビュー 🟡）＝`cover` は枠を**覆う**ので縦横のきつい側、
    // `contain` は枠に**収める**のでゆるい側が実際の倍率。ロゴと立ち絵は `contain` が既定なので、
    // きつい側で見ると**枠と縦横比が違うだけのロゴを「ぼやける」と誤検知**する。
    const need = it.fit === 'contain'
      ? Math.min(it.w / srcW, it.h / srcH)
      : Math.max(it.w / srcW, it.h / srcH);
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

export function tooFastScenes(scene: Scene, lineGroups: readonly (readonly string[])[]): boolean {
  // ⚠️ **同時に流す行は足さない**（レビュー 🟡・ADR-0031）＝2人が**同じ窓**でしゃべるので、
  // 素朴に合算すると**人数ぶん二重計上**する（40字×2人／8秒＝実効5字/秒なのに早口と言う）。
  // 窓を占めるのは**そのグループでいちばん長い行**なので、グループごとに最大を採って足す。
  const chars = lineGroups.reduce((n, g) => n + Math.max(0, ...g.map((t) => t.length)), 0);
  if (chars === 0 || !(scene.durationSec > 0)) return false;
  return chars / scene.durationSec > MAX_CHARS_PER_SEC;
}
