// チュートリアル映像を**仕上げる**道具（ADR-0046 ④＝編集はこのソフト自身でやる・#1228）。
//
// 録った映像（カーソルを焼いた版）と掛け合いの台本から、**タイムライン形式の動画のフォルダ**を組む。
// できたフォルダは、外の AI と同じ口（`--import` → `--export`・`18_EXTERNAL_AGENT_CONTRACT`）でアプリに取り込んで書き出す。
// ⚠️ **製品の一部ではない**＝作るための道具。アプリの検証（取り込みの形・書き出しのつながり）をそのまま通る形で書く。
//
// 使い方:
//   node scripts/tutorialCompose.mjs --steps <録画.steps.json> --video <録画.cursor.mp4> --dialogue <台本.dialogue.json> --out <フォルダ> [--title <題>]
//
// 組み方:
//   - 映像は**段ごとに切る**（段 i＝その段を押した時刻から次の段まで）。その段の掛け合いが映像より長いときは、
//     **段の最後のコマを止めて**（静止画）声が終わるまで待つ＝声と画面がずれない。
//   - 台本の `at` は `opening`（映像の前）・`ending`（映像の後）・段の `say`（その段の頭から話し始める）。
//   - 声は**同梱の音声ソフト**で作って `voices/` に置き、部品を「作成済み」にする（契約 18.4）。字幕は声に連動させ、文は台本の `text`（声は `reading` があればそれで読む）。
//   - ゆうこの立ち絵は、ゆうこの声の列が鳴っている間だけ動く（ADR-0056）。天の声は別の列（立ち絵なし）。
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import net from "node:net";

const FFMPEG = "src-tauri/resources/ffmpeg/bin/ffmpeg.exe";
const ENGINE = "src-tauri/resources/voicevox_engine/run.exe";
const YUKO = "public/yuko/yuko_smile_001.png";
const CANVAS = { w: 1920, h: 1080 };
/** 録画（1280×800）を置く箱。右に立ち絵の場所を空ける。 */
const VIDEO_BOX = { x: 40, y: 60, w: 1536, h: 960 };
const LINE_GAP = 0.25;

/** WAV の長さ（秒）＝data の大きさ ÷ 1秒あたりのバイト数。 */
export function wavDurationSec(buf) {
  const byteRate = buf.readUInt32LE(28);
  let p = 12;
  while (p + 8 <= buf.length) {
    const id = buf.toString("ascii", p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (id === "data") return size / byteRate;
    p += 8 + size + (size % 2);
  }
  throw new Error("WAV の data が見つかりません");
}

/**
 * 段ごとの区切りと、各段の掛け合いを並べる（純粋）。
 * @param stepTimes 仕上げた映像の中で各段を押した時刻（昇順）
 * @param videoSec 映像の長さ
 * @param lineAt 各行がどこで話すか（"opening" | "ending" | 段の番号）
 * @param lineSec 各行の声の長さ
 * @returns 並べた部品（映像の区間・止めたコマ・声の開始）と全体の長さ
 */
export function planTimeline(stepTimes, videoSec, lineAt, lineSec) {
  const items = [];
  const voiceAt = new Array(lineSec.length).fill(null);
  let t = 0;
  const speak = (idxs, from) => {
    let s = from;
    for (const i of idxs) {
      voiceAt[i] = s;
      s += lineSec[i] + LINE_GAP;
    }
    return idxs.length ? s - LINE_GAP : from;
  };
  const linesOf = (at) => lineAt.map((a, i) => (a === at ? i : -1)).filter((i) => i >= 0);
  // 映像の前（最初のコマを止めて話す）
  const open = linesOf("opening");
  if (open.length) {
    const end = speak(open, 0.6);
    items.push({ kind: "still", frameSec: 0, startSec: 0, durationSec: end + 0.6 });
    t = end + 0.6;
  }
  const bounds = [0, ...stepTimes, videoSec];
  for (let k = 0; k < bounds.length - 1; k += 1) {
    const from = bounds[k];
    const to = bounds[k + 1];
    if (to - from <= 0.01) continue;
    const segStart = t;
    items.push({ kind: "video", sourceStartSec: from, startSec: t, durationSec: to - from });
    const idxs = k === 0 ? [] : linesOf(k - 1);
    const voiceEnd = speak(idxs, segStart + 0.2);
    t += to - from;
    if (voiceEnd + 0.3 > t) {
      // 声が長い＝段の最後のコマを止めて待つ
      const hold = voiceEnd + 0.3 - t;
      items.push({ kind: "still", frameSec: Math.max(0, to - 0.1), startSec: t, durationSec: hold });
      t += hold;
    }
  }
  const end = linesOf("ending");
  if (end.length) {
    const e = speak(end, t + 0.3);
    items.push({ kind: "still", frameSec: Math.max(0, videoSec - 0.1), startSec: t, durationSec: e + 0.8 - t });
    t = e + 0.8;
  }
  return { items, voiceAt, totalSec: t };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function freePort() {
  return new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = /** @type {import("node:net").AddressInfo} */ (s.address());
      s.close(() => ok(port));
    });
  });
}

