// 録画に**仮想カーソルを焼く**（#1227・ADR-0046 ③）。
//
// ⚠️ **押した位置と、印の出る位置がずれてはいけない**＝ずれは「**黙って別の場所を教える**」
// ことになり、教材として致命的（ADR-0026④）。だから**焼いたあとに機械で確かめる**（下記④）。
//
// ⚠️ **座標の対応は記録から採る**（#1226 が残した `view`）＝押した座標は**画面の中**の座標で、
// 録画は**窓の枠ごと**なので、**題字の帯と枠のぶんずれる**。推測しない。
//
// 使い方:
//   node scripts/tutorialCursor.mjs <録画.steps.json> [--out 出力.mp4]
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CURSOR_H, CURSOR_W, RIPPLE_SIZE, SCALE_NOT_100_MESSAGE,
  cursorAt, cursorPath, cursorPixels, expectedCursorCenter, expectedMarkCenter, positionExpr, ripplePixels, toVideoPoint,
} from "./lib/cursor.mjs";
import { FFMPEG, changedCenter, framesFromResult } from "./lib/frames.mjs";
import { parseOutDir } from "./lib/plan.mjs";

/** 押した瞬間の印が出ている長さ。 */
const RIPPLE_SEC = 0.45;
/**
 * 確かめ用の縮小の大きさ。
 *
 * ⚠️ **凍結を見るときより細かくする**（`frames.mjs` の 32×18 では**粗すぎた**）＝
 * カーソルは 24×36 なので、1296×838 を 32×18 まで縮めると**1画素未満に潰れて消える**
 *（実測＝「何も描かれていない」と出た）。ここは**同じ録画どうしの比較**なので細かくてよい。
 */
const CHECK_W = 160;
const CHECK_H = 100;
/**
 * 期待の重心から、どれだけ離れてよいか（縮めた絵の画素）。
 *
 * ⚠️ **6 は緩すぎた**（PR #1237 レビュー 🟡）＝正しく焼けているときのずれは**実測で 1 前後**なのに、
 * 6 まで許していた。**その約2倍**まで締める。
 *
 * ⚠️ **この検査で分かること・分からないこと**（実測して確かめた。**推測で書かない**）
 *  - 分かる＝カーソルや輪が**描かれていない／別の場所に描かれている**（絵・道筋・式の不具合）。
 *  - **分からない＝`toVideoPoint` そのものの不具合**。期待値も焼く位置も**同じ関数から出る**ので、
 *    両方が同じだけずれて**辻褄が合う**。実際に `view` のずれを丸ごと落として焼いたら、
 *    この検査は `✓` を出した（＝ここを締めただけでは塞がらない）。
 *  - だから**別の層で見る**：`toVideoPoint` の中身は `lib/cursor.test.mjs`（変異チェック済み）、
 *    `view` の値そのものは **`tutorialRecord.mjs` が録画から実測**して突き合わせる
 *   （撮り始めに目印を焼き、その矩形を測る＝`checkViewAgainstVideo`）。
 */
const AWAY_LIMIT = 2;
/** 変わった画素の数が、想定の何倍まで許されるか。 */
const COUNT_SLACK = 3;
/** 輪が消えてから、カーソルだけを見るまでの間（秒）。 */
const AFTER_RIPPLE_SEC = 0.2;
/** コマを取り出す時刻の、ほんの少し後ろ（⚠️ ちょうどの時刻は境目で前のコマを掴む）。 */
const NUDGE_SEC = 0.05;

