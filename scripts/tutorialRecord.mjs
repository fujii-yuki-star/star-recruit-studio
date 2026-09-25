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
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { FIND_BY_TEXT, FIND_FIELD, connect, evaluate, waitForTarget } from "./lib/cdp.mjs";
import { checkPlan, parseOutDir } from "./lib/plan.mjs";
import { FFMPEG, changedBounds, distinctFrames, framesFromResult, sampleFrames } from "./lib/frames.mjs";
import { scaleVerdict, viewFromBounds } from "./lib/burnCheck.mjs";
import { toVideoPoint } from "./lib/cursor.mjs";


const APP = "src-tauri/target/release/star-recruit-studio.exe";
const PORT = 9222;
/** 録画のコマ数。⚠️ 上げるほど重く、下げるとカーソルの動きが飛ぶ。 */
const FPS = 15;
/**
 * 撮り始めに出す**目印**の長さと、それを見に行く時刻（秒）。
 *
 * ⚠️ **長めに出す**＝`atSec` は ffmpeg を起こしてからの秒で、**録画の先頭は数百 ms 遅れる**
 *（`timeBaseNote`）。短いと、その遅れのぶんで**目印の外**を見てしまう。
 */
const FLASH_SEC = 1.2;
const FLASH_SAMPLE_AFTER = 0.4;
/**
 * 目印を消してから台本を始めるまでの間（秒）。
 *
 * ⚠️ **短くしない**（PR #1237 再レビュー 🟡）＝焼く側は**目印の終わりまでを切り落とす**ので、
 * ここが短いと**カーソルが動き始める時刻が切り口より前**になり、
 * 最初のカーソルが**いきなり画面の途中から現れる**（`tutorialCursor` が断る）。
 */
const AFTER_FLASH_SEC = 1.5;
/** 目印が写っていると認めるのに要る、変わった画素の割合。 */
const FLASH_MIN_RATIO = 0.6;

/** 段ごとの検収で、押した前後どれだけを見るか（秒）と、そのコマ数。 */
const STEP_WINDOW_SEC = 0.5;
const STEP_SAMPLE_FPS = 8;

/**
 * 窓の位置と大きさ（`GetWindowRect`）。
 *
 * ⚠️ **偶数に丸める**＝`yuv420p` は奇数の幅・高さを受けない（丸めないと ffmpeg が落ちる）。
 */
