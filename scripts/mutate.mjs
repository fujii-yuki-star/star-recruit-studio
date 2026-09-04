#!/usr/bin/env node
// 変異チェックの実行係（#997 の残りを自動で回すための土台）。
//
// このリポジトリでは「新しく書いた検査は**壊して赤くなることを確かめる**」を規約にしているが、
// 実際の手順は毎回**手で**やっていた＝控えを取る → 書き換える → テストを回す → 戻す。
// そこで次の3つを繰り返し踏んだ：
//
// ⚠️ **戻し忘れ／戻し間違い**＝`cp` の控えが別の変更を巻き戻し、無関係な作業が消える。
// ⚠️ **当たっていない変異が「生き残った」に見える**＝書き換えの文字列がどこにも一致せず、
//   ファイルは無傷のままテストが緑になる。**変異が効いていないだけ**なのに「検査が弱い」と読める
//   （逆に「検査が強い」と誤読することもある）＝**いちばん質の悪い嘘**。
// ⚠️ **ベースラインが赤いまま回す**＝何を壊しても赤いので、全部「捕まえた」に見える。
//
// この実行係は、その3つを**構造で**防ぐ：
//   ①必ず戻す（正常・失敗・中断のどれでも `finally` と signal で戻す）
//   ②書き換えの文字列が**ちょうど1か所**に当たらなければ、その場で止める（当たり数も出す）
//   ③先にベースラインを回し、緑でなければ**1つも変異させずに**止める
//
// 使い方:
//   node scripts/mutate.mjs <spec.json>
//   node scripts/mutate.mjs --print-template
//
// spec の形:
//   {
//     "tests": ["src/domain/timeline/edit.test.ts"],   // vitest へ渡すパス（複数可）
//     "mutants": [
//       { "label": "まとめても1件目しか当てない", "file": "src/domain/timeline/edit.ts",
//         "find": "for (const id of clipIds) {", "replace": "for (const id of clipIds.slice(0, 1)) {" }
//     ]
//   }
//
// ⚠️ **`expect` の数ではなく「落ちたかどうか」で判定する**＝落ちた件数は検査の書き方で変わるので、
// 「1件でも落ちれば捕まえた」を基準にする。捕まえられなかった変異は**生き残り**として並べる。
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import process from "node:process";

const TEMPLATE = {
  tests: ["src/path/to/target.test.ts"],
  mutants: [
    {
      label: "何を壊したか（日本語で・レビューにそのまま貼れる粒度）",
      file: "src/path/to/target.ts",
      find: "壊す前の文字列（ちょうど1か所に当たること）",
      replace: "壊した後の文字列",
    },
  ],
};

