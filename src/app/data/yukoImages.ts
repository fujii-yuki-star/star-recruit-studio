// 同梱の「ゆうこ」立ち絵（#1228）。
//
// ⚠️ **置き場と名前は1か所だけに書く**（`CLAUDE.md` §2-7／§6）＝画面のあちこちに
// `"/yuko/yuko_smile_001.png"` と書き写すと、差し替えたときに**片方だけ古い絵**になる。
//
// ⚠️ **`poseTag` は自由文字列で、enum ではない**（`11 §3.5`＝「enum固定しない」・`17:51` も同じ。
// PR #1243 レビュー ℹ️＝ここを「正典の語彙7つ」と書いていたので、閉じた値集合に読めた）。
// 下の7つは **`17 §3` が挙げている例**で、**同梱ぶんがそれを全部満たしている**という意味。
// 利用者が足す素材はプロジェクト側（`assetType = "yuko"` ＋ `tags`）に入り、知らない tag も来うる。
//
// ⚠️ **正典の7つはすべて揃っている**（2026-09-25）＝当たらない tag が来たら `normal` へ落とす。

/** 同梱している立ち絵の poseTag → ファイル（`17 §3` が挙げる7つが全部そろっている）。 */
export const BUNDLED_YUKO = {
  normal: "/yuko/yuko_normal_001.png",
  smile: "/yuko/yuko_smile_001.png",
  think: "/yuko/yuko_think_001.png",
  guide: "/yuko/yuko_guide_001.png",
  bow: "/yuko/yuko_bow_001.png",
  surprise: "/yuko/yuko_surprise_001.png",
  cheer: "/yuko/yuko_cheer_001.png",
} as const;

// ⚠️ **ここに書いた絵だけが配布物に入る**（#1228）＝`public/yuko/` は「使うぶん」で、
//   原本は `assets/yuko/poses/`（`thanks` / `sad` / `angry` / `sleepy` / `run` もそこにある）。
//   使いたくなったら**原本から `public/yuko/` へ複製して、ここに1行足す**。
//   ⚠️ 逆に、ここから消すときは `public/yuko/` のファイルも消す（配布物に死んだ絵を残さない）。

export type BundledYukoPose = keyof typeof BUNDLED_YUKO;

/**
 * 既定の顔（`poseTag` が解決できないときに出すもの）。
 *
 * ⚠️ **`normal`（標準・つなぎ）**＝`17 §3`「既定素材は通常 `yuko_normal_001`」に合わせる。
 * 画面ごとに出したい顔があるときは、**呼ぶ側が `pose` で指定する**（既定に寄りかからない）。
 */
export const DEFAULT_YUKO_POSE: BundledYukoPose = "normal";

/**
 * その poseTag の絵（無ければ既定）。
 *
 * ⚠️ **無い tag を渡されても落とさない**＝画面が消えるより、既定の顔が出るほうがよい。
 */
export function yukoImage(pose?: string | null): string {
  if (pose && pose in BUNDLED_YUKO) return BUNDLED_YUKO[pose as BundledYukoPose];
  return BUNDLED_YUKO[DEFAULT_YUKO_POSE];
}
