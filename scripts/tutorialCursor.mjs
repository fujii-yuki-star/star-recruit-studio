// 録画に**仮想カーソルを焼く**（#1227・ADR-0046 ③）。
//
// ⚠️ **押した位置と、印の出る位置がずれてはいけない**＝ずれは「**黙って別の場所を教える**」
// ことになり、教材として致命的（ADR-0026④）。だから**焼いたあとに機械で確かめる**（下記）。
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
import { CURSOR_H, CURSOR_W, RIPPLE_SIZE, cursorPath, cursorPixels, ripplePixels, toVideoPoint } from "./lib/cursor.mjs";
import { changedCenter } from "./lib/frames.mjs";

/**
 * 確かめ用の縮小の大きさ。
 *
 * ⚠️ **凍結を見るときより細かくする**（`frames.mjs` の 32×18 では**粗すぎた**）＝
 * カーソルは 24×36 なので、1296×838 を 32×18 まで縮めると**1画素未満に潰れて消える**
 *（実測＝「何も描かれていない」と出た）。ここは**同じ録画どうしの比較**なので細かくてよい。
 */
const CHECK_W = 160;
const CHECK_H = 100;

const FFMPEG = "src-tauri/resources/ffmpeg/bin/ffmpeg.exe";
/** 押した瞬間の印が出ている長さ。 */
const RIPPLE_SEC = 0.45;

/** `overlay` に渡す式（時刻ごとに位置が変わる＝区間ごとの直線）。 */
function overlayExpr(path, axis) {
  // ⚠️ **端で止める**＝式の外側は端の値（`cursorAt` と同じ約束）。
  let expr = `${path[path.length - 1][axis]}`;
  for (let i = path.length - 1; i >= 1; i -= 1) {
    const a = path[i - 1];
    const b = path[i];
    const span = Math.max(0.001, b.atSec - a.atSec);
    const lerp = `(${a[axis]}+(${b[axis]}-${a[axis]})*(t-${a.atSec})/${span})`;
    expr = `if(lt(t,${b.atSec}),if(lt(t,${a.atSec}),${a[axis]},${lerp}),${expr})`;
  }
  return expr;
}