// ⚠️ **PowerShell の窓を出さない**（#1228・2026-09-25 に実測）＝`windowsHide` を付けないと
// **一瞬コンソールの窓が前に出る**。それが①前面の見張りを誤発火させ、②目印を撮るコマに被って
// **中身の矩形を縦に縮めて測らせて**いた（横 1.000 / 縦 0.955 の正体）。**自分で自分を邪魔していた**。
function windowRect() {
  // ⚠️ **`ffmpeg` と同じ座標系で測る**（#1228・2026-09-25 に実測で確定）＝
  //   `gdigrab` が見ているデスクトップは **3840x1200**（DPI 非対応の座標系）で、
  //   Windows の実体（DPI 対応で見ると 5760x1620）とは**比も一定でない**（混在 DPI）。
  //   だから**こちらを DPI 対応にすると、かえって ffmpeg と食い違う**（実測で I/O エラーになった）。
  //   ⚠️ **画面の中身との対応は、撮り始めの目印から実測する**ので、ここは ffmpeg に合わせるだけでよい。
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
  const out = spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8", windowsHide: true });
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

/** 入力欄の位置（`FIND_FIELD` で探す）。押してから打つので、押せる場所として同じ形で返す。 */
const LOCATE_FIELD = (label) => `(() => {
  const el = ${FIND_FIELD(label)};
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), label: ${JSON.stringify(label)} };
})()`;

/** その入力欄にいま入っている文字（打てたかの確かめに使う）。 */
const VALUE_OF = (label) => `(() => {
  const el = ${FIND_FIELD(label)};
  return el ? (el.value ?? el.textContent ?? "") : null;
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

/**
 * 画面いっぱいの**目印**（`view` が本当に合っているかを、録画から**測る**ための的）。
 *
 * ⚠️ **計算した値で描いて、同じ値で検査しても意味がない**（PR #1237 レビュー 🟡）＝
 * `view` が丸ごと間違っていても**辻褄が合う**（実測で `✓` が出た）。**録画そのものを測る**。
 * ⚠️ **押せないようにする**（`pointer-events:none`）＝台本の操作に混ざらない。
 * ⚠️ **色は明暗どちらのテーマからも遠いものを選ぶ**（PR #1237 再レビュー ℹ️）＝比べるのは
 * **白黒に落とした明るさ**なので、`#ff00ff` の明るさ（約 105）に近い**中間の灰**が画面の端にあると、
 * その行・列が「変わっていない」と読まれて**矩形が数画素欠ける**。この製品の明（250）・暗（42）とは
 * 十分離れている。**テーマの色を変えたらここも見直す**。
 */
const FLASH_ON = `(() => {
  const d = document.createElement("div");
  d.id = "__stario_flash";
  d.style.cssText = "position:fixed;inset:0;background:#ff00ff;z-index:2147483647;pointer-events:none";
  document.body.appendChild(d);
  return "ok";
})()`;
const FLASH_OFF = `(() => { const d = document.getElementById("__stario_flash"); if (d) d.remove(); return "ok"; })()`;

/** 録画から**原寸の白黒のコマ**を1枚（⚠️ 縮めない＝数画素のずれを測るため）。 */
function fullFrameAt(file, atSec, w, h) {
  const r = spawnSync(FFMPEG, [
    "-hide_banner", "-loglevel", "error", "-i", file, "-ss", String(atSec),
    "-frames:v", "1", "-pix_fmt", "gray", "-f", "rawvideo", "-",
  ], { maxBuffer: 1 << 28 });
  const frames = framesFromResult(r, file, w * h);
  if (frames.length === 0) throw new Error(`${file} の ${atSec}s のコマを取り出せません`);
  return frames[0];
}

/**
 * **計算した `view` が、録画の実物と合っているか**を測って確かめる。
 *
 * ⚠️ **ここが #1227 の土台**＝ここが狂うと、仮想カーソルは**押した所とは違う場所**に出る。
 * そして #1227 側の検査は**同じ `view` から期待値を作る**ので、**気づけない**（実測）。
 */
function measureView(video, flashAtSec, rect, page) {
  const before = fullFrameAt(video, 0.1, rect.w, rect.h);
  const during = fullFrameAt(video, flashAtSec + FLASH_SAMPLE_AFTER, rect.w, rect.h);
  const b = changedBounds(before, during, rect.w);
  const least = page.width * page.height * page.dpr * page.dpr * FLASH_MIN_RATIO;
  if (!b || b.count < least) {
    // ⚠️ **原因を1つに決めつけない**（PR #1237 再レビュー 🟡）＝この分岐は
    //   「録画の始まりが遅い」以外に「**目印を出せなかった**」「**画面と目印が同系色**」でも通る。
    //   1つだけ挙げると**直す先を間違えさせる**（§2-5 は「次の行動」を求めている）。
    throw new Error([
      `撮り始めの目印が録画に写っていません（変わった画素 ${b?.count ?? 0} / 要 ${Math.round(least)}）。次のどれかです:`,
      "  ・録画の始まりが遅い（`-framerate` を上げるか、録り始めの待ちを延ばす）",
      "  ・目印を出せていない（アプリが別の画面を出していないか）",
      "  ・画面と目印が同系色（目印の色を変える）",
    ].join(`
`));
  }
  const gaps = scaleVerdict(b, page);
  if (gaps.length > 0) {
    throw new Error([
      `測った中身の矩形が、筋の通った1つの倍率になっていません（測った ${b.w}x${b.h} @ (${b.x},${b.y}) / 中身 ${page.width}x${page.height} CSS px）:`,
      ...gaps.map((z) => `  ${z}`),
      "  ＝このまま焼くとカーソルが違う場所に出ます。窓を動かさずに撮り直してください",
      "  （起動直後に窓の大きさが変わると、測った値が古くなって起きます）",
    ].join(`
`));
  }
  // ⚠️ **測った値をそのまま返す**（#1228）＝突き合わせる「計算値」はもう無い。
  const view = viewFromBounds(b, page);
  console.log(`✓ 中身の位置を録画で実測: (${view.offsetX},${view.offsetY}) ${view.width}x${view.height}`
    + ` / 倍率 ${view.scale}（画面の拡大率 ${page.dpr}）`);
  return view;
}

/**
 * 画面の**使える範囲**（タスクバーを除いた所）。
 *
 * ⚠️ **なぜ要るか**（PR #1237 再レビュー で見つけた実例）＝窓の下端がタスクバーの下に潜っていると、
 * デスクトップを切り出す撮り方では**そこにタスクバーが写る**（窓の中身は写らない）。
 * 実測＝中身の高さが 800 のはずが **793** と出た（＝アプリの下 7 画素が教材に写っていなかった）。
 * **エラーは出ない**ので、測らなければ気づけない。
 */
function workArea() {
  // ⚠️ **窓が載っている画面で見る**（#1228）＝以前は主モニタ固定だったので、
  //   利用者が**外部ディスプレイへ移した窓**を「はみ出している」と誤判定し、主モニタへ引き戻していた。
  // ⚠️ **`WorkingArea`（タスクバーを除いた範囲）で見る**（同・実測）＝最大化した窓が
  //   タスクバーの下まで伸びていると、**アプリの下端 48px がタスクバーに覆われて**写らない
  //  （実測＝中身 1057 CSS px に対し、変わったのは 1009 px だけだった）。
  //   切り取るとアプリの下端が欠けるので、**窓のほうを作業領域に合わせる**。
  // ⚠️ **ここも DPI 対応にする**＝非対応だと論理 px（1280x752）が返り、
  //   物理 px の窓と比べて**はみ出していないのに「はみ出した」と断って**いた。
  const ps = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$p = Get-Process star-recruit-studio -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
    "$s = if ($p) { [System.Windows.Forms.Screen]::FromHandle($p.MainWindowHandle) } else { [System.Windows.Forms.Screen]::PrimaryScreen }",
    "$w = $s.WorkingArea",
    "'{0} {1} {2} {3}' -f $w.X,$w.Y,$w.Width,$w.Height",
  ].join("; ");
  const out = spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8", windowsHide: true });
  const [x, y, w, h] = (out.stdout ?? "").trim().split(/\s+/).map(Number);
  if (![x, y, w, h].every(Number.isFinite)) throw new Error(`画面の範囲を読めません: ${JSON.stringify(out.stdout)}`);
  return { x, y, w, h };
}

