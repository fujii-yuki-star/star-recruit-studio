// 焼いた印が**押した所に出ているか**の判定（#1227・PR #1237 再レビュー 🟡）。**純粋関数**。
//
// ⚠️ **切り出した理由**＝ここが判定なので、**ffmpeg を起こさずに検査できる**ようにする
//（`lib/plan.mjs` と `lib/frames.mjs` が同じ理由で切り出されている。走らせる所に置いたままだと、
// **いちばん効かせたい判定が変異チェックに掛からない**）。
//
// ⚠️ **この判定で分かること・分からないこと**（実測して確かめた。**推測で書かない**）
//  - 分かる＝カーソルや輪が**描かれていない／別の場所に描かれている**（絵・道筋・式の不具合）。
//  - **分からない＝`toVideoPoint` そのものの不具合**。期待値も焼く位置も**同じ `view`** から出るので、
//    両方が同じだけずれて辻褄が合う（実測＝ずれを丸ごと落として焼いても通った）。
//    そちらは `tutorialRecord.mjs` が**録画から実測**して見る（`viewVerdict`）。

/**
 * 確かめ用に縮める大きさ。
 *
 * ⚠️ **凍結を見るときより細かくする**（`frames.mjs` の 32×18 では**粗すぎた**）＝
 * カーソルは 24×36 なので、1296×838 を 32×18 まで縮めると**1画素未満に潰れて消える**
 *（実測＝「何も描かれていない」と出た）。ここは**同じ録画どうしの比較**なので細かくてよい。
 */
export const CHECK_W = 160;
export const CHECK_H = 100;
/**
 * 期待の重心から、どれだけ離れてよいか（**縮めた絵**の画素）。
 *
 * ⚠️ **6 は緩すぎた**（PR #1237 レビュー 🟡）＝正しく焼けているときのずれは**実測で 1 前後**なのに、
 * 6 まで許していた。**その約2倍**まで締める。
 * ⚠️ **原寸ではどれくらいか**（同 再レビュー ℹ️）＝1296×838 を 160×100 に縮めているので、
 * **横に約 16 画素・縦に約 8 画素**。カーソルが 24×36 であることを思うと、
 * 「2」という見た目ほど厳しくはない（**ここを下げるなら `CHECK_W/H` を上げる**のが筋）。
 */
export const AWAY_LIMIT = 2;
/** 変わった画素の数が、想定の何倍まで／何分の1まで許されるか。 */
export const COUNT_HIGH = 3;
export const COUNT_LOW = 6;

/**
 * 録画の画素の位置 → **縮めた検査の格子**の位置。
 *
 * ⚠️ **画素の中心で測る**（PR #1237 再レビュー ℹ️）＝単純に比を掛けると、**常に半画素ぶん外側**へ寄る
 *（`cursorPixels`／`ripplePixels` が画素の中心で形を決めているのと同じ約束）。
 */
export function toCheckPoint(want, size, checkW = CHECK_W, checkH = CHECK_H) {
  return {
    x: ((want.x + 0.5) / size.w) * checkW - 0.5,
    y: ((want.y + 0.5) / size.h) * checkH - 0.5,
  };
}

/** 焼いた絵の画素数 → 縮めた格子で何画素ぶんになるか。 */
export function expectedCheckCount(want, size, checkW = CHECK_W, checkH = CHECK_H) {
  return (want.count / (size.w * size.h)) * (checkW * checkH);
}

/**
 * 変わった所が、**焼いた絵の重心**と合っているか。合っていれば `null`、違えば**次の行動を含む文**。
 *
 * ⚠️ **数も見る**＝位置だけだと、①画面そのものの変化が混ざって**たまたま近く**に出た回と、
 * ②カーソルが**数画素しか描かれていない**回を、どちらも通してしまう（実測で後者は `!center` にならない）。
 */
export function markVerdict(center, want, size, opts = {}) {
  const { checkW = CHECK_W, checkH = CHECK_H, away: awayLimit = AWAY_LIMIT, high = COUNT_HIGH, low = COUNT_LOW } = opts;
  if (!center) return "何も描かれていません＝焼く指定（式や絵）を見直してください";
  const at = toCheckPoint(want, size, checkW, checkH);
  const away = Math.hypot(center.x - at.x, center.y - at.y);
  if (away > awayLimit) {
    return `描かれた所が想定とずれています（縮めた絵で ${away.toFixed(2)} 画素）＝カーソルの絵か道筋か式を見直してください`;
  }
  const want数 = expectedCheckCount(want, size, checkW, checkH);
  if (center.count > Math.max(4, want数 * high)) {
    return `変わった所が広すぎます（${center.count} 画素・想定 ${want数.toFixed(1)}）＝別の変化が混ざっています。押したあとが落ち着くまで待ってから見てください`;
  }
  if (center.count * low < want数) {
    return `描かれた所が薄すぎます（${center.count} 画素・想定 ${want数.toFixed(1)}）＝カーソルが欠けていないか見てください`;
  }
  return null;
}

/** 測った中身の位置が、計算した `view` からどれだけ離れてよいか（画素）。 */
export const VIEW_ORIGIN_SLACK = 2;
/**
 * 測った中身の**幅／高さ**の許容（下向きだけ）。
 *
 * ⚠️ **スクロールバーのぶんだけ小さく出る**＝目印は `position:fixed` なので、
 * 縦のスクロールバーがあれば**幅**が、横のスクロールバーがあれば**高さ**がその幅ぶん縮む
 *（Windows の既定でおよそ 15〜17 画素）。**それ以上の食い違いは本物**。
 * ⚠️ **幅の根拠を高さに使い回さない**（PR #1237 再レビュー 🟡）＝以前は幅に 24、高さにも同じ 24 を
 * 当てていた。24 の出どころは**縦**スクロールバーの話なので、高さ側は根拠のない緩みだった。
 * ⚠️ **「窓がタスクバーの下に潜って下端が欠ける」はここで見ない**＝それは撮る前に
 * `workArea()` で断る（緩めて通すのではなく、**原因の所で止める**）。
 */
export const VIEW_WIDTH_SHRINK = 20;
export const VIEW_HEIGHT_SHRINK = 20;
export const VIEW_SIZE_GROW = 2;

/**
 * **録画から測った中身の矩形**が、計算した `view` と合っているか。合っていれば空、違えば理由の並び。
 *
 * ⚠️ **これが `view` を見る唯一の目**＝計算した値で描いて同じ値で検査しても、間違いは見えない。
 */
export function viewVerdict(bounds, view, opts = {}) {
  const {
    origin = VIEW_ORIGIN_SLACK, wShrink = VIEW_WIDTH_SHRINK, hShrink = VIEW_HEIGHT_SHRINK, grow = VIEW_SIZE_GROW,
  } = opts;
  const out = [];
  if (Math.abs(bounds.x - view.offsetX) > origin) out.push(`左 ${bounds.x}（計算では ${view.offsetX}）`);
  if (Math.abs(bounds.y - view.offsetY) > origin) out.push(`上 ${bounds.y}（計算では ${view.offsetY}）`);
  if (bounds.w < view.width - wShrink || bounds.w > view.width + grow) out.push(`幅 ${bounds.w}（計算では ${view.width}）`);
  if (bounds.h < view.height - hShrink || bounds.h > view.height + grow) out.push(`高さ ${bounds.h}（計算では ${view.height}）`);
  return out;
}
