// チュートリアル映像の**素材を録る**道具（#1226・ADR-0046）。
//
// ⚠️ **製品の一部ではない**＝これは作るための道具。**アプリ側に操作される口は新設しない**
//（リモートデバッグは**起動時の環境変数だけ**で開く＝ADR-0042 が「待ち受けは作らない」と決めたのと同じ姿勢）。
//
// ⚠️ **packaged のアプリを録る**（ADR-0046 判断軸2）＝`npm run dev` のブラウザは `isTauri()` が false で
// ファイル選択も書き出しも動かない＝**別物が写る**。教材としては致命的。
//
// ⚠️ **窓を名前で指定して録らない**（ADR-0046・実測）＝`gdigrab -i "title=…"` は WebView2 の
// GPU 合成を見られず、**6秒間ずっと遷移前の絵を録った**。CDP 側は遷移を報告しているので
// **失敗として現れない**＝知らずに撮ると**中身が嘘の教材**ができる。
// → **デスクトップから窓の矩形を切り出す**。そのうえで、下の「凍りついていないか」で機械的に確かめる。
//
// 使い方:
//   node scripts/tutorialRecord.mjs <台本.json> --out <出力フォルダ>
//
// 台本（JSON）:
//   { "name": "写真を取り込んで書き出す",
//     "steps": [
//       { "clickText": "新しい動画を作る", "say": "まずは…", "expectHeading": "どんな動画を作りますか？" },
//       { "waitMs": 800 }
//     ] }
//
//   `expectHeading` ＝ その段のあと**こうなるはず**を書くと、違ったらその場で落ちる（任意）。
//   ⚠️ **全段には課さない**＝同じ画面の中の選択（目的のカードを選ぶ等）は見出しが変わらないのが正しい。
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { FIND_BY_TEXT, connect, evaluate, waitForTarget } from "./lib/cdp.mjs";
import { checkPlan, parseOutDir } from "./lib/plan.mjs";
import { distinctFrames, sampleFrames } from "./lib/frames.mjs";

const APP = "src-tauri/target/release/star-recruit-studio.exe";
const FFMPEG = "src-tauri/resources/ffmpeg/bin/ffmpeg.exe";
const PORT = 9222;
/** 録画のコマ数。⚠️ 上げるほど重く、下げるとカーソルの動きが飛ぶ。 */
const FPS = 15;
/** 段ごとの検収で、押した前後どれだけを見るか（秒）と、そのコマ数。 */
const STEP_WINDOW_SEC = 0.5;
const STEP_SAMPLE_FPS = 8;

/**
 * 窓の位置と大きさ（`GetWindowRect`）。
 *
 * ⚠️ **偶数に丸める**＝`yuv420p` は奇数の幅・高さを受けない（丸めないと ffmpeg が落ちる）。
 */
function windowRect() {
  const ps = `
Add-Type @'
using System;using System.Runtime.InteropServices;
public struct R{public int L,T,Rr,B;}
public class W{[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out R r);}
'@
$p = Get-Process star-recruit-studio -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { exit 1 }
$r = New-Object R
[W]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
'{0} {1} {2} {3}' -f $r.L, $r.T, ($r.Rr - $r.L), ($r.B - $r.T)`;
  const out = spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" });
  if (out.status !== 0) throw new Error("アプリの窓が見つかりません（起動していない？）");
  const [x, y, w, h] = out.stdout.trim().split(/\s+/).map(Number);
  // ⚠️ **読めたかを見る**（PR #1234 レビュー 🟡）＝崩れた出力をそのまま通すと
  //   `-video_size NaNxNaN` で ffmpeg が即死し、**録画が無いまま先へ進む**。
  if (![x, y, w, h].every(Number.isFinite)) throw new Error(`窓の位置を読めません: ${JSON.stringify(out.stdout)}`);
  if (w <= 0 || h <= 0) throw new Error(`窓の大きさがおかしい: ${w}x${h}`);
  return { x, y, w: w - (w % 2), h: h - (h % 2) };
}