/**
 * 仮想デスクトップの左上（`gdigrab` の `-offset_x/-offset_y` の原点）。
 *
 * ⚠️ **(0,0) とは限らない**＝画面を左や上に並べると**負の座標**になる。
 * 外部ディスプレイへ窓を移すと、まさにここを踏む。
 */
function virtualOrigin() {
  const ps = [
    "Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class Vs { [DllImport(\"user32.dll\")] public static extern int GetSystemMetrics(int i); }'",
    "'{0} {1}' -f [Vs]::GetSystemMetrics(76),[Vs]::GetSystemMetrics(77)",
  ].join("; ");
  const out = spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8", windowsHide: true });
  const [x, y] = (out.stdout ?? "").trim().split(/\s+/).map(Number);
  if (![x, y].every(Number.isFinite)) throw new Error(`仮想デスクトップの原点を読めません: ${JSON.stringify(out.stdout)}`);
  return { x, y };
}

/**
 * 撮る矩形を、使える範囲との**重なり**に切り詰める（偶数に丸める）。
 *
 * ⚠️ **最大化した窓は、見えないリサイズ枠のぶんだけはみ出す**（実測＝2904x1572 @ (2868,-12) で
 * 使える範囲が 2880x1548 @ (2880,0)）。見えていないのだから、切り詰めて撮るのが正しい。
 */
export function clipToArea(rect, area) {
  const x = Math.max(rect.x, area.x);
  const y = Math.max(rect.y, area.y);
  const right = Math.min(rect.x + rect.w, area.x + area.w);
  const bottom = Math.min(rect.y + rect.h, area.y + area.h);
  const w = Math.max(0, right - x);
  const h = Math.max(0, bottom - y);
  return { x, y, w: w - (w % 2), h: h - (h % 2) };
}

/**
 * 使える範囲に収まる位置と大きさ（収まっているなら `null`）。
 *
 * ⚠️ **偶数に丸める**＝`yuv420p` は奇数の幅・高さを受けない。
 */
export function fitIntoWorkArea(rect, area, margin = 8) {
  const fits = rect.x >= area.x && rect.y >= area.y
    && rect.x + rect.w <= area.x + area.w && rect.y + rect.h <= area.y + area.h;
  if (fits) return null;
  const w = Math.min(rect.w, area.w - margin * 2);
  const h = Math.min(rect.h, area.h - margin * 2);
  return { x: area.x + margin, y: area.y + margin, w: w - (w % 2), h: h - (h % 2) };
}

/** 窓をその位置・大きさへ動かす（撮影の道具なので、収まらないときだけ触る）。 */
function moveWindow({ x, y, w, h }) {
  const ps = `
Add-Type @'
using System;using System.Runtime.InteropServices;
public class Mv {
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h,int x,int y,int w,int t,bool r);
}
'@
$p = Get-Process star-recruit-studio -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { exit 1 }
[Mv]::MoveWindow($p.MainWindowHandle, ${x}, ${y}, ${w}, ${h}, $true) | Out-Null`;
  const r = spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw new Error("窓を動かせませんでした（アプリの窓が見つかりません）");
}

/**
 * アプリの窓を**前面に出し、本当に前面になったか**を返す。
 *
 * ⚠️ **これが無いと、他人の画面を録る**（#1228・2026-09-25 に実際に起きた）＝
 * `gdigrab` は**デスクトップのその矩形**を撮るので、アプリが裏に回っていれば
 * **そこに載っている別の窓**（利用者が作業中の表計算など）がそのまま録画に入る。
 * ⚠️ **黙って撮れてしまう**のがいちばん悪い＝ファイルはできるし、絵も動く。
 */
