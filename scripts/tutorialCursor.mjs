// 録画に**仮想カーソルを焼く**（#1227・ADR-0046 ③）。
//
// ⚠️ **押した位置と、印の出る位置がずれてはいけない**＝ずれは「**黙って別の場所を教える**」
// ことになり、教材として致命的（ADR-0026④）。だから**焼いたあとに機械で確かめる**（下記⑤）。
//
// ⚠️ **座標の対応は記録から採る**（#1226 が残した `view`）＝押した座標は**画面の中**の座標で、
// 録画は**窓の枠ごと**なので、**題字の帯と枠のぶんずれる**。推測しない。
//
// ⚠️ **判定は `lib/burnCheck.mjs` にある**（PR #1237 再レビュー 🟡）＝ここに置いたままだと
// **いちばん効かせたい判定が変異チェックに掛からない**。ここに残すのは ffmpeg を起こす側だけ。
//
// 使い方:
//   node scripts/tutorialCursor.mjs <録画.steps.json> [--out 出力.mp4]
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CURSOR_H, CURSOR_W, RIPPLE_SEC, RIPPLE_SIZE, SCALE_NOT_100_MESSAGE, SETTLE_SEC, TRAVEL_SEC,
  cursorAt, cursorPath, cursorPixels, expectedCursorCenter, expectedMarkCenter, positionExpr, ripplePixels,
  stillTimes, toVideoPoint,
} from "./lib/cursor.mjs";
import { CHECK_H, CHECK_W, markVerdict } from "./lib/burnCheck.mjs";
import { FFMPEG, changedCenter, framesFromResult } from "./lib/frames.mjs";
import { checkRecordLog, parseOutDir } from "./lib/plan.mjs";

/** コマを取り出す時刻の、ほんの少し後ろ（⚠️ ちょうどの時刻は境目で前のコマを掴む）。 */
const NUDGE_SEC = 0.05;