async function startEngine() {
  const port = await freePort();
  const child = spawn(resolve(ENGINE), ["--host", "127.0.0.1", "--port", String(port)], {
    cwd: resolve(ENGINE, ".."), stdio: "ignore", windowsHide: true,
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch(`${base}/version`)).ok) return { base, child };
    } catch { /* まだ起きていない */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error("音声ソフトが起きませんでした");
}

async function synth(base, text, speaker) {
  const q = await fetch(`${base}/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`, { method: "POST" });
  if (!q.ok) throw new Error(`読み上げの準備に失敗: ${text}`);
  const query = await q.json();
  const r = await fetch(`${base}/synthesis?speaker=${speaker}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(query),
  });
  if (!r.ok) throw new Error(`声を作れませんでした: ${text}`);
  return Buffer.from(await r.arrayBuffer());
}

function stillFrame(video, sec, out) {
  const r = spawnSync(resolve(FFMPEG), ["-loglevel", "error", "-y", "-ss", String(sec), "-i", video, "-frames:v", "1", out], { windowsHide: true });
  if (r.status !== 0 || !existsSync(out)) throw new Error(`止めたコマを取り出せません（${sec}s）`);
}

function videoDurationSec(video) {
  const r = spawnSync(resolve(FFMPEG), ["-i", video], { encoding: "utf8", windowsHide: true });
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr ?? "");
  if (!m) throw new Error("映像の長さを読めません");
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

async function main() {
  const stepsPath = arg("--steps");
  const video = arg("--video");
  const dialoguePath = arg("--dialogue");
  const out = arg("--out");
  if (!stepsPath || !video || !dialoguePath || !out) {
    console.error("使い方: node scripts/tutorialCompose.mjs --steps <.steps.json> --video <.cursor.mp4> --dialogue <.dialogue.json> --out <フォルダ> [--title <題>]");
    process.exit(2);
  }
  const log = JSON.parse(readFileSync(stepsPath, "utf8"));
  const dialogue = JSON.parse(readFileSync(dialoguePath, "utf8"));
  const title = arg("--title") ?? dialogue.title ?? dialogue.name;
  // 焼いた映像の t=0 は、録画の `usableFromSec` をコマの境目へ切り上げた所（tutorialCursor と同じ式）
  const trim = log.fps > 0 ? Math.ceil(log.usableFromSec * log.fps) / log.fps : log.usableFromSec;
  const stepTimes = log.steps.map((s) => Math.max(0, s.atSec - trim));
  const videoSec = videoDurationSec(video);
  const sayIndex = new Map(log.steps.map((s, i) => [s.say, i]));
  const lineAt = dialogue.lines.map((l) => {
    if (l.at === "opening" || l.at === "ending") return l.at;
    if (!sayIndex.has(l.at)) throw new Error(`台本の段に無い at です: ${l.at}`);
    return sayIndex.get(l.at);
  });

  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "assets"), { recursive: true });
  mkdirSync(join(out, "voices"), { recursive: true });

  // ① 声を作る
  const { base, child } = await startEngine();
  const lineSec = [];
  try {
    for (let i = 0; i < dialogue.lines.length; i += 1) {
      const l = dialogue.lines[i];
      const cast = dialogue.cast[l.who];
      const wav = await synth(base, l.reading ?? l.text, cast.speaker);
      writeFileSync(join(out, "voices", `line_${String(i + 1).padStart(3, "0")}.wav`), wav);
      lineSec.push(wavDurationSec(wav));
    }
  } finally {
    child.kill();
  }

  // ② 並べる
  const plan = planTimeline(stepTimes, videoSec, lineAt, lineSec);
  copyFileSync(video, join(out, "assets", "asset_001.mp4"));
  copyFileSync(YUKO, join(out, "assets", "asset_002.png"));
  const assets = [
    { assetId: "asset_001", assetType: "video", displayName: `${title}（録画）`, filePath: "assets/asset_001.mp4" },
    { assetId: "asset_002", assetType: "image", displayName: "ゆうこ（笑顔）", filePath: "assets/asset_002.png" },
  ];
  const tracks = [
    { id: "track_001", kind: "visual", name: "背景" },
    { id: "track_002", kind: "visual", name: "録画" },
    { id: "track_003", kind: "visual", name: "立ち絵" },
    { id: "track_004", kind: "visual", name: "字幕・題字" },
    { id: "track_005", kind: "audio", name: "ゆうこの声" },
    { id: "track_006", kind: "audio", name: "天の声" },
    { id: "track_007", kind: "audio", name: "音楽" },
  ];
  const clips = [];
  let n = 0;
  const id = () => `clip_${String(++n).padStart(3, "0")}`;
  const total = Math.ceil(plan.totalSec * 10) / 10;
  clips.push({ id: id(), kind: "shape", trackId: "track_001", startSec: 0, durationSec: total, x: 0, y: 0, w: CANVAS.w, h: CANVAS.h, shapeType: "rect", fillColor: "#e9f2f1" });
  let still = 0;
  for (const it of plan.items) {
    const box = { x: VIDEO_BOX.x, y: VIDEO_BOX.y, w: VIDEO_BOX.w, h: VIDEO_BOX.h, fit: "contain" };
    if (it.kind === "video") {
      clips.push({ id: id(), kind: "slot", trackId: "track_002", startSec: r3(it.startSec), durationSec: r3(it.durationSec), ...box, assetId: "asset_001", sourceStartSec: r3(it.sourceStartSec) });
    } else {
      still += 1;
      const assetId = `asset_${String(100 + still).padStart(3, "0")}`;
      stillFrame(video, it.frameSec, join(out, "assets", `${assetId}.png`));
      assets.push({ assetId, assetType: "image", displayName: `止めたコマ ${still}`, filePath: `assets/${assetId}.png` });
      clips.push({ id: id(), kind: "slot", trackId: "track_002", startSec: r3(it.startSec), durationSec: r3(it.durationSec), ...box, assetId });
    }
  }
  clips.push({
    id: id(), kind: "slot", trackId: "track_003", startSec: 0, durationSec: total,
    x: 1560, y: 520, w: 340, h: 540, assetId: "asset_002", fit: "contain",
    talkMotion: { trackId: "track_005", kind: "bounce", strength: 1 },
  });
  if (title) {
    const openEnd = plan.items[0]?.kind === "still" ? plan.items[0].durationSec : 3;
    clips.push({ id: id(), kind: "text", trackId: "track_004", startSec: 0, durationSec: r3(Math.max(2, openEnd)), x: 140, y: 420, w: 1340, h: 200, text: title, fontSize: 88, color: "#ffffff", fontWeight: "bold", textAlign: "center", background: { enabled: true, color: "#1f6f78", opacity: 0.9, radius: 24 } });
  }
  dialogue.lines.forEach((l, i) => {
    const cast = dialogue.cast[l.who];
    const vId = id();
    clips.push({
      id: vId, kind: "voice", trackId: l.who === "yuko" ? "track_005" : "track_006",
      startSec: r3(plan.voiceAt[i]), durationSec: r3(lineSec[i]), name: `${cast.displayName} ${i + 1}`, volume: 1,
      voice: { text: l.reading ?? l.text, speaker: cast.speaker, voicePath: `voices/line_${String(i + 1).padStart(3, "0")}.wav`, status: "generated" },
    });
    clips.push({
      id: id(), kind: "subtitle", trackId: "track_004", startSec: r3(plan.voiceAt[i]), durationSec: r3(lineSec[i]),
      x: 80, y: 930, w: 1460, h: 120, fontSize: 44, color: "#ffffff",
      background: { enabled: true, color: "#000000", opacity: 0.6, radius: 14 },
      voiceClipId: vId, text: `${cast.displayName}「${l.text}」`,
    });
  });
  clips.push({ id: id(), kind: "audio", trackId: "track_007", startSec: 0, durationSec: total, bundledBgmId: "summer-morning", volume: 0.12, fadeInSec: 1, fadeOutSec: 2 });

  const now = new Date().toISOString();
  const doc = {
    schemaVersion: "1.19", format: "timeline", projectId: "proj_20260101_001", projectName: `使い方の動画：${title}`,
    createdAt: now, updatedAt: now,
    videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: Math.min(300, Math.ceil(total)), maxDurationSec: Math.min(1800, Math.max(60, Math.ceil(total) + 10)) },
    voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
    assets, tracks, clips,
  };
  writeFileSync(join(out, "project.json"), JSON.stringify(doc, null, 2));
  console.log(`組みました: ${out}（${total.toFixed(1)} 秒・部品 ${clips.length}・声 ${lineSec.length}・止めたコマ ${still}）`);
}

function r3(x) {
  return Math.round(x * 1000) / 1000;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename ?? "")) await main();
