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
/**
 * 変わった画素の数の、許される幅（想定に対する倍率）。
 *
 * ⚠️ **下限は「想定の何割」で見る**（PR #1237 3回目 🟡）＝以前は `count * 6 < 想定` と書いており、
 * カーソルだけの想定が **5.35 画素**なので **`count < 0.89`＝0 のときしか鳴らなかった**
 *（0 は「何も描かれていない」で既に捕まる）。**鳴りえない門**を、前回の指摘と同じ型で作っていた。
 * ⚠️ **下限の値は実測から**＝明るい画面で 8〜9、暗い画面で 6〜7（想定 5.35）。4割なら落ちない。
 */
export const COUNT_HIGH = 3;
export const COUNT_LOW = 0.4;
/** 想定が小さいときの下限（⚠️ **1画素を「描けている」と認めない**）。 */
export const COUNT_LOW_FLOOR = 2;

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
  const {
    checkW = CHECK_W, checkH = CHECK_H, away: awayLimit = AWAY_LIMIT,
    high = COUNT_HIGH, low = COUNT_LOW, floor = COUNT_LOW_FLOOR,
  } = opts;
  if (!center) return "何も描かれていません＝焼く指定（式や絵）を見直してください";
  const at = toCheckPoint(want, size, checkW, checkH);
  const away = Math.hypot(center.x - at.x, center.y - at.y);
  if (away > awayLimit) {
    return `描かれた所が想定とずれています（縮めた絵で ${away.toFixed(2)} 画素）＝カーソルの絵か道筋か式を見直してください`;
  }
  const wantCount = expectedCheckCount(want, size, checkW, checkH);
  if (center.count > Math.max(4, wantCount * high)) {
    return `変わった所が広すぎます（${center.count} 画素・想定 ${wantCount.toFixed(1)}）＝別の変化が混ざっています。押したあとが落ち着くまで待ってから見てください`;
  }
  if (center.count < Math.min(wantCount, Math.max(floor, wantCount * low))) {
    return `描かれた所が薄すぎます（${center.count} 画素・想定 ${wantCount.toFixed(1)}）＝カーソルが欠けていないか見てください`;
  }
  return null;
}

/**
 * 横と縦で出した倍率が、どれだけ食い違ってよいか（割合）。
 *
 * ⚠️ **スクロールバーのぶんだけ、片側が小さく出る**＝縦のバーがあれば幅が、
 * 横のバーがあれば高さが縮む（Windows の既定でおよそ 15〜17 物理画素）。
 */
export const SCALE_AXIS_SLACK = 0.04;

/**
 * **録画から測った中身の矩形**が、1つの倍率で筋が通っているか。通っていれば空、違えば理由の並び。
 *
 * ⚠️ **これが `view` を作る唯一の根拠**（#1228）＝以前は `screenX - windowX` の引き算で
 * 原点を出し、**拡大率 100% 以外は断って**いた。いまは**測った矩形をそのまま正本にする**ので、
 * 突き合わせる「計算値」はもう無い。代わりに**測り違いを見つける**のがこの関数の仕事。
 *
 * @param bounds 録画から測った中身の矩形（物理 px）
 * @param page   ページが言っている大きさ（CSS px）と拡大率
 */
export function scaleVerdict(bounds, page) {
  const out = [];
  if (!(bounds.w > 0 && bounds.h > 0)) {
    out.push("中身の矩形が空です");
    return out;
  }
  const sx = bounds.w / page.width;
  const sy = bounds.h / page.height;
  // ⚠️ **大きいほうを採る**＝スクロールバーは縮める方向にしか効かない。
  const scale = Math.max(sx, sy);
  if (Math.abs(sx - sy) / scale > SCALE_AXIS_SLACK) {
    out.push(`横と縦で倍率が違います（横 ${sx.toFixed(3)} / 縦 ${sy.toFixed(3)}）＝別のものを測っている疑い`);
  }
  // ⚠️ **`devicePixelRatio` とは突き合わせない**（#1228・2026-09-25 に実測）＝
  //   外部ディスプレイでは**実際は 1.5 倍なのに `devicePixelRatio` が 1 と答えた**
  //  （同じ機械のノート側は 1.5 と答える）。**測った値のほうが正しい**ので、
  //   拡大率を根拠にすると**正しい回を落とす**。見るのは「横と縦で筋が通っているか」だけにする。
  return out;
}

/** 測った矩形から、焼く側が使う対応（`view`）を作る。 */
export function viewFromBounds(bounds, page) {
  const scale = Math.max(bounds.w / page.width, bounds.h / page.height);
  return {
    offsetX: bounds.x,
    offsetY: bounds.y,
    width: bounds.w,
    height: bounds.h,
    scale: Number(scale.toFixed(4)),
    cssWidth: page.width,
    cssHeight: page.height,
    dpr: page.dpr,
  };
}