function main() {
  const [logPath, ...rest] = process.argv.slice(2);
  if (!logPath) {
    console.error("使い方: node scripts/tutorialCursor.mjs <録画.steps.json> [--out 出力.mp4]");
    process.exit(2);
  }
  const log = JSON.parse(readFileSync(logPath, "utf8"));
  if (!log.view) throw new Error("記録に画面の対応（view）がありません＝#1226 の新しい版で録り直してください");
  // ⚠️ **焼く側でも断る**（PR #1237 レビュー 🟡）＝断っているのが**録る側だけ**だと、
  //   古い記録や手で書いた記録を渡して**門を迂回**できる。文は録る側と共有する。
  if (log.view.dpr !== 1) throw new Error(SCALE_NOT_100_MESSAGE(log.view.dpr));
  if (!existsSync(log.video)) throw new Error(`録画がありません: ${log.video}`);
  // ⚠️ **当たりは両方に置く**（#1234 で `tutorialRecord` に入れたのと同じ形に揃える）。
  if (!existsSync(FFMPEG)) throw new Error(`FFmpeg がありません: ${FFMPEG}`);
  // ⚠️ **`--out` が無いときに第1引数を出力先にしない**（#1234 で `lib/plan.mjs` へ切り出した当のバグ）。
  const out = parseOutDir(rest, log.video.replace(/\.mp4$/, ".cursor.mp4"));

  // ① 押した所を、録画の中の位置へ直す
  const points = log.steps.map((s) => ({ atSec: s.atSec, ...toVideoPoint(log.view, s.x, s.y) }));
  const path = cursorPath(points);
  if (path.length === 0) throw new Error("押した記録が1つもありません");

  // ② カーソルと輪の絵を作る（⚠️ **OS の矢印は使わない**＝環境依存になる）
  const dir = mkdtempSync(join(tmpdir(), "stario-cursor-"));
  const raw = join(dir, "cursor.rgba");
  const rippleRaw = join(dir, "ripple.rgba");
  writeFileSync(raw, Buffer.from(cursorPixels()));
  writeFileSync(rippleRaw, Buffer.from(ripplePixels()));

  // ③ 焼く。押した瞬間は輪も出す。
  // ⚠️ **輪は四角にしない**＝`drawbox` の四角は**UI の選択枠に見える**（焼いて見て分かった）。
  const half = RIPPLE_SIZE / 2;
  const rippleX = points.map((p) => `if(between(t,${p.atSec},${(p.atSec + RIPPLE_SEC).toFixed(2)}),${Math.round(p.x - half)},`).join("");
  const rippleY = points.map((p) => `if(between(t,${p.atSec},${(p.atSec + RIPPLE_SEC).toFixed(2)}),${Math.round(p.y - half)},`).join("");
  // ⚠️ **出さないときは画面の外へ逃がす**＝`enable` はフィルタ全体にしか掛けられないので、位置で消す。
  const hide = `${-RIPPLE_SIZE}${")".repeat(points.length)}`;
  // ⚠️ **1コマの絵は `eof_action=repeat` で最後まで出し続ける**（既定だが、明示して意図を残す）。
  // ⚠️ **位置の式は `lib` から採る**（PR #1237 レビュー 🟡）＝ここで組み立てていた頃は、
  //   `cursorAt` と**同じ意味を2つの言語で二重に書いた**形になっていた（端の扱いまで別々）。
  const filter =
    `[0:v][2:v]overlay=eof_action=repeat:x='${rippleX}${hide}':y='${rippleY}${hide}'[marked];` +
    `[marked][1:v]overlay=eof_action=repeat:x='${positionExpr(path, "x")}':y='${positionExpr(path, "y")}'`;
  // ⚠️ **式はファイルで渡す**（PR #1237 レビュー 🟡）＝1段で約500字伸びるので、引数に載せると
  //   **60段あたりで Windows の上限（32,767字）に当たる**。当たり方が最悪で、コマンドが起動できず
  //   `r.error` になる（＝段数が増えたときだけ、理由の分からない失敗になる）。ファイルなら上限が消える。
  const filterFile = join(dir, "filter.txt");
  writeFileSync(filterFile, filter, "utf8");

  const r = spawnSync(FFMPEG, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", log.video,
    "-f", "rawvideo", "-pix_fmt", "rgba", "-video_size", `${CURSOR_W}x${CURSOR_H}`, "-framerate", "1", "-i", raw,
    "-f", "rawvideo", "-pix_fmt", "rgba", "-video_size", `${RIPPLE_SIZE}x${RIPPLE_SIZE}`, "-framerate", "1", "-i", rippleRaw,
    "-filter_complex_script", filterFile,
    "-c:v", "h264_mf", "-b:v", "8000k", "-pix_fmt", "yuv420p", "-t", String(log.totalSec), out,
  ], { encoding: "utf8" });
  // ⚠️ **起こせなかった回も理由を出す**（#1234 で `framesFromResult` に入れたのと同じ）＝
  //   `r.error` を見ないと「焼けませんでした:」だけが出て、原因が消える。
  if (r.error) throw new Error(`FFmpeg を起こせません: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`焼けませんでした:\n${r.stderr ?? ""}`);
  console.log(`焼きました: ${out}`);

  // ④ ⚠️ **押した所に出ているかを機械で確かめる**（ここを省くと、黙って別の場所を教える）
  const size = videoSize(log.video);
  const bad = [];
  /** 焼く絵の**重心**（`want`）と、実際に変わった所の中心を比べる。 */
  const 見る = (atSec, want, なに) => {
    const before = frameAt(log.video, atSec);
    const after = frameAt(out, atSec);
    const c = changedCenter(before, after, CHECK_W);
    if (!c) { bad.push(`${atSec.toFixed(2)}s ${なに}：何も描かれていない`); return; }
    const wantX = (want.x / size.w) * CHECK_W;
    const wantY = (want.y / size.h) * CHECK_H;
    const away = Math.hypot(c.x - wantX, c.y - wantY);
    if (away > AWAY_LIMIT) {
      bad.push(`${atSec.toFixed(2)}s ${なに}：描かれた所が想定とずれている（縮めた絵で ${away.toFixed(2)} 画素）`);
      return;
    }
    // ⚠️ **広さも見る**（PR #1237 レビュー 🟡）＝画面そのものの変化が混ざっていると、重心は
    //   たまたま近くに出ることがある。**焼いた絵の画素数**から想定を出して、桁で外れたら断る。
    const 想定 = (want.count / (size.w * size.h)) * (CHECK_W * CHECK_H);
    if (c.count > Math.max(4, 想定 * COUNT_SLACK)) {
      bad.push(`${atSec.toFixed(2)}s ${なに}：変わった所が広すぎる（${c.count} 画素・想定 ${想定.toFixed(1)}）＝別の変化が混ざっている`);
    }
  };

  for (const p of points) 見る(p.atSec + NUDGE_SEC, expectedMarkCenter(p), "押した瞬間");

  // ⚠️ **カーソルだけの時刻も見る**（PR #1237 レビュー 🟡）＝輪は左右対称で重心が押した点そのものなので、
  //   押した瞬間だけ見ていると**カーソルが1画素も描かれていなくても通る**。ここで初めて
  //   `positionExpr`・`cursorPath`・`cursorPixels` が検査に入る。
  const 静止 = stillTimes(path, points, log.totalSec);
  // ⚠️ **1つも無いまま通さない**＝窓の取り方を間違えると、この検査が**黙って0回**になる
  //   （＝輪だけ見ていた頃へ戻る）。数が0なら止める。
  if (静止.length === 0) throw new Error("カーソルだけが写っている時刻がありません＝押す間隔が詰まりすぎです");
  // ⚠️ **期待は `cursorAt` から採る**＝押した点で固定すると、**動いている最中**を掴んだときに
  //   誤検出する（実測＝22 画素ずれて落ちた。カーソルは既に次の場所へ動き始めていた）。
  for (const t of 静止) 見る(t, expectedCursorCenter(cursorAt(path, t)), "カーソルだけ");

  if (bad.length > 0) throw new Error(`押した所に印が出ていません:\n  ${bad.join("\n  ")}`);
  console.log(`✓ ${points.length} か所すべて、押した所に印が出ています（輪だけでなくカーソル本体も見ました）`);
}

/**
 * **カーソルが止まっていて、輪も出ていない**時刻（カーソル本体だけを見るため）。
 *
 * ⚠️ **止まっている所を選ぶ**＝動いている最中は、コマの取り出しが 1/15 秒ずれるだけで
 * 30 画素ほど動く（実測）。そこを見ると**正しく焼けていても落ちる**。
 * ⚠️ **並びの形（3つ組）に頼らない**＝`cursorPath` の作り方が変わっても効くよう、
 * **同じ位置が続く区間**として拾う。
 */
function stillTimes(path, points, totalSec) {
  const spans = [];
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    if (a.x === b.x && a.y === b.y && b.atSec > a.atSec) spans.push([a.atSec, b.atSec]);
  }
  const last = path[path.length - 1];
  spans.push([last.atSec, totalSec]);

  const out = [];
  for (const [from, to] of spans) {
    // 輪が出ている間は外す（カーソルだけを見たいので）
    let s0 = from;
    for (const p of points) {
      if (p.atSec <= s0 && s0 < p.atSec + RIPPLE_SEC) s0 = p.atSec + RIPPLE_SEC + AFTER_RIPPLE_SEC;
    }
    const s1 = Math.min(to, totalSec - NUDGE_SEC * 2);
    if (s1 - s0 < 0.15) continue;
    if (points.some((p) => s0 < p.atSec + RIPPLE_SEC && p.atSec < s1)) continue;
    out.push(Number(((s0 + s1) / 2).toFixed(3)));
  }
  return out;
}

/**
 * その時刻の、小さく縮めた白黒のコマ。
 *
 * ⚠️ **`-ss` は `-i` の後ろ**＝前に置くと**速いが不正確**で、2つの録画で**別のコマ**を取り出す
 *（実測＝そのせいで「何も描かれていない」と出た）。ここは正確さを採る。
 * ⚠️ **箱平均で縮める**＝`frames.mjs` と同じ理由。既定の bicubic は極端な縮小で元画素の大半を見ないので、
 * **3画素幅の細い輪**が消えうる（ここは 1296→160 の約8倍）。
 */
function frameAt(file, atSec) {
  const r = spawnSync(FFMPEG, [
    "-hide_banner", "-loglevel", "error", "-i", file, "-ss", String(atSec),
    "-frames:v", "1", "-vf", `scale=${CHECK_W}:${CHECK_H}:flags=area`, "-pix_fmt", "gray", "-f", "rawvideo", "-",
  ], { maxBuffer: 1 << 24 });
  // ⚠️ **取り出しの失敗を黙って `null` にしない**（#1234 で `framesFromResult` に入れたのと同じ）。
  const frames = framesFromResult(r, file, CHECK_W * CHECK_H);
  if (frames.length === 0) throw new Error(`${file} の ${atSec}s のコマを取り出せません（録画がそこまで無い？）`);
  return frames[0];
}

/**
 * 録画の実寸（⚠️ **推測しない**＝窓の枠の厚みは環境で変わる。読み取る）。
 */
function videoSize(file) {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-i", file], { encoding: "utf8" });
  const m = /, (\d+)x(\d+)[ ,]/.exec(`${r.stdout ?? ""}${r.stderr ?? ""}`);
  if (!m) throw new Error(`録画の大きさを読めません: ${file}`);
  return { w: Number(m[1]), h: Number(m[2]) };
}

main();