/**
 * 押せる要素の**位置**（仮想カーソルの素）。
 *
 * ⚠️ **探し方は共有**（`FIND_BY_TEXT`）＝ここは「探して**位置を採る**」だけを足す。
 */
const LOCATE = (text) => `(() => {
  const hit = ${FIND_BY_TEXT(text)};
  if (!hit) return null;
  const r = hit.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: (hit.textContent || "").trim() };
})()`;

/**
 * いま画面に出ている見出し（撮れたことの目印として記録に残す）。
 *
 * ⚠️ **本文の中だけを見る**（PR #1234 レビュー ℹ️）＝`document.querySelector("h1,h2")` は
 * **DOM 順の先頭**を採るので、ページ題（`PageHead` の `h1`）がある画面では**区画の見出しではなくページ題**が返る。
 * `expectHeading` を書いた段は落ちて気づけるが、**書かない段は静かに別物が記録される**。
 */
const HEADING = `(() => {
  const root = document.querySelector("main") ?? document;
  return root.querySelector("h1,h2")?.textContent?.trim() ?? "";
})()`;

/**
 * 画面の中身が、**録画のどこに写っているか**（カーソルを描くために要る）。
 *
 * ⚠️ **押した座標は「画面の中」の座標**＝録画は**窓の枠ごと**切り出しているので、
 * **題字の帯と枠のぶんずれる**。ここを持たないと、#1227 が**押した所とは違う場所に印を描く**
 *（＝**黙って別の場所を教える**＝教材として致命的）。
 * ⚠️ **推測しない**＝`screenX`（画面の中身の左上が、デスクトップのどこか）を実測し、
 * 窓の原点との差を採る。実測例＝窓 (182,182) / 中身 (190,213) → ずれ (8,31)。
 * ⚠️ **画面の拡大率も掛ける**＝125% 等の設定では CSS の1px が録画の1画素ではない。
 */
const VIEWPORT = `JSON.stringify({
  screenX: window.screenX, screenY: window.screenY,
  width: window.innerWidth, height: window.innerHeight,
  dpr: window.devicePixelRatio,
})`;

