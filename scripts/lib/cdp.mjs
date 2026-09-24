// DevTools プロトコル（CDP）の配線。**2つの道具が共有する**。
//
// ⚠️ **写して増やさない**（`CLAUDE.md` §2-7）＝使う側は2つある。
//  - `scripts/uiProbe.mjs`（#1104）＝**ブラウザ**を測る（jsdom はレイアウトを計算しないため）
//  - `scripts/tutorialRecord.mjs`（#1226・ADR-0046）＝**packaged のアプリ**を操作して録る
// 別々に書くと、片方だけ直したときに**もう片方は黙って古いまま**になる（このリポジトリで繰り返している型）。
//
// ⚠️ **依存を増やさない**＝Node 22 の組み込み `WebSocket` で直に叩く（Playwright 等は入れない）。

/**
 * DevTools が起きるまで待ち、ページの接続先を返す。
 *
 * ⚠️ **起動直後は繋がらない**＝待たずに繋ぐと「DevTools に繋がりません」で落ちる。
 */
export async function waitForTarget(port, timeoutMs = 20000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // まだ起きていない
    }
    if (Date.now() > until) throw new Error("DevTools に繋がりません");
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** CDP の呼び出しを1本の口にまとめる（id の対応づけを1か所に置く）。 */
export function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const waiting = new Map();
  let nextId = 1;
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", (e) => reject(new Error(`WebSocket: ${e.message ?? "失敗"}`)));
  });
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    const pending = waiting.get(msg.id);
    if (!pending) return;
    waiting.delete(msg.id);
    if (msg.error) pending.reject(new Error(`${msg.error.message}`));
    else pending.resolve(msg.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { ready, send, close: () => ws.close() };
}

/** ページの中で式を評価して、値をそのまま返す。 */
export async function evaluate(cdp, expression) {
  const r = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) {
    // ⚠️ **中身まで出す**＝`text` は "Uncaught" だけのことがあり、それだけでは直せない（実際に踏んだ）。
    const d = r.exceptionDetails;
    const detail = d.exception?.description ?? d.exception?.value ?? d.text ?? "（詳細なし）";
    const at = d.lineNumber != null ? `（${d.lineNumber}行目 ${d.columnNumber ?? "?"}列）` : "";
    throw new Error(`ページの中で失敗${at}: ${detail}`);
  }
  return r.result.value;
}
