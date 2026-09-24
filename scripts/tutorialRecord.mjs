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
import { connect, evaluate, waitForTarget } from "./lib/cdp.mjs";
import { distinctFrames, sampleFrames } from "./lib/frames.mjs";

const APP = "src-tauri/target/release/star-recruit-studio.exe";
const FFMPEG = "src-tauri/resources/ffmpeg/bin/ffmpeg.exe";
const PORT = 9222;
/** 録画のコマ数。⚠️ 上げるほど重く、下げるとカーソルの動きが飛ぶ。 */
const FPS = 15;

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
  return { x, y, w: w - (w % 2), h: h - (h % 2) };
}

/** 押せる要素の**位置**（仮想カーソルの素）と、押す操作。 */
const LOCATE = (text) => `(() => {
  const want = ${JSON.stringify(text)};
  const all = [...document.querySelectorAll("button, a, [role=button], [role=menuitem], summary, label")];
  const hit = all.find((el) => (el.textContent || "").trim() === want)
    || all.find((el) => (el.textContent || "").includes(want));
  if (!hit) return null;
  hit.scrollIntoView({ block: "center" });
  const r = hit.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: (hit.textContent || "").trim() };
})()`;

/** いま画面に出ている見出し（撮れたことの目印として記録に残す）。 */
const HEADING = `document.querySelector("h1,h2")?.textContent?.trim() ?? ""`;

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
  const outDir = resolve(rest[rest.indexOf("--out") + 1] ?? "tutorial-out");
  if (!scriptPath) {
    console.error("使い方: node scripts/tutorialRecord.mjs <台本.json> --out <出力フォルダ>");
    process.exit(2);
  }
  if (!existsSync(APP)) throw new Error(`アプリがありません（先に build を）: ${APP}`);
  mkdirSync(outDir, { recursive: true });
  const plan = JSON.parse(readFileSync(scriptPath, "utf8"));
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

    // ② 録画を始める（⚠️ **デスクトップから切り出す**・実カーソルは消す）
    ff = spawn(FFMPEG, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "gdigrab", "-framerate", String(FPS), "-draw_mouse", "0",
      "-offset_x", String(rect.x), "-offset_y", String(rect.y),
      "-video_size", `${rect.w}x${rect.h}`, "-i", "desktop",
      "-c:v", "h264_mf", "-b:v", "8000k", "-pix_fmt", "yuv420p", video,
    ], { stdio: ["pipe", "ignore", "inherit"] });
    const t0 = Date.now();
    await new Promise((r) => setTimeout(r, 1200)); // 録り始めの安定待ち

    // ③ 台本を走らせ、**押した時刻と座標**を残す（仮想カーソルの素＝#1227）
    const log = [];
    for (const step of plan.steps) {
      if (step.waitMs != null) {
        await new Promise((r) => setTimeout(r, step.waitMs));
        continue;
      }
      if (step.clickText == null) continue;
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
    writeFileSync(logPath, JSON.stringify({
      name: plan.name, video, totalSec, distinctFrames: kinds,
      // ⚠️ **カーソルを描く側（#1227）が使う**＝ここが無いと押した所と違う場所に印が出る。
      view, fps: FPS,
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
    console.log("✓ 撮れました（絵が変わっていることは確かめました。中身は目で見てください）");
  } finally {
    try { ff?.kill(); } catch { /* 既に終わっている */ }
    cdp?.close();
    spawnSync("powershell", ["-NoProfile", "-Command",
      "Stop-Process -Name star-recruit-studio -Force -ErrorAction SilentlyContinue"], { stdio: "ignore" });
  }
}

await main();
