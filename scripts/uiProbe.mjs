// 実 UI を**操作して測る**道具（#1104）。
//
// ⚠️ **なぜ要るか**＝jsdom は**レイアウトを計算しない**ので、検査は「CSS にこう書いてある」までしか
// 見られない。高さの取り合い（欄の割合・器の高さ・行の高さ）は**実際に描かせないと分からず**、
// 2026-09-10 に利用者へスクリーンショットを4往復させた（そのうち1回は、直したつもりの CSS が
// 同じ規則の後ろの宣言に打ち消されていて**まったく効いていなかった**）。
//
// ⚠️ **依存を増やさない**＝Node 22 の組み込み `WebSocket` で DevTools プロトコルを直に叩く。
// Playwright 等は入れない（ブラウザの再ダウンロードが要るため）。
// ⚠️ **配線は共有**（#1226）＝`scripts/lib/cdp.mjs`。**packaged のアプリを録る道具**（`tutorialRecord.mjs`）が
// 同じものを要るので、写さずに1か所へ置いた。
//
// 使い方:
//   node tools/uiProbe.mjs <url> <台本.json> [--shot 出力.png] [--width 1920] [--height 1040]
//
// 台本（JSON の配列）で使える手順:
//   { "clickText": "タイムラインで作る" }   … その文字を持つ最も内側の要素を押す
//   { "click": ".panel-layout" }            … CSS の選び方で押す
//   { "waitMs": 500 }                        … 待つ
//   { "measure": [".timeline-flash-zone", ".panel-layout"] } … 箱の位置と大きさを出す
//   { "eval": "document.title" }             … 任意の式（返り値を出す）
import { spawn } from "node:child_process";
import { existsSync, writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIND_BY_TEXT, connect, evaluate, waitForTarget } from "./lib/cdp.mjs";

const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];

function findBrowser() {
  const hit = BROWSERS.find((p) => existsSync(p));
  if (!hit) throw new Error("Chrome も Edge も見つかりません（このPCで実 UI を測れません）");
  return hit;
}

/**
 * 文字で要素を押す（画面の言葉で書けるようにする＝選び方を知らなくても台本が書ける）。
 *
 * ⚠️ **探し方は共有**（`FIND_BY_TEXT`）＝ここは「探して**押す**」だけを足す。
 */
const CLICK_BY_TEXT = (text) => `(() => {
  const hit = ${FIND_BY_TEXT(text)};
  if (!hit) return { ok: false, reason: "見つかりません: " + ${JSON.stringify(text)} };
  hit.click();
  return { ok: true };
})()`;

/** 箱の位置と大きさ（実寸）。無い要素は null で返す＝「測れなかった」を黙って 0 にしない。 */
const MEASURE = (selectors) => `(() => {
  const out = {};
  for (const sel of ${JSON.stringify(selectors)}) {
    const el = document.querySelector(sel);
    if (!el) { out[sel] = null; continue; }
    const r = el.getBoundingClientRect();
    out[sel] = {
      top: Math.round(r.top), bottom: Math.round(r.bottom),
      height: Math.round(r.height), width: Math.round(r.width),
      scrollH: el.scrollHeight, clientH: el.clientHeight,
      scrolls: el.scrollHeight > el.clientHeight + 1,
    };
  }
  out["#viewport"] = { height: window.innerHeight, width: window.innerWidth };
  out["#pageScrolls"] = document.documentElement.scrollHeight > window.innerHeight + 1;
  return out;
})()`;

async function main() {
  const [url, scriptPath, ...rest] = process.argv.slice(2);
  if (!url || !scriptPath) {
    console.error("使い方: node tools/uiProbe.mjs <url> <台本.json> [--shot out.png] [--width N] [--height N]");
    process.exit(2);
  }
  const arg = (name, fallback) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : fallback;
  };
  const width = Number(arg("--width", 1920));
  const height = Number(arg("--height", 1040));
  const shot = arg("--shot", null);
  const steps = JSON.parse(readFileSync(scriptPath, "utf8"));

  const port = 9223 + (process.pid % 200);
  const profile = mkdtempSync(join(tmpdir(), "stario-uiprobe-"));
  const child = spawn(findBrowser(), [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars=false",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    `--window-size=${width},${height}`,
    url,
  ], { stdio: "ignore" });

  let cdp;
  try {
    cdp = connect(await waitForTarget(port));
    await cdp.ready;
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    // 最初の描画を待つ（React の初回マウント）。
    await new Promise((r) => setTimeout(r, 1500));

    for (const step of steps) {
      if (step.waitMs != null) {
        await new Promise((r) => setTimeout(r, step.waitMs));
      } else if (step.clickText != null) {
        const r = await evaluate(cdp, CLICK_BY_TEXT(step.clickText));
        console.log(`click「${step.clickText}」→ ${r.ok ? "押した" : r.reason}`);
        if (!r.ok) process.exitCode = 1;
      } else if (step.click != null) {
        const r = await evaluate(cdp, `(() => { const e = document.querySelector(${JSON.stringify(step.click)}); if (!e) return { ok: false }; e.click(); return { ok: true }; })()`);
        console.log(`click(${step.click}) → ${r.ok ? "押した" : "見つかりません"}`);
      } else if (step.measure != null) {
        const boxes = await evaluate(cdp, MEASURE(step.measure));
        console.log(JSON.stringify(boxes, null, 2));
      } else if (step.eval != null) {
        console.log(JSON.stringify(await evaluate(cdp, step.eval), null, 2));
      }
    }

    if (shot) {
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      writeFileSync(shot, Buffer.from(data, "base64"));
      console.log(`shot: ${shot}`);
    }
  } finally {
    cdp?.close();
    child.kill();
  }
}

await main();
