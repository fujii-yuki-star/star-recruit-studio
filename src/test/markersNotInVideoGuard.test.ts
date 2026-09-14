// 目印（#356 ①）は**動画に出ない**ことの門番。
//
// ⚠️ **これが効いていないと、作業用のメモが動画に焼き付く**＝取り返しがつかない
//（書き出した MP4 に「ここ直す」が映る）。schema にも「動画には出ない」と書いた以上、
// **書いただけにしない**（`CLAUDE.md §7`＝自分がコメントに書いた主張も検査する）。
//
// ⚠️ **走査は「読んでいないこと」を見る**＝描く側・焼く側が `markers` に触れていないこと。
// 触る必要が出たら（例：編集画面のタイムラインに印を描く）**そこは `src/app` であって
// `renderer` ではない**＝この門番の射程の外。
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/** 動画の絵と音を作る側（ここが目印を読んだら、動画に出る道ができる）。 */
const VIDEO_DIRS = ["src/renderer"];
/** 同じく、時間と音を組み立てる側（画面ではない）。 */
const VIDEO_FILES = ["src/domain/timeline/export.ts", "src/domain/timeline/audio.ts"];

/**
 * その本文が**目印を読んでいる**か（注記の中の言及は数えない）。
 *
 * ⚠️ **拾い方を純粋関数にする**（`CLAUDE.md §7`）＝歩く形だけだと、拾い方を消しても
 * 「いまのコードに漏れが無いので緑」になる。
 */
export function readsMarkers(src: string): string[] {
  return src
    .split("\n")
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => !line.startsWith("//") && !line.startsWith("*") && !line.startsWith("/*"))
    .filter(({ line }) => /\bmarkers\b/.test(line) || /\bTimelineMarker\b/.test(line))
    .map(({ line, n }) => `${n}: ${line}`);
}

function filesUnder(dir: string, root: string): { path: string; src: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return filesUnder(p, root);
    if (!/\.tsx?$/.test(e.name) || e.name.includes(".test.")) return [];
    return [{ path: relative(root, p).split(sep).join("/"), src: readFileSync(p, "utf8") }];
  });
}

describe("目印は動画に出ない（#356 ①）", () => {
  const root = process.cwd();
  const files = [
    ...VIDEO_DIRS.flatMap((d) => filesUnder(join(root, d), root)),
    ...VIDEO_FILES.map((f) => ({ path: f, src: readFileSync(join(root, f), "utf8") })),
  ];

  it("走査が絵と音を作る側へ届いている（見えていないのに緑、を作らない）", () => {
    // ⚠️ **実数で留める**＝走査の根を間違えると 0 件でも緑になる（この型を何度も踏んだ）。
    expect(files.length, "描く側の file が見つからない＝走査の根が違う").toBeGreaterThan(10);
    expect(files.map((f) => f.path)).toContain("src/domain/timeline/export.ts");
    expect(files.map((f) => f.path)).toContain("src/domain/timeline/audio.ts");
    // ⚠️ **描く核も射程に入っていること**（`layoutTimelineAt` はここ）。
    expect(files.map((f) => f.path)).toContain("src/renderer/timelineLayout.ts");
  });

  it("描く側・焼く側は目印を読んでいない", () => {
    const hits = files.flatMap((f) => readsMarkers(f.src).map((l) => `${f.path}:${l}`));
    expect(hits, "目印が動画へ出る道ができています（作業用のメモが MP4 に焼き付きます）").toEqual([]);
  });
});

describe("門番自身の検査（わざと壊した入力）", () => {
  it("読んでいる所を見つける", () => {
    expect(readsMarkers("const ms = doc.markers ?? [];")).toHaveLength(1);
    expect(readsMarkers("function f(m: TimelineMarker) {}")).toHaveLength(1);
  });

  it("注記の中の言及では赤くしない（誤検出は門番の信用を落とす）", () => {
    expect(readsMarkers("// markers は動画に出ない")).toEqual([]);
    expect(readsMarkers(" * `markers` は作業用")).toEqual([]);
  });

  it("似た名前を巻き込まない（語の切れ目で見る）", () => {
    expect(readsMarkers("const markersCount = 1;")).toEqual([]);
    expect(readsMarkers("const marker = 1;")).toEqual([]);
  });

  it("行番号を付けて返す（どこを直すか分かる）", () => {
    expect(readsMarkers("const a = 1;\nconst ms = doc.markers;")[0]).toMatch(/^2: /);
  });
});
