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
    // ⚠️ `message` は**実際に入っている**（Node 22 の `WebSocket` は `ErrorEvent` を渡す＝実測で
    //   「Received network error or non-101 status code.」が取れた）。型の上では `Event` なので注記する。
    ws.addEventListener("error", (e) => reject(new Error(`WebSocket: ${/** @type {{ message?: string }} */ (e).message ?? "失敗"}`)));
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

/**
 * **画面の言葉で要素を探す**式（完全一致 → 部分一致）。
 *
 * ⚠️ **写して増やさない**（PR #1234 レビュー 🟡）＝`uiProbe`（押す）と `tutorialRecord`（位置を採る）が
 * **同じ探し方**を要る。別々に持つと、`[role=tab]` を足したときに**片方だけ黙って古くなる**
 *（このファイル自身がその再発を避けると書いている型）。
 * ⚠️ **見つけたら画面の真ん中へ寄せる**＝スクロールの外にあると、押せても**録画に写らない**。
 */
/**
 * **入力欄**を、ラベル（`aria-label` / `placeholder`）で探す（#1228）。
 *
 * ⚠️ **文字で探せない**＝入力欄は中身が空なので `FIND_BY_TEXT` では当たらない。
 * 教材では「実際に打っている所」を見せたいので、ここが要る。
 */
/**
 * 名前で欄を探す。
 *
 * ⚠️ **見出しの文字からも探す**（#1228・タイムライン編集で踏んだ）＝`aria-label` と
 * プレースホルダしか見ていなかったので、**`<label>開始（秒）</label>` の付いた数値欄が1つも見つからなかった**
 *（タイムライン編集の位置・長さはこの形）。画面で人が見ているのは**見出しの文字**なので、そこも見る。
 * ⚠️ **見えているものだけ**＝畳まれた欄を掴むと、押しても動かない映像になる。
 */
export const FIND_FIELD = (label) => `(() => {
  const want = ${JSON.stringify(label)};
  const all = [...document.querySelectorAll("input, textarea, [contenteditable=true]")]
    .filter((el) => el.offsetParent !== null);
  // その欄に付いている見出しの文字（for 属性と、包んでいる label の両方を見る）。
  const labelled = (el) => {
    const byFor = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null;
    const wrap = el.closest("label");
    return [byFor, wrap].filter(Boolean).map((l) => (l.textContent || "").trim()).join(" ");
  };
  const name = (el) => [(el.getAttribute("aria-label") || ""), (el.placeholder || ""), labelled(el)]
    .map((s) => s.trim()).filter(Boolean).join(" / ");
  const hit = all.find((el) => name(el) === want) || all.find((el) => name(el).includes(want));
  if (!hit) return null;
  hit.scrollIntoView({ block: "center" });
  return hit;
})()`;

/**
 * 名前で選択欄（`<select>`）を探す（タイムライン編集の上級の台本で要った＝動き方・重ね方・声）。
 * 名前の作り方は `FIND_FIELD` と同じ（`aria-label`・`label[for]`・包んでいる `label`）。
 * ⚠️ **見えているものだけ**＝畳まれた欄の選択を変えても、映像には何も写らない。
 */
export const FIND_SELECT = (label, nth = 1) => `(() => {
  const want = ${JSON.stringify(label)};
  const nth = ${JSON.stringify(nth)};
  const all = [...document.querySelectorAll("select")].filter((el) => el.offsetParent !== null);
  const labelled = (el) => {
    const byFor = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null;
    const wrap = el.closest("label");
    // 包んでいる label の文字には選択肢の文字も混ざるので、選択肢を除いた文字で比べる。
    const own = (l) => [...l.childNodes].filter((n) => n.nodeName !== "SELECT").map((n) => n.textContent || "").join("");
    return [byFor, wrap].filter(Boolean).map((l) => own(l).trim()).join(" ");
  };
  const name = (el) => [(el.getAttribute("aria-label") || ""), labelled(el)]
    .map((s) => s.trim()).filter(Boolean).join(" / ");
  // 同じ名前の欄が並ぶとき（キーフレームの行ごとの「ここまでの動き方」）は、何番目かで選ぶ（1始まり）。
  const exact = all.filter((el) => name(el) === want);
  const hit = (exact.length > 0 ? exact : all.filter((el) => name(el).includes(want)))[nth - 1];
  if (!hit) return null;
  hit.scrollIntoView({ block: "center" });
  return hit;
})()`;

/**
 * 選択欄の選択肢を**見えている文字で**選ぶ。選べたら選んだ文字、選べなければ null を返す。
 *
 * ⚠️ **選択肢の一覧は開かない**＝OS の一覧は別の窓に出るので録画に写らず、開いたまま残ると次の段を塞ぐ。
 *   人が選んだのと同じ結果になるよう、**React が受け取る道**（値の設定口＋`change`）で選ぶ。
 * ⚠️ **完全一致だけ**＝選択肢は短い言葉が多く（「一定」「ふつう」）、部分一致だと別の選択肢を選ぶ。
 */
export const CHOOSE_OPTION = (label, option, nth = 1) => `(() => {
  const el = ${FIND_SELECT(label, nth)};
  if (!el) return null;
  const want = ${JSON.stringify(option)};
  const opt = [...el.options].find((o) => (o.textContent || "").trim() === want);
  if (!opt) return null;
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  set.call(el, opt.value);
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return (el.options[el.selectedIndex]?.textContent || "").trim();
})()`;

export const FIND_BY_TEXT = (text) => `(() => {
  const want = ${JSON.stringify(text)};
  const all = [...document.querySelectorAll("button, a, [role=button], [role=menuitem], summary, label")];
  const hit = all.find((el) => (el.textContent || "").trim() === want)
    || all.find((el) => (el.textContent || "").includes(want));
  if (!hit) return null;
  hit.scrollIntoView({ block: "center" });
  return hit;
})()`;
