// 画面側が呼ぶ Rust の口（`invoke('名前')`）が、Rust 側に**登録されている**（#1255 レビュー）。**構造で留める**。
//
// ⚠️ **なぜ要るか**＝`invoke` は名前の文字列で呼ぶので、**登録し忘れても型でも検査でも落ちない**。
// 実行してはじめて「そんな口は無い」で失敗する。しかも**失敗を握りつぶす呼び方**（止める操作など、
// 失敗しても画面を壊したくない所）だと、**何も起きないまま黙って効かなくなる**。
// ⚠️ **実際に危なかった**＝動画案づくりを止める口（`cancel_ai_generate`）は失敗を握りつぶすので、
// 登録を忘れると「キャンセルしたのに外へ送り続ける」が**無言で戻る**。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const LIB = "src-tauri/src/lib.rs";
const TS_ROOT = "src";

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** 画面側が呼んでいる口の名前（`invoke('x')` / `invoke<T>('x')` / 二重引用符も）。 */
function invokedNames(): Set<string> {
  const names = new Set<string>();
  const re = /\binvoke(?:<[^>]*>)?\(\s*['"]([a-z_][a-z0-9_]*)['"]/g;
  for (const f of tsFiles(TS_ROOT)) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(re)) names.add(m[1]);
  }
  return names;
}

/** Rust に登録されている口の名前（`generate_handler![ ... ]` の中の、最後の区切り）。 */
function registeredNames(): Set<string> {
  const src = readFileSync(LIB, "utf8");
  const start = src.indexOf("generate_handler![");
  const end = src.indexOf("]", start);
  const body = src.slice(start + "generate_handler![".length, end);
  const names = new Set<string>();
  for (const raw of body.split(",")) {
    const item = raw.replace(/\/\/.*$/gm, "").trim();
    if (!item) continue;
    names.add(item.split("::").pop()!.trim());
  }
  return names;
}

describe("画面側が呼ぶ Rust の口は、登録されている", () => {
  // ⚠️ **走査そのものを検査する**＝拾えていないのに緑、を防ぐ（門番が「見えていないのに緑」になる型）。
  it("両側とも拾えている（数を実数で留める）", () => {
    // ⚠️ **+2**（ADR-0051）＝`local_ai_available`・`local_ai_generate`。**+1**（ADR-0052 決定4）＝`local_ai_describe_image`。**+1**（ADR-0052 決定6）＝`local_ai_prepare`。
    // ⚠️ **+1**（ADR-0053）＝`local_ai_assist`（編集の途中の手伝い）。
    // ⚠️ **+3**（ADR-0058）＝transcribe_available／transcribe_audio／transcribe_cancel。
    expect(registeredNames().size, "Rust に登録された口の数が変わった（足したら数も直す）").toBe(88);
    expect(invokedNames().size, "画面側が呼ぶ口の数が変わった（足したら数も直す）").toBeGreaterThanOrEqual(70);
  });

  it("呼んでいる口は、すべて登録されている", () => {
    const registered = registeredNames();
    const missing = [...invokedNames()].filter((n) => !registered.has(n)).sort();
    expect(missing.join(", "), "登録されていない口を呼んでいる＝実行すると失敗する（握りつぶす呼び方だと黙って効かない）").toBe("");
  });

  // ⚠️ **止める口は名指しで見る**＝失敗を握りつぶすので、ここが抜けると**無言で**止まらなくなる。
  it("動画案づくりを止める口が登録されている", () => {
    expect(registeredNames().has("cancel_ai_generate")).toBe(true);
    expect(invokedNames().has("cancel_ai_generate")).toBe(true);
  });
});

// ⚠️ **知らせの名前も両側で揃える**（#1255 レビュー ℹ️）＝`emit`（Rust）と `listen`（画面）は
// 名前の文字列で結ばれているだけなので、片方だけ変えると**知らせが届かなくなる**（何も落ちない）。
describe("混み合っているときの知らせの名前は、両側で同じ", () => {
  it("Rust が出す名前を、画面が受けている", () => {
    const rust = readFileSync("src-tauri/src/ai.rs", "utf8");
    const ts = readFileSync("src/infrastructure/aiClient.ts", "utf8");
    const emitted = rust.match(/app\.emit\(\s*"([a-z-]+)"/)?.[1];
    expect(emitted, "Rust 側で知らせの名前を拾えない").toBeTruthy();
    expect(ts.includes(`listen<AiBusyWait>('${emitted}'`), `画面側が「${emitted}」を受けていない`).toBe(true);
  });
});
