// 画面が**生の断りをそのまま出す**道が残っていないことの門番（#1123）。
//
// ⚠️ **正典はすでに禁じていた**（`15 §6` の `RESTORE_WRITE_FAILED` の行）＝
// 「生の OS エラーを出さない＝包まないと `os error 3` が利用者に見える（§2-3）」。
// ところが**それを見る側が居なかった**＝#1111 の門番（`rustUserMessageGuard`）は
// 「日本語で書かれ、句点を持つ文」しか拾わないので、`map_err(|e| e.to_string())`（**56 か所**）が
// 返す中身は**構造的に射程外**だった。
//
// ⚠️ **両端で正反対のことをしていた**＝一方は `.catch(() => …)` で**中身を全部捨て**（原因を3つに
// 書き分けても画面では1文に潰れる＝#1118）、もう一方は `e.message` を**無条件で出して**いた。
// どちらも「**この文は画面に出してよいか**」を見ていない。関門は `src/app/userFacingError.ts`。
//
// ⚠️ **`src/app` だけを見る**（§4）＝`infrastructure` が返す文字列は**データ**で、
// 画面の規則を持たない。出す所（`src/app`）が関門を通す（`readingDictSync.ts` の注記）。
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/** 関門を置いてある file（ここだけは物差しそのものを書く）。 */
const GATE = "src/app/userFacingError.ts";

/**
 * その file で**捕まえている断りの名前**（`catch (e)` と `.catch((e: unknown) => …)` の両方）。
 *
 * ⚠️ **名前を決め打ちしない**（`e` / `err` だけを見る等）＝`catch (problem)` と書かれた瞬間に
 * 黙って素通りする。**捕まえた所から名前を取る**ので、どう名付けても効く。
 */