function main() {
  const [logPath, ...rest] = process.argv.slice(2);
  if (!logPath) {
    console.error("使い方: node scripts/tutorialCursor.mjs <録画.steps.json> [--out 出力.mp4]");
    process.exit(2);
  }
  const log = JSON.parse(readFileSync(logPath, "utf8"));
  if (!log.view) throw new Error("記録に画面の対応（view）がありません＝#1226 の新しい版で録り直してください");
  if (!existsSync(log.video)) throw new Error(`録画がありません: ${log.video}`);
  const out = rest[rest.indexOf("--out") + 1] ?? log.video.replace(/\.mp4$/, ".cursor.mp4");

  // ① 押した所を、録画の中の位置へ直す
  const points = log.steps.map((s) => ({ atSec: s.atSec, ...toVideoPoint(log.view, s.x, s.y) }));
  const path = cursorPath(points);
  if (path.length === 0) throw new Error("押した記録が1つもありません");

  // ② カーソルの絵を作る（⚠️ **OS の矢印は使わない**＝環境依存になる）
  const dir = mkdtempSync(join(tmpdir(), "stario-cursor-"));
  const raw = join(dir, "cursor.rgba");
  writeFileSync(raw, Buffer.from(cursorPixels()));
  const rippleRaw = join(dir, "ripple.rgba");
  writeFileSync(rippleRaw, Buffer.from(ripplePixels()));

  // ③ 焼く。押した瞬間は輪も出す。
  // ⚠️ **輪は四角にしない**＝`drawbox` の四角は**UI の選択枠に見える**（焼いて見て分かった）。
  //   カーソルと同じ仕掛け（1コマの絵を重ねる）で、**輪**を出す。
  const half = RIPPLE_SIZE / 2;
  const rippleX = points.map((p) => `if(between(t,${p.atSec},${(p.atSec + RIPPLE_SEC).toFixed(2)}),${Math.round(p.x - half)},`).join("");
  const rippleY = points.map((p) => `if(between(t,${p.atSec},${(p.atSec + RIPPLE_SEC).toFixed(2)}),${Math.round(p.y - half)},`).join("");
  // ⚠️ **出さないときは画面の外へ逃がす**＝`enable` はフィルタ全体にしか掛けられないので、位置で消す。
  const hide = `${-RIPPLE_SIZE}${")".repeat(points.length)}`;
  // ⚠️ **1コマの絵は `eof_action=repeat` で最後まで出し続ける**（既定だが、明示して意図を残す）。
  const filter =
    `[0:v][2:v]overlay=eof_action=repeat:x='${rippleX}${hide}':y='${rippleY}${hide}'[marked];` +
    `[marked][1:v]overlay=eof_action=repeat:x='${overlayExpr(path, "x")}':y='${overlayExpr(path, "y")}'`;

  const r = spawnSync(FFMPEG, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", log.video,
    "-f", "rawvideo", "-pix_fmt", "rgba", "-video_size", `${CURSOR_W}x${CURSOR_H}`, "-framerate", "1", "-i", raw,
    "-f", "rawvideo", "-pix_fmt", "rgba", "-video_size", `${RIPPLE_SIZE}x${RIPPLE_SIZE}`, "-framerate", "1", "-i", rippleRaw,
    "-filter_complex", filter,
    "-c:v", "h264_mf", "-b:v", "8000k", "-pix_fmt", "yuv420p", "-t", String(log.totalSec), out,
  ], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`焼けませんでした:
${r.stderr ?? ""}`);

  // ④ ⚠️ **押した所に出ているかを機械で確かめる**（ここを省くと、黙って別の場所を教える）
  const size = videoSize(log.video);
  const bad = [];
  for (const p of points) {
    const before = frameAt(log.video, p.atSec);
    const after = frameAt(out, p.atSec);
    if (!before || !after) { bad.push(`${p.atSec}s のコマを取り出せない`); continue; }
    const c = changedCenter(before, after, CHECK_W);
    if (!c) { bad.push(`${p.atSec}s で何も描かれていない`); continue; }
    // 小さく縮めた座標系で比べる（元の大きさへ戻して見る）
    const wantX = (p.x / size.w) * CHECK_W;
    const wantY = (p.y / size.h) * CHECK_H;
    const away = Math.hypot(c.x - wantX, c.y - wantY);
    // ⚠️ **許容は縮めた絵で6画素**＝元の大きさで約50画素。カーソル（24×36）と輪（52×52）が
    //   押した点の**まわり**に広がるので、重心はぴったりにはならない。
    if (away > 6) bad.push(`${p.atSec}s の印が押した所から離れている（縮めた絵で ${away.toFixed(1)} 画素）`);
  }
  console.log(`焼きました: ${out}`);
  if (bad.length > 0) throw new Error(`押した所に印が出ていません:\n  ${bad.join("\n  ")}`);
  console.log(`✓ ${points.length} か所すべて、押した所に印が出ています`);
}

/** その時刻の、小さく縮めた白黒のコマ。 */
function frameAt(file, atSec) {
  // ⚠️ **`-ss` は `-i` の後ろ**＝前に置くと**速いが不正確**で、2つの録画で**別のコマ**を取り出す
  //（実測＝そのせいで「何も描かれていない」と出た）。ここは正確さを採る。
  const r = spawnSync(FFMPEG, [
    "-hide_banner", "-loglevel", "error", "-i", file, "-ss", String(atSec + 0.05),
    "-frames:v", "1", "-vf", `scale=${CHECK_W}:${CHECK_H}`, "-pix_fmt", "gray", "-f", "rawvideo", "-",
  ], { maxBuffer: 1 << 24 });
  const b = r.stdout;
  return b && b.length >= CHECK_W * CHECK_H ? b.subarray(0, CHECK_W * CHECK_H) : null;
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
