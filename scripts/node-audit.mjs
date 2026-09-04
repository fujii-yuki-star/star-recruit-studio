#!/usr/bin/env node
// 依存の脆弱性チェック（CI の "Node Audit (High)"）。
//
// ⚠️ **落ちた理由が「脆弱性が見つかった」でない落ち方をしていた**（#1038）＝`npm audit` は
// **レジストリのエンドポイントがエラーを返したときも** exit 1 になる（1日で 503 Service Unavailable と
// 400 Bad Request の両方を観測）。門番として嘘をつくうえ、「とりあえず再実行する」が習慣になり、
// **本当に脆弱性が出たときも同じ反応をしてしまう**（門番の信用が落ちる）。
//
// ⚠️ **門番は緩めない**＝high / critical が1件でもあれば**落ちる**のは変えない。変えたのは
// 「**エンドポイントのエラーと、脆弱性ありを区別する**」ところだけ。エンドポイントが最後まで
// 応答しなければ、**確認できていないので落とす**（黙って通さない・§2-5）。
//
// ⚠️ **`jq` ではなく Node で書く**＝この job には既に Node があり、**手元で同じものを走らせて
// 確かめられる**（`jq` は手元に無く、無いと `jq -e` が失敗して「エンドポイントのエラー」に
// 化けるので、検査したつもりで何も見ていない状態になる）。
import { spawnSync } from "node:child_process";
import process from "node:process";

/** 落とす重大度（`--audit-level=high` と同じ範囲）。 */
const BLOCKING = ["high", "critical"];
const ATTEMPTS = 3;
const RETRY_MS = 20_000;

/** `npm audit --json` を1回走らせ、**読めた集計**か「読めなかった」を返す。 */
export function readAudit(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { ok: false, reason: "応答が JSON ではありません" };
  }
  // ⚠️ **`metadata` の有無で見分ける**＝エンドポイントのエラーは `error` だけを返す。
  if (!parsed || typeof parsed !== "object" || !parsed.metadata?.vulnerabilities) {
    return { ok: false, reason: parsed?.error?.summary ?? "集計が入っていません" };
  }
  const counts = parsed.metadata.vulnerabilities;
  const blocking = BLOCKING.reduce((n, k) => n + (counts[k] ?? 0), 0);
  const names = Object.entries(parsed.vulnerabilities ?? {})
    .filter(([, v]) => BLOCKING.includes(v?.severity))
    .map(([name, v]) => `${v.severity}: ${name}`);
  return { ok: true, blocking, names };
}

function runOnce() {
  // ⚠️ **`--audit-level` は渡さない**（PR #1039 レビュー）＝あれは**終了コード**にしか効かず、
  // ここは終了コードを見ない（`BLOCKING` が本体）＝残すと「変えれば挙動が変わる」と誤読される。
  // ⚠️ **受け皿を広く取る**（同レビュー）＝既定の約 1MB を超えると `stdout` が切り詰められ、
  // **無関係な理由で「読めなかった」**になる（fail-closed なので緩みはしないが、赤くなる）。
  const r = spawnSync("npm", ["audit", "--json"], {
    encoding: "utf8",
    shell: true,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  return readAudit(r.stdout ?? "");
}

async function main() {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const result = runOnce();
    if (result.ok) {
      console.log(`high+critical: ${result.blocking}`);
      if (result.blocking > 0) {
        for (const n of result.names) console.log(`  ${n}`);
        console.log(`::error::high 以上の脆弱性が ${result.blocking} 件あります。上の一覧を確認してください。`);
        process.exit(1);
      }
      process.exit(0);
    }
    console.log(`npm audit のエンドポイントがエラーを返しました（${attempt} 回目）: ${result.reason}`);
    if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, RETRY_MS));
  }
  // ⚠️ **次の行動を書く**（PR #1039 レビュー）＝CI のログは §2-5 の対象外だが、
  // 「どうすればいいか」が無いと**とりあえず再実行する**しかなくなる（それが #1038 の元の症状）。
  console.log(
    `::error::npm audit のエンドポイントが ${ATTEMPTS} 回とも応答しませんでした。脆弱性の有無を確認できていないため、通しません。` +
      "しばらく置いてからこの job だけ再実行するか、https://status.npmjs.org でレジストリの状態を確認してください。",
  );
  process.exit(1);
}

// 検査から読み込むときは走らせない（`readAudit` だけを使う）。
if (process.argv[1]?.endsWith("node-audit.mjs")) await main();
