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

/**
 * 同梱の FFmpeg（**撮る側・焼く側で同じもの**を使う）。
 *
 * ⚠️ **写して増やさない**（PR #1237 レビュー 🟡）＝`tutorialRecord.mjs` と `tutorialCursor.mjs` が
 * **同じ文字列を別々に持って**いた。片方だけ直すと、**違うビルドの ffmpeg で撮って焼く**ことになる。
 */
export const FFMPEG = "src-tauri/resources/ffmpeg/bin/ffmpeg.exe";

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
 * ⚠️ **並び順に依る**（PR #1234 レビュー ℹ️）＝`sameFrame` は推移律を満たさないので、
 * 同じコマの集まりでも**並べ替えると数が変わりうる**。**目安であって指標ではない**
 *（「2以上か」の判定に使うのはよいが、記録の数を後から再現できるとは思わないこと）。
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
export function sampleFrames(ffmpeg, file, fps = 2, from = null, to = null, crop = null) {
  const seek = from == null ? [] : ["-ss", String(from)];
  const span = to == null ? [] : ["-to", String(to)];
  // ⚠️ **押した所の周りだけを見られるようにする**（#1228・実測）＝全画面を 32x18 まで縮めると、
  //   **選択の強調だけ**の変化（カードを選んだ等）は消えてしまい、「絵が動いていない」と誤って出る。
  const cut = crop == null ? "" : `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},`;
  const r = spawnSync(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-i", file, ...seek, ...span,
    // ⚠️ **箱平均で縮める**（PR #1234 レビュー ℹ️）＝既定の bicubic は**極端な縮小で元画素の大半を見ない**
    //   ので、同じ絵でも値が揺れ、小さな変化はかえって消える。`area` なら面積に比例して効く。
    "-vf", `fps=${fps},${cut}scale=${SAMPLE_W}:${SAMPLE_H}:flags=area`,
    "-pix_fmt", "gray", "-f", "rawvideo", "-",
  ], { maxBuffer: 1 << 28 });
  return framesFromResult(r, file);
}

/**
 * `spawnSync` の結果を、コマの並びにする。
 *
 * ⚠️ **取り出しの失敗を「コマ0枚」にしない**（PR #1234 レビュー 🟡）＝原因が消え、
 * **録画そのものの失敗**として報告されてしまう（直す先を間違える）。
 * ⚠️ **切り出してある理由**＝ここが判定なので、**ffmpeg を起こさずに検査できる**ようにする。
 */
export function framesFromResult(r, file = "(録画)", size = SAMPLE_W * SAMPLE_H) {
  if (r.error) throw new Error(`コマを取り出せません（${file}）: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`コマを取り出せません（${file}）:\n${r.stderr ?? ""}`);
  const buf = r.stdout ?? Buffer.alloc(0);
  const out = [];
  for (let i = 0; i + size <= buf.length; i += size) out.push(buf.subarray(i, i + size));
  return out;
}

/** 「変わった」と見なす明るさの差。⚠️ `PIXEL_TOLERANCE` より粗い＝**はっきり描かれた所だけ**拾う。 */
export const CHANGE_TOLERANCE = 24;

/**
 * 2つのコマで**広く変わった矩形**（行・列ごとに見る）。無ければ `null`。
 *
 * ⚠️ **何のためにあるか**＝**画面の中身が録画のどこに写っているか**を、**測って**確かめる
 *（#1227・PR #1237 レビュー 🟡）。`view` のずれは `screenX - windowX` の**引き算で出した値**なので、
 * それを使って描き、それを使って検査する限り、**間違っていても辻褄が合ってしまう**
 *（実測＝ずれを丸ごと落としても検査は `✓` を出した）。**独立した物差し**がここ。
 * ⚠️ **中心ではなく矩形**＝目印は画面いっぱいに出すので、**四隅の位置**が要る。
 * ⚠️ **行・列の「何割変わったか」で見る**＝1画素の外れ値で矩形が広がらない。
 */
export function changedBounds(before, after, width, tolerance = CHANGE_TOLERANCE, fill = 0.5) {
  if (before.length !== after.length) throw new Error(`比べるコマの大きさが違います: ${before.length} と ${after.length}`);
  const height = before.length / width;
  const rows = new Array(height).fill(0);
  const cols = new Array(width).fill(0);
  let count = 0;
  for (let i = 0; i < before.length; i += 1) {
    if (Math.abs(before[i] - after[i]) > tolerance) {
      rows[Math.floor(i / width)] += 1;
      cols[i % width] += 1;
      count += 1;
    }
  }
  const span = (arr, full) => {
    const hit = arr.map((n) => n >= full * fill);
    const from = hit.indexOf(true);
    return from < 0 ? null : { from, to: hit.lastIndexOf(true) };
  };
  const ys = span(rows, width);
  const xs = span(cols, height);
  if (!ys || !xs) return null;
  return { x: xs.from, y: ys.from, w: xs.to - xs.from + 1, h: ys.to - ys.from + 1, count };
}

/**
 * 2つのコマで**変わった所の中心**（縮めた座標系）。変わっていなければ `null`。
 *
 * ⚠️ **焼いたものが、押した所に出ているかを確かめるために使う**（#1227）＝
 * 「描いたつもり」で**別の場所に出ている**のを捕まえる唯一の手。
 */
export function changedCenter(before, after, width, tolerance = CHANGE_TOLERANCE) {
  // ⚠️ **長さが違えば見ない**（PR #1237 レビュー ℹ️）＝姉妹の `sameFrame` は見ているのに、ここは
  //   見ていなかった。短いと `before[i] - undefined` が `NaN` になり、**黙って数え落とす**
  //  （最悪 `null`＝「何も描かれていない」と誤報する）。
  if (before.length !== after.length) throw new Error(`比べるコマの大きさが違います: ${before.length} と ${after.length}`);
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