function main() {
  const [logPath, ...rest] = process.argv.slice(2);
  if (!logPath) {
    console.error("使い方: node scripts/tutorialCursor.mjs <録画.steps.json> [--out 出力.mp4]");
    process.exit(2);
  }
  // ⚠️ **記録も台本と同じように確かめる**（PR #1237 再レビュー ℹ️）＝欠けたまま進むと
  //   ffmpeg のエラー文で落ちて**原因が読めない**（`totalSec` が無いと `NaN` の比較が全部 false になる）。
  const log = checkRecordLog(JSON.parse(readFileSync(logPath, "utf8")));
  // ⚠️ **焼く側でも断る**（PR #1237 レビュー 🟡）＝断っているのが**録る側だけ**だと、
  //   古い記録や手で書いた記録を渡して**門を迂回**できる。文は録る側と共有する。
  if (log.view.dpr !== 1) throw new Error(SCALE_NOT_100_MESSAGE(log.view.dpr));
  if (!existsSync(log.video)) throw new Error(`録画がありません: ${log.video}`);
  // ⚠️ **当たりは両方に置く**（#1234 で `tutorialRecord` に入れたのと同じ形に揃える）。
  if (!existsSync(FFMPEG)) throw new Error(`FFmpeg がありません: ${FFMPEG}`);
  // ⚠️ **`--out` が無いときに第1引数を出力先にしない**（#1234 で `lib/plan.mjs` へ切り出した当のバグ）。
  const out = parseOutDir(rest, log.video.replace(/\.mp4$/, ".cursor.mp4"));

  // ① ⚠️ **撮り始めの目印を切り落とす**（PR #1237 再レビュー 🟡）＝`tutorialRecord` は
  //   `view` を実測するために**画面いっぱいの目印**を焼き付ける。切らないと**配る素材の頭に
  //   全画面のマゼンタが載る**（記録に切る場所は書いてあるのに、**読む者が一人も居なかった**）。
  // ⚠️ **コマ境界へ丸めてから切る**（PR #1237 3回目 🟡）＝`trim` は秒ではなく**コマ**で切るので、
  //   端数のまま渡すと**焼いた側の t=0 が `trimSec + δ`**（δ は最大 1/fps）になり、
  //   検査の2つの時間軸（元＝`atSec + trimSec` / 焼き後＝`atSec`）が**1コマずれる**ことがある。
  //   止まっている所は無害だが、**押した瞬間は画面が遷移中**なので、そのずれが丸ごと
  //   「変わった所」に乗って「広すぎます」の誤検出になる。
  const fps = log.fps;
  const trimSec = fps > 0 ? Math.ceil((log.usableFromSec ?? 0) * fps) / fps : (log.usableFromSec ?? 0);
  const totalSec = log.totalSec - trimSec;
  if (totalSec <= 0) throw new Error(`目印を切ると何も残りません（全体 ${log.totalSec}s / 切る ${trimSec}s）＝録り直してください`);

  // ② 押した所を、録画の中の位置へ直す（時刻は**切ったぶん**だけ前へ寄せる）
  const points = log.steps.map((s) => ({ atSec: Number((s.atSec - trimSec).toFixed(3)), ...toVideoPoint(log.view, s.x, s.y) }));
  const path = cursorPath(points);
  if (path.length === 0) throw new Error("押した記録が1つもありません");
  // ⚠️ **切った所より前から動き始めていないか**＝カーソルが**いきなり画面の途中から現れる**。
  if (path[0].atSec < 0) {
    throw new Error(`最初に押すのが早すぎます（目印を切ると ${path[0].atSec.toFixed(2)}s から動き始める）＝台本の頭に待ちを入れてください`);
  }

  // ③ カーソルと輪の絵を作る（⚠️ **OS の矢印は使わない**＝環境依存になる）
  const dir = mkdtempSync(join(tmpdir(), "stario-cursor-"));
  const raw = join(dir, "cursor.rgba");
  const rippleRaw = join(dir, "ripple.rgba");
  writeFileSync(raw, Buffer.from(cursorPixels()));
  writeFileSync(rippleRaw, Buffer.from(ripplePixels()));

  // ④ 焼く。押した瞬間は輪も出す。
  // ⚠️ **輪は四角にしない**＝`drawbox` の四角は**UI の選択枠に見える**（焼いて見て分かった）。
  const half = RIPPLE_SIZE / 2;
  const rippleX = points.map((p) => `if(between(t,${p.atSec},${(p.atSec + RIPPLE_SEC).toFixed(2)}),${Math.round(p.x - half)},`).join("");
  const rippleY = points.map((p) => `if(between(t,${p.atSec},${(p.atSec + RIPPLE_SEC).toFixed(2)}),${Math.round(p.y - half)},`).join("");
  // ⚠️ **出さないときは画面の外へ逃がす**＝`enable` はフィルタ全体にしか掛けられないので、位置で消す。
  const hide = `${-RIPPLE_SIZE}${")".repeat(points.length)}`;
  // ⚠️ **切るのは `-ss` ではなく `trim`**＝`overlay` の `t` を**切った後の時間軸**に揃えるため。
  // ⚠️ **1コマの絵は `eof_action=repeat` で最後まで出し続ける**（既定だが、明示して意図を残す）。
  // ⚠️ **位置の式は `lib` から採る**（PR #1237 レビュー 🟡）＝ここで組み立てていた頃は、
  //   `cursorAt` と**同じ意味を2つの言語で二重に書いた**形になっていた（端の扱いまで別々）。
  const filter =
    `[0:v]trim=start=${trimSec},setpts=PTS-STARTPTS[base];` +
    `[base][2:v]overlay=eof_action=repeat:x='${rippleX}${hide}':y='${rippleY}${hide}'[marked];` +
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
    "-c:v", "h264_mf", "-b:v", "8000k", "-pix_fmt", "yuv420p", "-t", String(totalSec), out,
  ], { encoding: "utf8" });
  // ⚠️ **起こせなかった回も理由を出す**（#1234 で `framesFromResult` に入れたのと同じ）＝
  //   `r.error` を見ないと「焼けませんでした:」だけが出て、原因が消える。
  if (r.error) throw new Error(`FFmpeg を起こせません: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`焼けませんでした:\n${r.stderr ?? ""}`);
  console.log(`焼きました: ${out}（頭 ${trimSec.toFixed(2)}s の目印は切りました）`);

  // ⑤ ⚠️ **押した所に出ているかを機械で確かめる**（ここを省くと、黙って別の場所を教える）
  const size = videoSize(log.video);
  const bad = [];
  /** 焼く絵の**重心**（`want`）と、実際に変わった所を比べる（時刻は**切った後**の時間軸）。 */
  const checkAt = (atSec, want, what) => {
    const before = frameAt(log.video, atSec + trimSec);
    const after = frameAt(out, atSec);
    const why = markVerdict(changedCenter(before, after, CHECK_W), want, size);
    if (why) bad.push(`${atSec.toFixed(2)}s ${what}：${why}`);
  };

  for (const p of points) checkAt(p.atSec + NUDGE_SEC, expectedMarkCenter(p), "押した瞬間");

  // ⚠️ **カーソルだけの時刻も見る**（PR #1237 レビュー 🟡）＝輪は左右対称で重心が押した点そのものなので、
  //   押した瞬間だけ見ていると**カーソルが1画素も描かれていなくても通る**。ここで初めて
  //   `positionExpr`・`cursorPath`・`cursorPixels` が検査に入る。
  // ⚠️ **「押した後」とは限らない**（同 再レビュー 🟡）＝実際に選ばれるのは多くが**押す直前の溜め**。
  const stills = stillTimes(path, points, totalSec);
  // ⚠️ **期待は `cursorAt` から採る**＝押した点で固定すると、**動いている最中**を掴んだときに
  //   誤検出する（実測＝22 画素ずれて落ちた。カーソルは既に次の場所へ動き始めていた）。
  for (const t of stills) checkAt(t, expectedCursorCenter(cursorAt(path, t)), "カーソルだけ");

  // ⚠️ **「1つでもあれば良い」にしない**（PR #1237 再レビュー 🟡）＝最初の溜めの窓は必ず残るので
  //   「0個なら止める」は**鳴りえない門**だった。本当に起きる劣化は**押下ごとの検査が静かに痩せる**こと
  //  （台本を詰めると、3回押しても標本が1個になる）。**押下ごとに1つ**を要る。
  const unchecked = points.filter((p) => !stills.some((t) => t >= p.atSec - SETTLE_SEC && t < p.atSec));
  if (unchecked.length > 0) {
    bad.push(`カーソル本体を見られなかった押下が ${unchecked.length} 件あります（${unchecked.map((p) => `${p.atSec}s`).join(" ")}）`
      + `＝押す間隔を ${(TRAVEL_SEC + SETTLE_SEC + RIPPLE_SEC).toFixed(2)} 秒より広げてください`);
  }

  if (bad.length > 0) throw new Error(`押した所に印が出ていません:\n  ${bad.join("\n  ")}`);
  console.log(`✓ ${points.length} か所すべて、押した所に印が出ています（輪だけでなくカーソル本体も ${stills.length} 点で見ました）`);
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
