// 撮影の**引数**と**台本**の読み取り（#1226・PR #1234 レビュー 🟡）。**純粋関数**。
//
// ⚠️ **切り出した理由**＝この2つは「**黙って別のことをする**」形の穴だった。
//  - `--out` が無いときに**第2引数を出力先にしていた**（`… plan.json --dry` が `--dry` フォルダを作る）
//  - 台本の**知らない段を黙って飛ばしていた**（`clickText` の打ち間違いが無言で消え、短い録画に `✓` が出る）
// 走らせる所に置いたままだと**検査から叩けない**（`tutorialRecord.mjs` は ffmpeg とアプリを起こす）。

/** 出力先（`--out`）。⚠️ **知らない印は断る**＝黙って別の所へ書かない。 */
export function parseOutDir(rest, fallback = "tutorial-out") {
  const at = rest.indexOf("--out");
  const known = new Set(["--out"]);
  const stray = rest.filter((a, i) => a.startsWith("--") && !known.has(a) && !(at >= 0 && i === at + 1));
  if (stray.length > 0) throw new Error(`知らない印です: ${stray.join(" ")}`);
  if (at >= 0 && rest[at + 1] == null) throw new Error("`--out` のあとに出力フォルダがありません");
  return at >= 0 ? rest[at + 1] : fallback;
}

/**
 * 台本の段を確かめる。
 *
 * ⚠️ **知らない段を黙って飛ばさない**＝打ち間違いが**無言で消えて、短いままの録画に `✓` が出る**
 *＝この道具が潰そうとしている「嘘の教材」と同じ型。
 */
export function checkPlan(plan) {
  if (!Array.isArray(plan?.steps)) throw new Error("台本に `steps`（配列）がありません");
  if (plan.steps.length === 0) throw new Error("台本に段が1つもありません");
  plan.steps.forEach((step, i) => {
    if (step == null || typeof step !== "object") throw new Error(`${i + 1} 段目が空です`);
    if (step.waitMs == null && step.clickText == null) {
      throw new Error(`${i + 1} 段目に \`clickText\` も \`waitMs\` もありません: ${JSON.stringify(step)}`);
    }
    if (step.waitMs != null && !Number.isFinite(step.waitMs)) {
      throw new Error(`${i + 1} 段目の \`waitMs\` が数ではありません: ${JSON.stringify(step.waitMs)}`);
    }
  });
  return plan;
}
