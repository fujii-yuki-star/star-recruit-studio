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

/**
 * 録った**記録**を確かめる（焼く側の入口）。
 *
 * ⚠️ **録る側にだけ門番があった**（PR #1237 再レビュー ℹ️）＝台本は `checkPlan` が見るのに、
 * **記録は素通し**だった。`totalSec` が無いだけで `-t undefined` になり、`stillTimes` の中では
 * `NaN` の比較が**すべて false** になって窓が捨てられず、**ffmpeg のエラー文**で落ちる
 *＝原因が読めない（この道具が潰そうとしている「黙って別のことをする」と同じ型）。
 */
export function checkRecordLog(log) {
  if (log == null || typeof log !== "object") throw new Error("記録が読めません（JSON ではありません）");
  for (const key of ["video", "view", "totalSec", "fps", "steps"]) {
    if (log[key] == null) throw new Error(`記録に \`${key}\` がありません＝#1226 の新しい版で録り直してください`);
  }
  if (!Number.isFinite(log.totalSec) || log.totalSec <= 0) {
    throw new Error(`記録の \`totalSec\` が秒になっていません: ${JSON.stringify(log.totalSec)}`);
  }
  // ⚠️ **コマ数も要る**＝焼く側が**コマ境界へ丸めて**切るのに使う（端数のまま切ると時間軸が1コマずれる）。
  if (!Number.isFinite(log.fps) || log.fps <= 0) {
    throw new Error(`記録の \`fps\` がコマ数になっていません: ${JSON.stringify(log.fps)}`);
  }
  for (const key of ["offsetX", "offsetY", "dpr", "width", "height"]) {
    if (!Number.isFinite(log.view[key])) throw new Error(`記録の \`view.${key}\` が数ではありません＝録り直してください`);
  }
  // ⚠️ **隣の欄も見る**（PR #1237 3回目 🟡）＝`usableFromSec` は任意（#1226 の旧記録には無い）だが、
  //   **壊れて入っている**と `totalSec - NaN` が `NaN` になり、`totalSec <= 0` は
  //   **NaN 比較なので false** で素通りする＝この関数を作った当の理由（上の説明）と同じ穴。
  if (log.usableFromSec != null) {
    if (!Number.isFinite(log.usableFromSec) || log.usableFromSec < 0 || log.usableFromSec >= log.totalSec) {
      throw new Error(`記録の \`usableFromSec\` が秒になっていません: ${JSON.stringify(log.usableFromSec)}＝録り直してください`);
    }
  }
  if (!Array.isArray(log.steps) || log.steps.length === 0) throw new Error("記録に押した段が1つもありません");
  log.steps.forEach((step, i) => {
    for (const key of ["atSec", "x", "y"]) {
      if (!Number.isFinite(step?.[key])) throw new Error(`${i + 1} 段目の \`${key}\` が数ではありません: ${JSON.stringify(step)}`);
    }
    if (step.atSec > log.totalSec) throw new Error(`${i + 1} 段目が録画の外にあります（${step.atSec}s / 全体 ${log.totalSec}s）`);
  });
  return log;
}
