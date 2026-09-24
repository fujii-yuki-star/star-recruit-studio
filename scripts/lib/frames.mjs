// 録画が**本当に動いているか**を、コマの中身で数える（#1226・ADR-0046）。
//
// ⚠️ **なぜ要るか**＝`gdigrab` で窓を名前指定して撮ると、WebView2 の GPU 合成を拾えず
// **全コマが同じ絵**になる。**エラーは出ず、もっともらしい絵ができる**ので、
// 知らずに撮ると**中身が実物と違う教材**を配ることになる（ADR-0046・実測）。
//
// ⚠️ **「ファイルができた」は成功の証拠にならない**＝#1137・#1140 と同じ型
//（**あるか**ではなく**中身**で見る）。ここがその「中身で見る」側。
//
// ⚠️ **ffmpeg のフィルタに頼らない**＝試した2つは使えなかった。
//  - `mpdecimate`（重複コマを落とす）＝**このビルドに無い**（LGPL 版）
//  - `freezedetect`＝**最後の区間を報告しない**（`freeze_end` が出ないので合計が実態より小さく出る。
//    5秒の静止画で 1.07秒としか言わない＝**門が鳴らない**）
// → **生の画素を取り出して自分で比べる**。判定は純粋関数なので**そのまま検査できる**。

import { spawnSync } from "node:child_process";

/** 比べる大きさ。⚠️ 小さくするほど符号化の粗が消え、大きくするほど小さな変化を拾う。 */
export const SAMPLE_W = 32;
export const SAMPLE_H = 18;
/** 1画素を「違う」と見なす明るさの差。⚠️ 0 にすると**符号化の粗だけで別の絵**になる（実測）。 */
export const PIXEL_TOLERANCE = 6;
/** 画面の何割が違えば「別の絵」か。 */
export const DIFF_RATIO = 0.02;

/**
 * 2つのコマが**同じ絵**か（明るさの差と、違う画素の割合で見る）。
 *
 * ⚠️ **完全一致で見ない**＝h264 は不可逆なので、**同じ画面でも1画素ずつ僅かに違う**。
 * 完全一致で数えると、静止画5秒の録画が「違う絵5枚」になった（実測）。
 */
export function sameFrame(a, b, tolerance = PIXEL_TOLERANCE, ratio = DIFF_RATIO) {
  if (a.length !== b.length) return false;
  let differing = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (Math.abs(a[i] - b[i]) > tolerance) differing += 1;
  }
  return differing / a.length <= ratio;
}

/**
 * 並んだコマの中に、**違う絵が何枚あるか**。
 *
 * ⚠️ **連続で比べない**＝行ったり来たりする画面（開いて閉じる）で数が増えてしまう。
 * **今まで見た絵のどれとも違うとき**だけ数える。
 */
export function distinctFrames(frames, tolerance = PIXEL_TOLERANCE, ratio = DIFF_RATIO) {
  const seen = [];
  for (const f of frames) {
    if (!seen.some((s) => sameFrame(f, s, tolerance, ratio))) seen.push(f);
  }
  return seen.length;
}

/**
 * 録画から**小さな白黒のコマ**を取り出す（1秒あたり `fps` 枚）。
 *
 * ⚠️ **生の画素で受け取る**＝PNG を解く道具を足さずに済む（Node に無い）。
 */
export function sampleFrames(ffmpeg, file, fps = 2) {
  const r = spawnSync(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-i", file,
    "-vf", `fps=${fps},scale=${SAMPLE_W}:${SAMPLE_H}`,
    "-pix_fmt", "gray", "-f", "rawvideo", "-",
  ], { maxBuffer: 1 << 28 });
  const buf = r.stdout ?? Buffer.alloc(0);
  const size = SAMPLE_W * SAMPLE_H;
  const out = [];
  for (let i = 0; i + size <= buf.length; i += size) out.push(buf.subarray(i, i + size));
  return out;
}

/**
 * 2つのコマで**変わった所の中心**（縮めた座標系）。変わっていなければ `null`。
 *
 * ⚠️ **焼いたものが、押した所に出ているかを確かめるために使う**（#1227）＝
 * 「描いたつもり」で**別の場所に出ている**のを捕まえる唯一の手。
 */
export function changedCenter(before, after, width, tolerance = 24) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i < before.length; i += 1) {
    if (Math.abs(before[i] - after[i]) > tolerance) {
      sx += i % width;
      sy += Math.floor(i / width);
      n += 1;
    }
  }
  return n === 0 ? null : { x: sx / n, y: sy / n, count: n };
}