/** vitest を回して「緑だったか」を返す。⚠️ **出力をパイプで潰さない**（終了コードで見る）。 */
function runTests(tests) {
  // ⚠️ **Windows では shell 経由で呼ぶ**＝`npx` の実体は `.cmd` なので `shell:false` では起動に失敗し、
  // **テストが赤いのではなく「そもそも回っていない」**のに赤と読める（自分で踏んだ）。
  const r = spawnSync("npx", ["vitest", "run", ...tests], {
    encoding: "utf8",
    shell: true,
    windowsHide: true,
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const line =
    out
      .split("\n")
      .map((l) => l.replace(/\u001b\[[0-9;]*m/g, ""))
      .find((l) => /^\s*Tests\s/.test(l))
      ?.trim() ?? "(件数の行が取れなかった)";
  return { green: r.status === 0, line, out };
}

/** その場で止める（何も書き換えていない状態で）。 */
function abort(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

/**
 * 書き換える前の中身をディスクにも控える場所（PR #1018 レビュー 🔴）。
 *
 * ⚠️ **`spawnSync` の最中は signal のハンドラが走らない**（Node のイベントループが止まる）。
 * Ctrl+C は子まで届いて道連れになるので大抵は助かるが、**Node の PID だけへ `kill`** が来ると
 * ハンドラは発火せず、**書き換わったまま**止まる。メモリの控えは道連れで消えるので、
 * **ディスクにも置く**＝次の起動が気づいて戻せる（`--restore`）。
 */
const RECOVERY_PATH = join(tmpdir(), "stario-mutate-recovery.json");

/** 控えをディスクへ置く（失敗しても本編は止めない＝保険なので）。 */
function writeRecovery(map) {
  try {
    mkdirSync(dirname(RECOVERY_PATH), { recursive: true });
    writeFileSync(RECOVERY_PATH, JSON.stringify(Object.fromEntries(map), null, 2));
  } catch {
    /* 置けなくても、メモリの控えと `finally` は効く */
  }
}

/** 前回落ちた分を戻す（`--restore`）。 */
function restoreFromDisk() {
  if (!existsSync(RECOVERY_PATH)) {
    console.log("戻すものはありません（控えが残っていません）。");
    return 0;
  }
  const saved = JSON.parse(readFileSync(RECOVERY_PATH, "utf8"));
  const failed = [];
  for (const [file, text] of Object.entries(saved)) {
    try {
      writeFileSync(file, text);
      console.log(`  戻しました: ${file}`);
    } catch (e) {
      failed.push(`${file}（${e.message}）`);
    }
  }
  if (failed.length > 0) {
    console.error("✖ 戻せなかったもの:");
    for (const f of failed) console.error(`   - ${f}`);
    console.error("  `git checkout -- <上のファイル>` で戻してください。");
    return 1;
  }
  rmSync(RECOVERY_PATH, { force: true });
  return 0;
}

const arg = process.argv[2];
if (arg === "--restore") process.exit(restoreFromDisk());

if (!arg || arg === "--help" || arg === "-h") {
  console.log("使い方: node scripts/mutate.mjs <spec.json>   （雛形: --print-template）");
  process.exit(arg ? 0 : 1);
}
if (arg === "--print-template") {
  console.log(JSON.stringify(TEMPLATE, null, 2));
  process.exit(0);
}

let spec;
try {
  spec = JSON.parse(readFileSync(arg, "utf8"));
} catch (e) {
  abort(`spec を読めませんでした（${arg}）: ${e.message}`);
}
if (!Array.isArray(spec.tests) || spec.tests.length === 0) abort("spec の `tests` が空です。");
if (!Array.isArray(spec.mutants) || spec.mutants.length === 0) abort("spec の `mutants` が空です。");

// ── ③ 先にベースライン（赤いまま変異させない） ───────────────────────────
// ⚠️ **前回落ちた控えが残っていたら、先に言う**＝そのまま回すと、
// **書き換わったファイルをベースラインとして測る**ことになる（緑でも赤でも意味が無い）。
if (existsSync(RECOVERY_PATH)) {
  abort(
    `前回の変異チェックが**戻さずに終わっています**（控え: ${RECOVERY_PATH}）。
` +
      "  そのまま回すと、書き換わったファイルをベースラインとして測ることになります。\n" +
      "  先に戻してください:  node scripts/mutate.mjs --restore",
  );
}
console.log(`◆ ベースライン: ${spec.tests.join(" ")}`);
const base = runTests(spec.tests);
console.log(`  ${base.line}`);
if (!base.green) {
  console.error(base.out.split("\n").slice(-40).join("\n"));
  abort("ベースラインが赤いままです。**1つも変異させていません**（赤い状態で回すと、何を壊しても赤いので全部『捕まえた』に見えます）。");
}

// ── ② 先に全部の変異が「ちょうど1か所」に当たるか確かめる（1つでも外れたら止める）──
const originals = new Map();
for (const m of spec.mutants) {
  if (!m.file || typeof m.find !== "string" || typeof m.replace !== "string") {
    abort(`変異の形が足りません（label=${m.label ?? "(名前なし)"}）＝file / find / replace が要ります。`);
  }
  if (!originals.has(m.file)) originals.set(m.file, readFileSync(m.file, "utf8"));
  const hits = originals.get(m.file).split(m.find).length - 1;
  if (hits !== 1) {
    abort(
      `「${m.label ?? m.find.slice(0, 30)}」の書き換え先が ${hits} か所です（1か所でないと止めます）。\n` +
        `  file: ${m.file}\n  find: ${JSON.stringify(m.find.slice(0, 120))}\n` +
        `  ⚠️ 0 か所なら**変異が当たらずファイルは無傷**＝緑になっても「検査が強い」証拠にはなりません。\n` +
        `  ⚠️ 2 か所以上なら**意図しない所まで壊す**＝落ちた理由が読めません。`,
    );
  }
}

// ⚠️ **戻せなかったことを黙って終わらない**（PR #1018 レビュー 🔴）＝もとは書き戻しを
// **無条件**に呼んでいたので、途中の1件が失敗（空き容量・権限・ロック）すると
// **例外がそのまま外へ出て、残りのファイルは書き換わったまま**止まっていた。
// しかも**どれが戻らなかったかも出ない**。1件ずつ受け止めて、**次の行動**まで出す（§2-5）。
let restored = false;
const restoreAll = () => {
  if (restored) return;
  restored = true;
  const failed = [];
  for (const [file, text] of originals) {
    try {
      writeFileSync(file, text);
    } catch (e) {
      failed.push(`${file}（${e.message}）`);
    }
  }
  if (failed.length > 0) {
    console.error("\n✖ 書き換えたファイルを戻せませんでした:");
    for (const f of failed) console.error(`   - ${f}`);
    console.error("\n  次のどちらかで戻してください:");
    console.error("    git checkout -- <上のファイル>");
    console.error(`    node scripts/mutate.mjs --restore`);
    return;
  }
  // ⚠️ **戻し終えたら控えを片づける**＝残すと、次の起動が「前回落ちた」と誤って言う。
  try {
    rmSync(RECOVERY_PATH, { force: true });
  } catch {
    /* 片づけに失敗しても、戻し自体は済んでいる */
  }
};
// ⚠️ **`spawnSync` の最中は signal のハンドラが走らない**（PR #1018 レビュー 🔴）＝
// テストを回している間は Node のイベントループが止まっているので、`kill` を受けても
// **ハンドラは `spawnSync` が返るまで発火しない**（Ctrl+C は子まで届いて道連れになるので
// 大抵は助かるが、Node の PID だけへ送られると**戻らないまま止まる**）。
// そこで**控えをディスクにも置く**＝落ちても、次の起動が気づいて戻せる（`--restore`）。
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    restoreAll();
    console.error("\n（中断されたので、書き換えたファイルは戻しました）");
    process.exit(130);
  });
}

writeRecovery(originals);

const survived = [];
try {
  for (const [i, m] of spec.mutants.entries()) {
    const label = m.label ?? m.find.slice(0, 30);
    const before = originals.get(m.file);
    // ⚠️ **置換の文字列を「そのまま」書く**（PR #1018 レビュー 🟡）＝`String.replace` は
    // 検索が文字列でも、**置換側の `$&` `$$` `` $` `` `$'` を特殊な意味に解釈する**。
    // TS/JSX には `$` がよく出るので、関数形にしないと**気づかれずに違う変異**が走る。
    writeFileSync(m.file, before.replace(m.find, () => m.replace));
    const r = runTests(spec.tests);
    writeFileSync(m.file, before); // 次の変異と混ざらないよう、1つずつ戻す
    const mark = r.green ? "✖ 生き残り" : "✓ 捕まえた";
    console.log(`${mark}  [${i + 1}/${spec.mutants.length}] ${label}\n           ${r.line}`);
    if (r.green) survived.push(label);
  }
} finally {
  restoreAll();
}

console.log("");
if (survived.length > 0) {
  console.error(`✖ 生き残った変異が ${survived.length} 件あります（その振る舞いは検査していません）:`);
  for (const s of survived) console.error(`   - ${s}`);
  console.error("\n  検査を足すか、**同じ結果になる変異（等価）である理由**を書いてください。");
  process.exit(1);
}
console.log(`✓ ${spec.mutants.length} 件すべて捕まえました（ベースラインは緑）。`);