async function main() {
  const [scriptPath, ...rest] = process.argv.slice(2);
  if (!scriptPath) {
    console.error("使い方: node scripts/tutorialRecord.mjs <台本.json> --out <出力フォルダ>");
    process.exit(2);
  }
  const outDir = resolve(parseOutDir(rest));
  // ⚠️ **当たりは両方に置く**（同レビュー 🟡）＝アプリだけ見てあり、**FFmpeg は非対称**だった。
  if (!existsSync(APP)) throw new Error(`アプリがありません（先に build を）: ${APP}`);
  if (!existsSync(FFMPEG)) throw new Error(`FFmpeg がありません: ${FFMPEG}`);
  mkdirSync(outDir, { recursive: true });
  const plan = checkPlan(JSON.parse(readFileSync(scriptPath, "utf8")));
  const video = join(outDir, `${plan.name ?? "tutorial"}.mp4`);
  const logPath = join(outDir, `${plan.name ?? "tutorial"}.steps.json`);

  // ① アプリを起動（⚠️ **環境変数でだけ**リモートデバッグを開く）
  spawnSync("powershell", ["-NoProfile", "-Command",
    `Stop-Process -Name star-recruit-studio -Force -ErrorAction SilentlyContinue`], { stdio: "ignore" });
  const app = spawn(APP, [], {
    stdio: "ignore",
    detached: true,
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  });
  app.unref();

  let cdp;
  let ff;
  try {
    cdp = connect(await waitForTarget(PORT));
    await cdp.ready;
    await cdp.send("Runtime.enable");
    await new Promise((r) => setTimeout(r, 1500)); // 初回描画を待つ

    const rect = windowRect();
    const vp = JSON.parse(await evaluate(cdp, VIEWPORT));
    // ⚠️ **ずれは実測から採る**（推測しない）＝窓の原点と、画面の中身の原点の差。
    const view = {
      offsetX: vp.screenX - rect.x,
      offsetY: vp.screenY - rect.y,
      dpr: vp.dpr,
      width: vp.width,
      height: vp.height,
    };
    console.log(`窓: ${rect.w}x${rect.h} @ (${rect.x},${rect.y}) / 中身のずれ: (${view.offsetX},${view.offsetY}) 拡大率 ${view.dpr}`);
    if (view.offsetX < 0 || view.offsetY < 0) {
      throw new Error(`中身が窓の外にあります（ずれ ${view.offsetX},${view.offsetY}）＝別の窓を測っていませんか`);
    }
    // ⚠️ **拡大率が100%以外なら、その場で落とす**（PR #1234 レビュー 🟡）＝
    //   `screenX` は **CSS px**、`GetWindowRect` と `gdigrab` は**物理 px**なので、
    //   100% のときだけ単位が一致する。**掛ければよい、は推測**（どちらに掛けるかで結果が変わる）。
    //   ここで断れば「ずれた教材」を作らずに済む（§2-5＝次の行動を出す）。
    if (view.dpr !== 1) {
      throw new Error(`画面の拡大率が ${Math.round(view.dpr * 100)}% です。100% にしてから撮ってください`);
    }
    // ⚠️ **副モニタ（負の座標）も断る**＝`gdigrab` の切り出しがずれる。
    if (rect.x < 0 || rect.y < 0) {
      throw new Error(`窓が主モニタの外にあります（${rect.x},${rect.y}）＝主モニタへ移してから撮ってください`);
    }

    // ② 録画を始める（⚠️ **デスクトップから切り出す**・実カーソルは消す）
    // ⚠️ **起動に失敗したら、その場で分かるようにする**（PR #1234 レビュー 🟡）＝
    //   `error` を拾わないと未処理例外になり、**後片づけを通らずに落ちる**（口が開いたまま残る）。
    ff = spawn(FFMPEG, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "gdigrab", "-framerate", String(FPS), "-draw_mouse", "0",
      "-offset_x", String(rect.x), "-offset_y", String(rect.y),
      "-video_size", `${rect.w}x${rect.h}`, "-i", "desktop",
      "-c:v", "h264_mf", "-b:v", "8000k", "-pix_fmt", "yuv420p", video,
    ], { stdio: ["pipe", "ignore", "inherit"] });
    ff.on("error", (e) => { throw new Error(`FFmpeg を起こせません: ${e.message}`); });
    const t0 = Date.now();
    await new Promise((r) => setTimeout(r, 1200)); // 録り始めの安定待ち

    // ③ 台本を走らせ、**押した時刻と座標**を残す（仮想カーソルの素＝#1227）
    const log = [];
    for (const step of plan.steps) {
      if (step.waitMs != null) {
        await new Promise((r) => setTimeout(r, step.waitMs));
        continue;
      }
      const at = await evaluate(cdp, LOCATE(step.clickText));
      if (!at) throw new Error(`押せる要素がありません: ${step.clickText}`);
      const tSec = (Date.now() - t0) / 1000;
      // ⚠️ **本物の入力を送る**＝JS の `.click()` ではなく、人が押したのと同じ道を通す。
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
        await cdp.send("Input.dispatchMouseEvent", {
          type, x: at.x, y: at.y, button: "left", clickCount: type === "mouseMoved" ? 0 : 1,
        });
      }
      await new Promise((r) => setTimeout(r, step.afterMs ?? 1200));
      const headingAfter = await evaluate(cdp, HEADING);
      // ⚠️ **書いた主張を、その場で検査する**（`CLAUDE.md` §7）＝台本が「こうなるはず」と
      //   書いた段だけを見る。**全段に「画面が変わったか」を課さない**＝同じ画面の中の選択
      //  （目的のカードを選ぶ等）は見出しが変わらないのが正しく、課すと**正しい台本が落ちる**。
      if (step.expectHeading != null && headingAfter !== step.expectHeading) {
        throw new Error(`「${at.label}」の後に「${step.expectHeading}」になるはずが、「${headingAfter}」でした`);
      }
      log.push({
        atSec: Number(tSec.toFixed(2)),
        x: at.x, y: at.y, label: at.label,
        say: step.say ?? null,
        headingAfter,
      });
      console.log(`${tSec.toFixed(1)}s 「${at.label}」(${at.x},${at.y}) → ${headingAfter}`);
    }

    // ④ 録画を終える
    ff.stdin.write("q");
    await new Promise((r) => ff.on("exit", r));
    ff = null;
    const totalSec = (Date.now() - t0) / 1000;

    // ⑤ ⚠️ **撮れたことを機械で確かめる**（ここを省くと嘘の教材ができる）
    const seen = sampleFrames(FFMPEG, video);
    const kinds = distinctFrames(seen);

    // ⚠️ **段ごとに見る**（PR #1234 レビュー 🟡）＝録画ぜんたいで1回だけ数えると、
    //   **どこか1回でも絵が変われば通る**＝段①だけ写って②③が凍った回も `✓` になる。
    //   押した前後の窓を採り、**その段で絵が動いたか**を1段ずつ確かめる。
    const 動かなかった = [];
    for (const s of log) {
      const from = Math.max(0, s.atSec - STEP_WINDOW_SEC);
      const to = s.atSec + STEP_WINDOW_SEC;
      const around = sampleFrames(FFMPEG, video, STEP_SAMPLE_FPS, from, to);
      if (around.length < 2) { 動かなかった.push(`${s.atSec}s（コマが足りない）`); continue; }
      if (distinctFrames(around) < 2) 動かなかった.push(`${s.atSec}s「${s.label}」`);
    }
    writeFileSync(logPath, JSON.stringify({
      name: plan.name, video, totalSec, distinctFrames: kinds,
      // ⚠️ **カーソルを描く側（#1227）が使う**＝ここが無いと押した所と違う場所に印が出る。
      view, fps: FPS,
      // ⚠️ **`atSec` は録り始めからの秒ではなく、`ffmpeg` を起こしてからの秒**（PR #1234 レビュー ℹ️）＝
      // gdigrab の立ち上がり（数百 ms 規模）だけ**一律に早い**。#1227 のカーソルは**押す前に着く**向きにずれる。
      // ⚠️ **補正していない**＝補正するなら、撮り始めに目印を出してその最初のコマで採り直す。
      timeBaseNote: "atSec は ffmpeg 起動からの秒（録画の先頭より数百ms 早い・未補正）",
      steps: log,
    }, null, 2), "utf8");

    console.log(`\n録画: ${video}（${totalSec.toFixed(1)}秒）`);
    console.log(`記録: ${logPath}`);
    console.log(`見たコマ ${seen.length} / 違う絵 ${kinds}`);

    // ⚠️ **1種類なら落とす**＝窓指定で撮ったときの形（全コマ同じ絵）。実測で 1 と出た。
    // ⚠️ **「2以上なら良い」までしか言わない**＝どの絵が正しいかは機械では分からない（そこは目で見る）。
    if (seen.length === 0) throw new Error("録画からコマを1枚も取り出せません（録れていない）");
    if (kinds < 2) {
      throw new Error("録画の絵が一度も変わっていません＝画面の更新を拾えていません（窓指定で撮っていませんか）");
    }
    if (動かなかった.length > 0) {
      throw new Error(`押したのに絵が動いていない段があります:\n  ${動かなかった.join("\n  ")}`);
    }
    console.log("✓ 撮れました（段ごとに絵が動いたことを確かめました。中身は目で見てください）");
  } finally {
    try { ff?.kill(); } catch { /* 既に終わっている */ }
    cdp?.close();
    spawnSync("powershell", ["-NoProfile", "-Command",
      "Stop-Process -Name star-recruit-studio -Force -ErrorAction SilentlyContinue"], { stdio: "ignore" });
  }
}

await main();
