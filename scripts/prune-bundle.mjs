// 配布物の容量を削る（#1384）。配布ビルドの**前**に流す（手順は 配布手順.md）。
//
//   node scripts/prune-bundle.mjs           … 何を外すかを見せるだけ（既定）
//   node scripts/prune-bundle.mjs --apply   … 外す（消さずに src-tauri/pruned_resources/ へ移す＝同梱されない・戻せる）
//
// 外すもの（どれもアプリが使わない）：
//   - 読み上げの声のモデル（`.vvm`）のうち、アプリで選べる声を1つも含まないもの（歌声用を含む）
//   - キャラ情報の、残す声の**声の見本**と、残さないキャラのフォルダ（規約 `policy.md` は残すキャラぶん残る）
//   - FFmpeg の再生用プログラム（`ffplay.exe`）＝書き出しには使わない
// ⚠️ 声の番号は `src/domain/voice/voiceCatalog.ts` から読む（手で書かない）。どの声のモデルにも無い番号があれば止める。
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { planCharacterInfo, planVvm, readZipEntry, speakersFromMetas, usedSpeakerIds } from "./lib/pruneBundle.mjs";

const apply = process.argv.includes("--apply");
const RES = join("src-tauri", "resources");
const OUT = join("src-tauri", "pruned_resources");
const ENGINE = join(RES, "voicevox_engine");
const MODEL = join(ENGINE, "model");
const CHAR = join(ENGINE, "resources", "character_info");

const sizeOf = (p) => {
  if (!existsSync(p)) return 0;
  const st = statSync(p);
  if (!st.isDirectory()) return st.size;
  return readdirSync(p).reduce((a, n) => a + sizeOf(join(p, n)), 0);
};
const mb = (b) => `${(b / 1024 / 1024).toFixed(0)}MB`;

if (!existsSync(MODEL)) {
  console.log("読み上げエンジンが置かれていません（配布ビルドの準備前）。何もしません。");
  process.exit(0);
}

const used = usedSpeakerIds(readFileSync(join("src", "domain", "voice", "voiceCatalog.ts"), "utf8"));
const vvms = readdirSync(MODEL)
  .filter((f) => f.endsWith(".vvm"))
  .map((file) => {
    const metas = readZipEntry(readFileSync(join(MODEL, file)), "metas.json");
    if (!metas) throw new Error(`${file} に metas.json がありません`);
    return { file, speakers: speakersFromMetas(JSON.parse(metas.toString("utf8"))) };
  });
const plan = planVvm(vvms, used);
if (plan.missing.length > 0) {
  console.error(`✗ どの声のモデルにも無い声の番号があります: ${plan.missing.join(", ")}（削ると、その声が読めなくなります）。中止します。`);
  process.exit(1);
}
const charDirs = existsSync(CHAR) ? readdirSync(CHAR).filter((d) => statSync(join(CHAR, d)).isDirectory()) : [];
const targets = [
  ...plan.drop.map((f) => join(MODEL, f)),
  ...planCharacterInfo(charDirs, plan.keepUuids).map((d) => join(CHAR, ...d.split("/"))),
  join(RES, "ffmpeg", "bin", "ffplay.exe"),
].filter((p) => existsSync(p));

const total = targets.reduce((a, p) => a + sizeOf(p), 0);
console.log(`アプリで選べる声の番号: ${used.join(",")}`);
console.log(`残す声のモデル: ${plan.keep.join(", ")}`);
console.log(`外すもの: ${targets.length} 件・合計 ${mb(total)}`);
for (const p of targets) console.log(`  - ${p}（${mb(sizeOf(p))}）`);
if (!apply) {
  console.log("\n（見せるだけです。外すときは --apply を付けてください）");
  process.exit(0);
}
for (const p of targets) {
  const to = join(OUT, p.slice(RES.length + 1));
  mkdirSync(dirname(to), { recursive: true });
  renameSync(p, to);
}
console.log(`\n✓ ${targets.length} 件を ${OUT} へ移しました（同梱されません。戻すときはこのフォルダから元の場所へ戻してください）。`);