export function caughtNames(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(/catch\s*\(\s*\(?\s*([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  // ⚠️ **1回だけ別名へ移した形も追う**（PR #1130 レビュー由来 🟡）＝
  // `catch (e) { const msg = e; return typeof msg === "string" ? msg : DEF; }` は、
  // 捕まえた名前だけを見ていると**素通り**する。移した先も「捕まえた断り」として扱う。
  // ⚠️ **追うのは1回だけ**＝何段でも追うと、無関係な代入まで巻き込んで誤検出になる。
  for (const name of [...out]) {
    const re = new RegExp(String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*${name}\s*;`, "g");
    for (const m of src.matchAll(re)) out.add(m[1]);
  }
  return [...out].sort();
}

/**
 * **捕まえた断りの中身を、見ずに通している**書き方を拾う。
 *
 * ⚠️ **拾い方を純粋関数にする**（`CLAUDE.md §7`）＝歩く形だけだと、拾い方を消しても
 * 「いまのコードに漏れが無いので緑」になる（#981 で踏んだ）。
 *
 * ⚠️ **`.message` を丸ごと禁じない**＝`ProjectLoadError` のように**画面向けに整えた文**を持つ
 * 例外があり、それは出してよい（誤検出は門番の信用を落とす）。ここで断つのは
 * 「**型を確かめただけで中身を確かめずに通す**」2つの形だけ。
 *
 * ⚠️ **断り以外の型の見分けまで拾わない**＝`typeof easing === "string" ? easing : …` のような
 * **値の場合分け**は別物（実際に3件の誤検出を出した＝`TimelineProjectScreen` の緩急、
 * `bulkImport` の取り込み物）。**捕まえた名前**に限って見る。
 */
export function rawErrorReads(src: string): string[] {
  const names = caughtNames(src);
  if (names.length === 0) return [];
  const alt = names.join("|");
  const passThrough = new RegExp(`typeof\\s+(${alt})\\s*===\\s*["']string["']\\s*\\?\\s*\\1\\b`);
  const messageThrough = new RegExp(`\\b(${alt})\\s+instanceof\\s+Error\\s*\\?\\s*\\1\\.message`);
  return src
    .split("\n")
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    // ⚠️ **注記は数えない**＝この門番の理由を書いた行で赤くしない。
    .filter(({ line }) => !line.startsWith("//") && !line.startsWith("*") && !line.startsWith("/*"))
    .filter(({ line }) => passThrough.test(line) || messageThrough.test(line))
    .map(({ line, n }) => `${n}: ${line}`);
}

/** 関門を**呼んでいる**行の数（注記の中の言及は数えない）。 */
export function gateCalls(src: string): number {
  return src
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("//") && !line.startsWith("*") && !line.startsWith("/*"))
    .reduce((n, line) => n + line.split("userFacingMessage(").length - 1, 0);
}

function appFiles(dir: string, root: string): { path: string; src: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return appFiles(p, root);
    if (!/\.tsx?$/.test(e.name) || e.name.includes(".test.")) return [];
    const path = relative(root, p).split(sep).join("/");
    if (path === GATE) return [];
    return [{ path, src: readFileSync(p, "utf8") }];
  });
}

describe("画面は生の断りをそのまま出さない（#1123）", () => {
  const root = process.cwd();
  // ⚠️ **画面の入口は `src/app` の外にある**（PR #1130 レビュー由来 ℹ️）＝`src/App.tsx` を
  // 落とすと、そこに生の断りを書いても 0 件のまま緑になる。
  const files = [
    ...appFiles(join(root, "src", "app"), root),
    { path: "src/App.tsx", src: readFileSync(join(root, "src", "App.tsx"), "utf8") },
  ];

  it("走査が画面へ届いている（見えていないのに緑、を作らない）", () => {
    // ⚠️ **実数で留める**＝走査の根を間違えると 0 件でも緑になる（この型を4回踏んだ）。
    expect(files.length, "画面の file が見つからない＝走査の根が違う").toBeGreaterThan(100);
    expect(files.map((f) => f.path)).toContain("src/app/screens/ExportScreen.tsx");
    expect(files.map((f) => f.path)).toContain("src/app/store/projectStore.ts");
    expect(files.map((f) => f.path), "画面の入口が対象外＝そこに書けば素通りする").toContain("src/App.tsx");
    expect(files.map((f) => f.path), "関門そのものは対象外").not.toContain(GATE);
  });

  it("生の断りを通している所は無い", () => {
    const hits = files.flatMap((f) => rawErrorReads(f.src).map((l) => `${f.path}:${l}`));
    expect(hits, "`userFacingMessage(e, \"どこで\") ?? 既定文` を通してください").toEqual([]);
  });

  it("関門を通している所を、実数で留める", () => {
    // ⚠️ **数で留める**＝関門を外しても、上の検査は「生の形が無い」だけで緑になりうる
    //（`.catch(() => 既定文)` へ戻す＝**中身を全部捨てる**形は、生の形を残さない）。
    // ⚠️ **注記は数えない**（PR #1133 のレビュー対応で気づいた）＝説明の中に
    // `userFacingMessage(e, …)` と書いただけで数が動くと、この数が「呼び出しの数」でなくなる。
    // ⚠️ **+2**＝見た目パターンの保存・削除（#1129 レビュー由来 🟡）＝以前は
    // `catch { 既定文 }` で**中身を全部捨てて**おり、この走査では**生の形が残らないので拾えない**。
    const gated = files.reduce((n, f) => n + gateCalls(f.src), 0);
    // ⚠️ **+1**＝接続キーの状態の確認（#1131）＝Rust が理由を返せるようになったので通す。
    // ⚠️ **+1**＝「保存した場所を開く」も関門を通した（#1155 ④＝隣の「動画を再生」と揃える）。
    // ⚠️ **+1**＝起動のときに頼まれた仕事の断り（ADR-0042・#1184）＝取り込み・書き出しの失敗を
    //   1か所（`loadErrorMessage`）で関門へ通す。⚠️ **`ProjectLoadError` だけは素通し**＝
    //   あれは「次の行動」を持った断りなので、既定文へ落とすと**従っても直らない案内**になる。
    expect(gated, "関門を通す所が変わりました＝減っていれば、その断りは画面へ届かなくなっています").toBe(31);
  });
});

describe("門番自身の検査（わざと壊した入力）", () => {
  const caught = (body: string): string => `try { f(); } catch (e) {\n${body}\n}`;

  it("文字列をそのまま通す形を見つける", () => {
    expect(rawErrorReads(caught('setError(typeof e === "string" ? e : "既定");'))).toHaveLength(1);
    expect(rawErrorReads("try { f(); } catch (err) {\nsetError(typeof err === 'string' ? err : DEF);\n}")).toHaveLength(1);
  });

  it("`Error` の中身をそのまま通す形を見つける", () => {
    expect(rawErrorReads(caught('const d = e instanceof Error ? e.message : "";'))).toHaveLength(1);
  });

  it("どう名付けても効く（名前を決め打ちしない）", () => {
    // ⚠️ **`e` / `err` だけを見る形にすると、こう書かれた瞬間に素通りする**。
    expect(rawErrorReads('try { f(); } catch (problem) {\nsetError(typeof problem === "string" ? problem : DEF);\n}')).toHaveLength(1);
    expect(caughtNames('try { f(); } catch (problem) {}')).toEqual(["problem"]);
    expect(caughtNames('p.catch((e: unknown) => g(e));')).toEqual(["e"]);
  });

  it("別名へ移してからの場合分けも拾う（1回だけ追う）", () => {
    // ⚠️ **捕まえた名前だけを見ていると素通りする**（PR #1130 レビュー由来 🟡）。
    expect(rawErrorReads('try { f(); } catch (e) {\nconst msg = e;\nsetError(typeof msg === "string" ? msg : DEF);\n}')).toHaveLength(1);
    expect(caughtNames('try { f(); } catch (e) {\nconst msg = e;\n}')).toEqual(["e", "msg"]);
    // ⚠️ **2段は追わない**＝無関係な代入まで巻き込むと誤検出になる（門番の信用が落ちる）。
    expect(caughtNames('try { f(); } catch (e) {\nconst a = e;\nconst b = a;\n}')).toEqual(["a", "e"]);
  });

  it("断り以外の型の見分けは拾わない（誤検出は門番の信用を落とす）", () => {
    // ⚠️ **実際に3件の誤検出を出した**＝緩急の値と、取り込み物の場合分け。
    expect(rawErrorReads(caught("return typeof easing === 'string' ? easing : CURVE;"))).toEqual([]);
    expect(rawErrorReads(caught('names.push(typeof item === "string" ? item : item.name);'))).toEqual([]);
    // 捕まえた所が無ければ、そもそも断りではない。
    expect(rawErrorReads('const s = typeof v === "string" ? v : "";')).toEqual([]);
  });

  it("関門を通している行は拾わない", () => {
    expect(rawErrorReads(caught('setError(userFacingMessage(e, "x") ?? DEF);'))).toEqual([]);
    // 画面向けに整えた文を持つ例外は、出してよい。
    expect(rawErrorReads(caught("const m = e instanceof ProjectLoadError ? e.message : DEF;"))).toEqual([]);
  });

  it("注記の中の形では赤くしない", () => {
    expect(rawErrorReads(caught('// typeof e === "string" ? e : 既定文 は使わない'))).toEqual([]);
    expect(rawErrorReads(caught(' * `typeof e === "string" ? e` は関門を通していない'))).toEqual([]);
  });

  it("関門の呼び出しを数える（注記の中の言及は数えない）", () => {
    expect(gateCalls('setError(userFacingMessage(e, "x") ?? DEF);')).toBe(1);
    expect(gateCalls('a(userFacingMessage(e, "x"));\nb(userFacingMessage(e, "y"));')).toBe(2);
    // ⚠️ **説明に書いただけでは数えない**＝この数が「呼び出しの数」であり続けるように。
    expect(gateCalls(' * 呼び側は `userFacingMessage(e, …) ?? 既定文`。')).toBe(0);
    expect(gateCalls('// userFacingMessage(e, "x") を通す')).toBe(0);
  });

  it("行番号を付けて返す（どこを直すか分かる）", () => {
    expect(rawErrorReads(caught('setError(typeof e === "string" ? e : DEF);'))[0]).toMatch(/^2: /);
  });
});
