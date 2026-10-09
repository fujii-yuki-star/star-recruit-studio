// アプリが最後に送った依頼（記録の置き場の `ai_last_request.json`）を、そのまま何回も送り直す（#1403 の続き）。
//
// ⚠️ **似せた入力ではなく、アプリが送った依頼そのもの**を使う＝2026-10-09、似せた入力では 5 回とも成功したのに、
//   アプリでは失敗し続けた。原因は送った**縛りの形の項目の順番**（Rust の `serde_json` が並び替えていた）で、
//   似せた入力では再現しようが無かった。
//
// 使い方: 先に llama-server を起動しておき（例: -m <GGUF> --host 127.0.0.1 --port 18081 -c 8192）、
//   node scripts/local-llm/replay-request.mjs http://127.0.0.1:18081 <ai_last_request.json> <出力フォルダ> [回数] [出力の上限]
// 出力の上限（既定 1600）で止まった回は「止まらなかった」と数える（ふつうの案は 700〜1100 トークン）。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";

const [base, reqPath, outDir, trialsArg = "6", capArg = "1600"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const req = JSON.parse(readFileSync(reqPath, "utf8"));

// ⚠️ `fetch` は応答の頭を 5 分で打ち切る＝止まらない回で道具のほうが落ちる。素の http で待つ。
const post = (url, body) =>
  new Promise((resolve, reject) => {
    const u = new URL(url);
    const q = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: "POST", headers: { "Content-Type": "application/json" } },
      (r) => {
        let d = "";
        r.setEncoding("utf8");
        r.on("data", (c) => (d += c));
        r.on("end", () => resolve(JSON.parse(d)));
      },
    );
    q.on("error", reject);
    q.end(JSON.stringify(body));
  });

const rows = [];
for (let i = 0; i < Number(trialsArg); i += 1) {
  const body = { ...req, stream: false, seed: 2000 + i, max_tokens: Number(capArg) };
  const t0 = Date.now();
  const j = await post(`${base}/v1/chat/completions`, body);
  const content = j.choices?.[0]?.message?.content ?? "";
  writeFileSync(`${outDir}/${i}.json`, content);
  let scenes = [];
  let valid = true;
  try {
    scenes = JSON.parse(content).parts.flatMap((p) => p.scenes);
  } catch {
    valid = false;
  }
  const silent = scenes.filter(
    (s) => !(s.narrationText ?? "").trim() && !(s.narrationLines ?? []).some((l) => (l.text ?? "").trim()),
  ).length;
  const row = {
    trial: i, sec: Math.round((Date.now() - t0) / 1000), finish: j.choices?.[0]?.finish_reason, tokens: j.timings?.predicted_n,
    valid, scenes: scenes.length, totalSec: scenes.reduce((s, x) => s + (x.durationSec ?? 0), 0), silent,
  };
  rows.push(row);
  console.log(JSON.stringify(row));
}
writeFileSync(`${outDir}/summary.json`, JSON.stringify(rows, null, 2));
