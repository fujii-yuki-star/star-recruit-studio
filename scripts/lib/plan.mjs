// 撮影の**引数**と**台本**の読み取り（#1226・PR #1234 レビュー 🟡）。**純粋関数**。
//
// ⚠️ **切り出した理由**＝この2つは「**黙って別のことをする**」形の穴だった。
//  - `--out` が無いときに**第2引数を出力先にしていた**（`… plan.json --dry` が `--dry` フォルダを作る）
//  - 台本の**知らない段を黙って飛ばしていた**（`clickText` の打ち間違いが無言で消え、短い録画に `✓` が出る）
// 走らせる所に置いたままだと**検査から叩けない**（`tutorialRecord.mjs` は ffmpeg とアプリを起こす）。

/** 出力先（`--out`）。⚠️ **知らない印は断る**＝黙って別の所へ書かない。 */
export function parseOutDir(rest, fallback = "tutorial-out") {
  const at = rest.indexOf("--out");
  // ⚠️ **印は1か所で決める**＝走らせる側で増やしても、ここが知らなければ断られる（実際に踏んだ）。
  const known = new Set(["--out", "--attach", "--下見"]);
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
    if (step.waitMs == null && step.clickText == null && step.fieldLabel == null && step.selectLabel == null) {
      throw new Error(`${i + 1} 段目に \`clickText\` も \`fieldLabel\` も \`selectLabel\` も \`waitMs\` もありません: ${JSON.stringify(step)}`);
    }
    // ⚠️ **選ぶ段は、選ぶ欄と選択肢の両方が要る**＝どちらかだけだと黙って何も選ばない。
    if (step.selectLabel != null && typeof step.option !== "string") {
      throw new Error(`${i + 1} 段目に \`option\`（選ぶ選択肢の文字）がありません: ${JSON.stringify(step)}`);
    }
    if (step.option != null && step.selectLabel == null) {
      throw new Error(`${i + 1} 段目に \`selectLabel\`（どの選択欄か）がありません: ${JSON.stringify(step)}`);
    }
    // 何番目の選択欄か（同じ名前が並ぶとき）。選ぶ段にだけ意味がある・1以上の整数。
    if (step.nth != null && (step.selectLabel == null || !Number.isInteger(step.nth) || step.nth < 1)) {
      throw new Error(`${i + 1} 段目の \`nth\` は選ぶ段（\`selectLabel\`）に 1 以上の整数で書きます: ${JSON.stringify(step)}`);
    }
    // 絵の変化が小さい段（撮った後の「絵が動いたか」の検査を外す）。⚠️ **理由の文を必須にする**＝
    //   `true` だけで外せると、壊れた段を黙らせる近道になる。
    if (step.quietChange != null && (typeof step.quietChange !== "string" || step.quietChange.trim() === "")) {
      throw new Error(`${i + 1} 段目の \`quietChange\` には、絵の変化が小さい理由を文で書きます: ${JSON.stringify(step)}`);
    }
    // ⚠️ **1段に1つの操作**＝押す・打つ・選ぶを1段に混ぜると、どれが効いたか分からない。
    if ([step.clickText, step.fieldLabel, step.selectLabel].filter((v) => v != null).length > 1) {
      throw new Error(`${i + 1} 段目に押す・打つ・選ぶが2つ以上あります（1段に1つ）: ${JSON.stringify(step)}`);
    }
    // ⚠️ **打つ段は、打つ先と中身の両方が要る**（#1228）＝どちらかだけだと**黙って何も打たない**。
    if (step.fieldLabel != null && typeof step.type !== "string") {
      throw new Error(`${i + 1} 段目に \`type\`（打つ文字）がありません: ${JSON.stringify(step)}`);
    }
    if (step.type != null && step.fieldLabel == null) {
      throw new Error(`${i + 1} 段目に \`fieldLabel\`（どの欄に打つか）がありません: ${JSON.stringify(step)}`);
    }
    // ⚠️ **確定のキーは打つ段にしか意味が無い**（#1228）＝押す段に書いても何も起きないので、
    //   気づかないまま「確定したつもり」の台本になる。
    if (step.enter != null && step.fieldLabel == null) {
      throw new Error(`${i + 1} 段目の \`enter\` は打つ段（\`fieldLabel\`）にだけ書けます: ${JSON.stringify(step)}`);
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
  for (const key of ["offsetX", "offsetY", "scale", "width", "height"]) {
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

/**
 * 撮った後の「押したのに絵が動いていない」検査に掛ける段か（記録の1段から決める）。
 * - 打つ段・選ぶ段（`typed` あり）は掛けない＝入った値をその場で照合してあるほうが強い証拠
 * - 画面の文字が変わった段は掛けない＝再生の直後など、縮めたコマ比べでは見えない変化がある
 * - 台本が理由つきで「変化が小さい」と書いた段（`quiet`）は掛けない＝理由の無い除外は `checkPlan` が断る
 */
export function needsMotionCheck(step) {
  if (step.typed != null) return false;
  if (step.textChanged) return false;
  if (typeof step.quiet === "string" && step.quiet.trim() !== "") return false;
  return true;
}