function bringToFront() {
  const ps = `
Add-Type @'
using System;using System.Runtime.InteropServices;
public class Fg {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
}
'@
$p = Get-Process star-recruit-studio -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { exit 1 }
$h = $p.MainWindowHandle
[Fg]::ShowWindow($h, 9) | Out-Null   # SW_RESTORE
# ⚠️ Windows は「裏のプロセスからの前面化」を拒む。いま前面の窓の入力スレッドへ一時的に
#    自分を繋ぐ（AttachThreadInput）と、同じ入力キューの持ち主として前面化が通る。
$fg = [Fg]::GetForegroundWindow()
$tFg = [Fg]::GetWindowThreadProcessId($fg, [IntPtr]::Zero)
$tMe = [Fg]::GetCurrentThreadId()
if ($tFg -ne $tMe) { [Fg]::AttachThreadInput($tFg, $tMe, $true) | Out-Null }
[Fg]::BringWindowToTop($h) | Out-Null
[Fg]::SetForegroundWindow($h) | Out-Null
if ($tFg -ne $tMe) { [Fg]::AttachThreadInput($tFg, $tMe, $false) | Out-Null }
Start-Sleep -Milliseconds 500
if ([Fg]::GetForegroundWindow() -eq $h) { 'front' } else { 'back' }`;
  const r = spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw new Error("アプリの窓が見つかりません（起動していない？）");
  return (r.stdout ?? "").trim() === "front";
}

/**
 * いまアプリが前面か（録画の最中に奪われていないかを、節目ごとに見る）。
 *
 * ⚠️ **窓の一致ではなく「持ち主のプロセス」で見る**（#1228・実測）＝WebView2 は
 * ポップアップ等で**同じアプリの別の窓**を前に出すことがあり、窓で見ると**正しい回を止める**
 *（実際に2手目で止まった）。見たいのは「**別のアプリ**が前に出たか」。
 */
function isForeground() {
  const ps = `
Add-Type @'
using System;using System.Runtime.InteropServices;
public class Fg2 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
'@
$p = Get-Process star-recruit-studio -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { 'gone' } else {
  $owner = 0
  [Fg2]::GetWindowThreadProcessId([Fg2]::GetForegroundWindow(), [ref]$owner) | Out-Null
  if ($owner -eq $p.Id) { 'front' } else { 'back' }
}`;
  const r = spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8", windowsHide: true });
  return (r.stdout ?? "").trim();
}

/**
 * **大きさが動かなくなった**窓の矩形。
 *
 * ⚠️ **1回読んで済ませない**＝起動直後は窓がまだ動く。古い値で撮ると、録画の切り出しと
 * 画面の中身がずれ、**カーソルが違う場所に出る**（`checkViewAgainstVideo` が捕まえた実例）。
 */
async function stableWindowRect(tries = 12, waitMs = 300) {
  let last = windowRect();
  for (let i = 0; i < tries; i += 1) {
    await new Promise((r) => setTimeout(r, waitMs));
    const now = windowRect();
    if (now.x === last.x && now.y === last.y && now.w === last.w && now.h === last.h) return now;
    last = now;
  }
  throw new Error("窓の大きさが落ち着きません＝動かしている最中ではありませんか（手を離してから撮ってください）");
}

/**
 * 撮る前に**ホームへ戻す**（#1228）。
 *
 * ⚠️ **前の回で画面が進んだままだと、台本の1手目が見つからない**＝実際に何度も踏んだ。
 * 「録り直す」たびに人が画面を戻すのは現実的でないので、道具が戻す。
 * ⚠️ **離脱の確認が出たら「保存しないで移る」**＝撮影用の状態なので捨ててよい
 *（利用者の実データは退避してあり、ここで作られるのは撮影中の仮の動画だけ）。
 */
const RESET_TO_HOME = `(async () => {
  const find = (t) => Array.from(document.querySelectorAll("button,a,[role=button]"))
    .find((b) => (b.textContent || "").trim() === t);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // ⚠️ **戻り道は画面によって違う**（#1228・実測）＝「動画の一覧へ戻る」が無い画面があり
  //  （例＝「発表の内容を入力」）、そこでは**サイドバーの「動画」**が入口になる。両方を試す。
  for (let i = 0; i < 8; i += 1) {
    if (find("新しい動画を作る")) return "home";
    const back = find("動画の一覧へ戻る") || find("動画");
    if (back) { back.click(); await wait(500); }
    const drop = find("保存しないで移る");
    if (drop) { drop.click(); await wait(500); }
    await wait(400);
  }
  return find("新しい動画を作る") ? "home" : "stuck";
})()`;

async function main() {
  const [scriptPath, ...rest] = process.argv.slice(2);
  if (!scriptPath) {
    console.error("使い方: node scripts/tutorialRecord.mjs <台本.json> --out <出力フォルダ>");
    process.exit(2);
  }
  const outDir = resolve(parseOutDir(rest));
  // ⚠️ **すでに開いているアプリを使う**（#1228）＝利用者が**外部ディスプレイへ置いた窓**を
  //   そのまま撮るため。既定（印なし）は今までどおり、殺してから起こす。
  const attach = rest.includes("--attach");
  // ⚠️ **当たりは両方に置く**（同レビュー 🟡）＝アプリだけ見てあり、**FFmpeg は非対称**だった。
  if (!existsSync(APP)) throw new Error(`アプリがありません（先に build を）: ${APP}`);
  if (!existsSync(FFMPEG)) throw new Error(`FFmpeg がありません: ${FFMPEG}`);
  mkdirSync(outDir, { recursive: true });
  const plan = checkPlan(JSON.parse(readFileSync(scriptPath, "utf8")));
  const video = join(outDir, `${plan.name ?? "tutorial"}.mp4`);
  const logPath = join(outDir, `${plan.name ?? "tutorial"}.steps.json`);

  // ① アプリを用意する（`--attach` なら、いま開いているものをそのまま使う）
  // ⚠️ **環境変数でだけ**リモートデバッグを開く（待ち受けは作らない＝ADR-0042）。
  if (attach) {
    console.log("すでに開いているアプリを使います（--attach）＝窓の位置・大きさは触りません");
  } else {
    spawnSync("powershell", ["-NoProfile", "-Command",
      `Stop-Process -Name star-recruit-studio -Force -ErrorAction SilentlyContinue`], { stdio: "ignore", windowsHide: true });
    const app = spawn(APP, [], {
      stdio: "ignore",
      detached: true,
      env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
      windowsHide: true,
    });
    app.unref();
  }

  let cdp;
  let ff;
  let ok = false;
  try {
    cdp = connect(await waitForTarget(PORT));
    await cdp.ready;
    await cdp.send("Runtime.enable");
    await new Promise((r) => setTimeout(r, 1500)); // 初回描画を待つ

    // ⚠️ **窓が落ち着いてから測る**（実測で踏んだ）＝起動直後はまだ大きさが動いており、
    //   そこで測ると `view` が**古い値**になる。実際に、中身の高さが 33 画素ずれた録画ができた
    //   （下の実測が捕まえた）。**同じ値が2回続く**まで待つ。
    const rect = await stableWindowRect();
    const vp = JSON.parse(await evaluate(cdp, VIEWPORT));
    // ⚠️ **ずれは実測から採る**（推測しない）＝窓の原点と、画面の中身の原点の差。
    // ⚠️ **ここでは対応（view）を作らない**（#1228）＝原点も倍率も**撮り終えてから実測**する。
    //   以前は `screenX - windowX` の引き算で原点を出していたが、`screenX` は CSS px、
    //   `GetWindowRect` は物理 px なので**拡大率 100% のときしか合わず**、断るしかなかった。
    const page = { width: vp.width, height: vp.height, dpr: vp.dpr };
    console.log(`窓: ${rect.w}x${rect.h} @ (${rect.x},${rect.y}) / 中身: ${page.width}x${page.height} CSS px・拡大率 ${page.dpr}`);

    // ⚠️ **はみ出していたら、断るのではなく収める**（#1228）＝はみ出した所には
    //   タスクバーや別の画面が写る（＝教材に別のものが混ざる）。撮影の道具なので、
    //   **収まる位置と大きさへ寄せてから撮る**のが筋（毎回同じ画角になる利点もある）。
    const area = workArea();
    const origin = virtualOrigin();
    const fitted = attach ? null : fitIntoWorkArea(rect, area);
    if (attach) {
      // ⚠️ **収まらないときだけ、窓のほうを合わせる**（#1228）＝最大化した窓は
      //   タスクバーの下まで伸びることがあり、そのままだと**アプリの下端が覆われて写らない**。
      //   切り取るとアプリが欠けるので、**同じ画面のまま作業領域へ合わせる**（位置は動かす）。
      const over = fitIntoWorkArea(rect, area);
      if (over) {
        console.log(`窓が作業領域に収まっていないので合わせます（同じ画面のまま）: `
          + `${rect.w}x${rect.h} @ (${rect.x},${rect.y}) → ${over.w}x${over.h} @ (${over.x},${over.y})`);
        moveWindow(over);
        await new Promise((r) => setTimeout(r, 700));
        Object.assign(rect, await stableWindowRect());
        Object.assign(page, JSON.parse(await evaluate(cdp, VIEWPORT)));
      }
      const clipped = clipToArea(rect, area);
      Object.assign(rect, clipped);
      console.log(`撮る矩形: ${rect.w}x${rect.h} @ (${rect.x},${rect.y}) / 中身 ${page.width}x${page.height} CSS px`);
    }
    if (fitted) {
      console.log(`窓を収めました: ${rect.w}x${rect.h} @ (${rect.x},${rect.y}) → ${fitted.w}x${fitted.h} @ (${fitted.x},${fitted.y})`);
      moveWindow(fitted);
      await new Promise((r) => setTimeout(r, 600));
      const after = await stableWindowRect();
      Object.assign(rect, after);
      // ⚠️ **動かしたら測り直す**＝窓を動かすと中身の大きさも変わる（CSS px が変わる）。
      Object.assign(page, JSON.parse(await evaluate(cdp, VIEWPORT)));
      console.log(`窓: ${rect.w}x${rect.h} @ (${rect.x},${rect.y}) / 中身: ${page.width}x${page.height} CSS px`);
      const still = fitIntoWorkArea(rect, area);
      if (still) throw new Error(`窓を収められませんでした（${rect.w}x${rect.h} @ (${rect.x},${rect.y})・使える範囲 ${area.w}x${area.h}）＝手で小さくしてから撮ってください`);
    }

    // ⚠️ **撮る前に必ず前面へ出す**（#1228）＝裏に回っていると、その矩形に載っている
    //   **別の窓（利用者の作業中の画面）をそのまま録る**。実際に一度、表計算の画面を録ってしまった。
    // ⚠️ **前面は画面をまたいで1つ**（#1228・実測）＝外部ディスプレイのアプリが
    //   まるごと見えていても、別の画面で作業していれば「前面ではない」。だから**前面は条件にしない**。
    //   守りたいのは「**アプリが覆われていないか**」なので、そちらは**目印の実測**で見る（下の②'と⑤'）。
    if (bringToFront()) console.log("✓ アプリの窓を前面に出しました（この矩形を撮ります）");
    else console.warn("⚠ アプリを前面に出せませんでした（別の画面で作業中？）。覆われていないかは目印で確かめます");

    // ⚠️ **撮る前にホームへ戻す**（#1228）＝前の回で画面が進んだままだと1手目が見つからない。
    const reset = await evaluate(cdp, RESET_TO_HOME);
    if (reset !== "home") {
      throw new Error("ホーム画面へ戻せませんでした＝アプリを『動画の一覧』の画面にしてから、もう一度実行してください");
    }
    console.log("✓ ホーム画面から始めます");

    // ② 録画を始める（⚠️ **デスクトップから切り出す**・実カーソルは消す）
    // ⚠️ **起動に失敗したら、その場で分かるようにする**（PR #1234 レビュー 🟡）＝
    //   `error` を拾わないと未処理例外になり、**後片づけを通らずに落ちる**（口が開いたまま残る）。
    ff = spawn(FFMPEG, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "gdigrab", "-framerate", String(FPS), "-draw_mouse", "0",
      // ⚠️ **仮想デスクトップの左上ぶんを引く**（#1228）＝`-offset_x/-offset_y` の原点は
      //   (0,0) とは限らない（画面を左や上に並べると負になる）。外部ディスプレイで踏む。
      "-offset_x", String(rect.x - origin.x), "-offset_y", String(rect.y - origin.y),
      "-video_size", `${rect.w}x${rect.h}`, "-i", "desktop",
      "-c:v", "h264_mf", "-b:v", "8000k", "-pix_fmt", "yuv420p", video,
    ], {
      stdio: ["pipe", "ignore", "inherit"],
      // ⚠️ **コンソールの窓を出さない**（#1228・実測）＝出すと**前に出てきて**、
      //   前面の見張りが鳴るうえ、**その窓が録画に写る**。
      windowsHide: true,
    });
    // ⚠️ **リスナの中で投げない**（PR #1237 4回目 ℹ️）＝投げても **uncaughtException** になるだけで、
    //   下の `finally` を通らない＝**アプリとデバッグの口が開いたまま残る**。
    //   直前のコメントが「拾えば後片づけを通る」と言っていたのに、**実装はそうなっていなかった**。
    //   受け取るのは箱に入れるだけにして、**本流の `checkStillRecording` から投げる**。
    let ffError = null;
    let warnedBack = false;
    ff.on("error", (e) => { ffError = e; });
    // ⚠️ **途中で死んだことに気づけるようにする**（実機で踏んだ）＝`error` は**起こせなかったとき**
    //   しか鳴らない。**起きたあとに落ちた**回は誰も見ておらず、台本を最後まで走らせたうえで
    //   `ff.on("exit")` を待ち続けて**永遠に止まった**（実際に2回、数分待っても返らなかった）。
    //   ⚠️ **止まるのが最悪**＝何が起きたか分からず、録れていないことにも気づけない。
    let ffExit = null;
    ff.on("exit", (code) => { ffExit = code ?? -1; });
    const t0 = Date.now();
    await new Promise((r) => setTimeout(r, 1200)); // 録り始めの安定待ち
    /** 録画が生きているか（死んでいたら**その場で**理由つきで止める）。 */
    const checkStillRecording = (when) => {
      if (ffError) throw new Error(`FFmpeg を起こせません（${when}）: ${ffError.message}`);
      // ⚠️ **前面を奪われていないか**＝奪われたまま撮り続けると、**他人の画面が入る**。
      const fg = isForeground();
      if (fg === "gone") throw new Error(`アプリの窓が消えました（${when}）`);
      if (fg !== "front" && !warnedBack) {
        warnedBack = true;
        console.warn(`⚠ 別のアプリが前面です（${when}）。アプリが覆われていれば、撮り終わりの目印で捕まえます`);
      }
      if (ffExit === null) return;
      throw new Error([
        `録画が${when}止まりました（FFmpeg の終了コード ${ffExit}）。次のどれかです:`,
        "  ・画面がロックされている／リモート接続が切れている（`gdigrab` は撮れません。ロックを解いてから撮ってください）",
        "  ・書き込み先が使えない（別のソフトが同じファイルを開いていませんか）",
        "  上に FFmpeg のメッセージが出ています。",
      ].join(`
`));
    };
    checkStillRecording("始まってすぐに");

    // ②'⚠️ **中身が録画のどこに写っているかを、測る**（PR #1237 レビュー 🟡）＝
    //   `view` は引き算で出した値なので、**それで描いて、それで検査する**限り
    //   間違いに気づけない（実測で通ってしまった）。画面いっぱいの目印を焼き付けて、後で測る。
    const flashAtSec = (Date.now() - t0) / 1000;
    await evaluate(cdp, FLASH_ON);
    await new Promise((r) => setTimeout(r, FLASH_SEC * 1000));
    await evaluate(cdp, FLASH_OFF);
    await new Promise((r) => setTimeout(r, AFTER_FLASH_SEC * 1000));
    /** ⚠️ **焼く側はここから先だけを使う**＝目印を配る素材に載せない。 */
    const usableFromSec = Number((flashAtSec + FLASH_SEC + 0.3).toFixed(3));
    // ⚠️ **台本を走らせる前に、もう一度見る**＝ここで死んでいると、以降の数十秒が丸ごと無駄になる。
    checkStillRecording("目印を出している間に");

    // ③ 台本を走らせ、**押した時刻と座標**を残す（仮想カーソルの素＝#1227）
    const log = [];
    for (const step of plan.steps) {
      if (step.waitMs != null) {
        await new Promise((r) => setTimeout(r, step.waitMs));
        continue;
      }
      const isTyping = step.fieldLabel != null;
      const at = await evaluate(cdp, isTyping ? LOCATE_FIELD(step.fieldLabel) : LOCATE(step.clickText));
      if (!at) {
        throw new Error(isTyping
          ? `入力欄がありません: ${step.fieldLabel}（画面が違うか、ラベルが変わっていませんか）`
          : `押せる要素がありません: ${step.clickText}`);
      }
      const tSec = (Date.now() - t0) / 1000;
      // ⚠️ **本物の入力を送る**＝JS の `.click()` ではなく、人が押したのと同じ道を通す。
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
        await cdp.send("Input.dispatchMouseEvent", {
          type, x: at.x, y: at.y, button: "left", clickCount: type === "mouseMoved" ? 0 : 1,
        });
      }
      // ⚠️ **1文字ずつ打つ**（#1228・利用者の要望）＝まとめて入れると「打っている所」が
      //   映らず、教材として何が起きたのか分からない。人が打つ速さに近づける。
      if (isTyping) {
        for (const ch of [...step.type]) {
          await cdp.send("Input.insertText", { text: ch });
          await new Promise((r) => setTimeout(r, step.typeMs ?? 70));
        }
        // ⚠️ **打てたかを確かめる**＝欄が読み取り専用だったり、別の所に入ったりしても
        //   **黙って進んでしまう**（教材に「打ったのに空の欄」が残る）。
        const got = await evaluate(cdp, VALUE_OF(step.fieldLabel));
        if (got !== step.type) {
          throw new Error(`「${step.fieldLabel}」に打てていません（入っているのは ${JSON.stringify(got)}）`);
        }
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
        typed: isTyping ? step.type : null,
        say: step.say ?? null,
        headingAfter,
      });
      console.log(`${tSec.toFixed(1)}s ${isTyping ? `「${step.fieldLabel}」へ「${step.type}」` : `「${at.label}」`}`
        + `(${at.x},${at.y}) → ${headingAfter}`);
      // ⚠️ **段ごとに見る**（PR #1237 4回目 ℹ️）＝台本は分単位で走るので、ここで死ぬと
      //   **残り全部を無駄に走らせてから**落ちる（実機で踏んだ画面ロックは、まさにここで起きる）。
      checkStillRecording(`${log.length} 段目のあとに`);
    }

    // ④' ⚠️ **撮り終わりにも目印を出す**（#1228）＝途中で別の窓が
    //   アプリを覆っていたら、ここで矩形が変わる（＝覆われたまま撮った回を捕まえる）。
    const endFlashAtSec = (Date.now() - t0) / 1000;
    await evaluate(cdp, FLASH_ON);
    await new Promise((r) => setTimeout(r, FLASH_SEC * 1000));
    await evaluate(cdp, FLASH_OFF);
    await new Promise((r) => setTimeout(r, 400));

    // ④ 録画を終える
    checkStillRecording("台本を走らせている間に");
    ff.stdin.write("q");
    // ⚠️ **既に終わっていたら待たない**＝`exit` は一度しか鳴らないので、鳴った後に待つと**永遠に返らない**。
    if (ffExit === null) await new Promise((r) => ff.on("exit", r));
    ff = null;
    const totalSec = (Date.now() - t0) / 1000;

    // ⑤ ⚠️ **撮れたことを機械で確かめる**（ここを省くと嘘の教材ができる）
    const view = measureView(video, flashAtSec, rect, page);
    // ⚠️ **撮り終わりの矩形と突き合わせる**＝途中で覆われていたら、ここで食い違う。
    const endView = measureView(video, endFlashAtSec, rect, page);
    if (endView.offsetX !== view.offsetX || endView.offsetY !== view.offsetY
      || endView.width !== view.width || endView.height !== view.height) {
      throw new Error(`撮り始めと撮り終わりで、アプリの写り方が変わりました`
        + `（始め ${view.width}x${view.height} @ (${view.offsetX},${view.offsetY})`
        + ` / 終わり ${endView.width}x${endView.height} @ (${endView.offsetX},${endView.offsetY})）`
        + "＝途中で別の窓が覆ったか、窓が動きました。撮り直してください");
    }
    // ⚠️ **目印より後ろだけを数える**（PR #1237 3回目 🟡）＝撮り始めの目印は**画面いっぱいが変わる**ので、
    //   先頭から数えると `distinctFrames` が必ず 2 以上になり、**この門が鳴らなくなっていた**
    //  （＝「窓指定で撮ると全コマ同じ絵」という、いちばん守りたい形が素通りする）。
    const seen = sampleFrames(FFMPEG, video, 2, usableFromSec);
    const kinds = distinctFrames(seen);

    // ⚠️ **段ごとに見る**（PR #1234 レビュー 🟡）＝録画ぜんたいで1回だけ数えると、
    //   **どこか1回でも絵が変われば通る**＝段①だけ写って②③が凍った回も `✓` になる。
    //   押した前後の窓を採り、**その段で絵が動いたか**を1段ずつ確かめる。
    const frozenSteps = [];
    for (const s of log) {
      // ⚠️ **打つ段は絵で見ない**（#1228・実測）＝数文字の増加は、全画面を 32x18 まで
      //   縮める比較では**見えない**（実際に「動いていない」と誤って出た）。
      //   打つ段は**入った文字そのもの**を打った直後に照合してあるので、そちらのほうが強い証拠。
      if (s.typed != null) continue;
      const from = Math.max(0, s.atSec - STEP_WINDOW_SEC);
      const to = s.atSec + STEP_WINDOW_SEC;
      // ⚠️ **押した所の周りを見る**（#1228・実測）＝全画面だと、カードを選んだだけの
      //   **強調の変化**が縮小で消えて「動いていない」と誤って出た。押した点を中心に切って見る。
      const at = toVideoPoint(view, s.x, s.y);
      const half = { w: 500, h: 380 };
      const crop = {
        w: Math.min(half.w * 2, rect.w),
        h: Math.min(half.h * 2, rect.h),
        x: Math.max(0, Math.min(at.x - half.w, rect.w - Math.min(half.w * 2, rect.w))),
        y: Math.max(0, Math.min(at.y - half.h, rect.h - Math.min(half.h * 2, rect.h))),
      };
      const around = sampleFrames(FFMPEG, video, STEP_SAMPLE_FPS, from, to, crop);
      if (around.length < 2) { frozenSteps.push(`${s.atSec}s（コマが足りない）`); continue; }
      if (distinctFrames(around) < 2) frozenSteps.push(`${s.atSec}s「${s.label}」`);
    }
    writeFileSync(logPath, JSON.stringify({
      name: plan.name, video, totalSec, distinctFrames: kinds,
      // ⚠️ **カーソルを描く側（#1227）が使う**＝ここが無いと押した所と違う場所に印が出る。
      view, fps: FPS, flashAtSec, usableFromSec,
      // ⚠️ **終わりの目印より前までが使える所**（#1228・利用者の指摘）＝
      //   頭は切っていたのに**終わりを切っていなかった**ので、**動画の最後に一面のピンクが残っていた**。
      usableToSec: Number((endFlashAtSec - 0.2).toFixed(3)),
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
    if (frozenSteps.length > 0) {
      throw new Error(`押したのに絵が動いていない段があります:\n  ${frozenSteps.join("\n  ")}`);
    }
    console.log("✓ 撮れました（段ごとに絵が動いたことを確かめました。中身は目で見てください）");
    ok = true;
  } finally {
    try { ff?.kill(); } catch { /* 既に終わっている */ }
    cdp?.close();
    // ⚠️ **うまくいかなかった録画は残さない**（#1228・実際に踏んだ）＝
    //   `gdigrab` は**画面のその矩形**を撮るので、失敗した回のファイルには
    //   **何が写っているか分からない**（一度、利用者の作業中の表計算が丸ごと入った）。
    //   ⚠️ **中身を確かめるまで人の目に触れさせない**より、**消す**ほうが確実。
    if (!ok && video && existsSync(video)) {
      try {
        rmSync(video);
        console.error(`（うまくいかなかったので録画を消しました: ${video}）`);
        console.error("  ⚠️ 画面のその矩形を撮るため、失敗した録画には別の窓が写っていることがあります。");
      } catch { /* 消せなければそのまま（読み手に上の注意が出ている） */ }
    }
    // ⚠️ **`--attach` のときは閉じない**＝利用者が開いていたものを勝手に落とさない。
    if (!attach) {
      spawnSync("powershell", ["-NoProfile", "-Command",
        "Stop-Process -Name star-recruit-studio -Force -ErrorAction SilentlyContinue"], { stdio: "ignore", windowsHide: true });
    }
  }
}

await main();
