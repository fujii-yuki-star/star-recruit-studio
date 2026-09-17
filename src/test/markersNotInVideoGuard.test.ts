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

/**
 * 動画の絵と音を作る側（ここが目印を読んだら、動画に出る道ができる）。
 *
 * ⚠️ **`src/domain/timeline/**` を丸ごと見る**（#1153＝α 出口監査 🟡）＝以前は
 * `export.ts`／`audio.ts` の**2つを手で並べて**いたが、**焼く側の実体はそこで尽きていない**。
 * `timelineFramePlan` は尺を `playback.ts`（`timelineFrameCount`）に、焼くコマの置き場所を
 * `video.ts`（`videoPlacementsOf`）に委ねているので、**そこに目印を読む一行を足すと
 * 書き出した MP4 が変わるのに、門番は緑**だった。
 * ⚠️ **手で並べる形に戻さない**＝次に焼く側の file が増えたとき、また射程の外になる。
 */
const VIDEO_DIRS = ["src/renderer", "src/domain/timeline"];

/**
 * ⚠️ **目印そのものを扱う file は、当然読んでよい**（誤検出は門番の信用を落とす）。
 * ここに足すのは**「動画を作らない」ことが説明できる file だけ**＝迷ったら足さない。
 */
const ALLOWED = [
  "src/domain/timeline/markers.ts",
  "src/domain/timeline/types.ts",
  // ⚠️ **検証は動画を作らない**（#1155 ③）＝`11 §8` V33（同じ時刻に2つ置かない）を見るために
  // 目印を読むが、ここが返すのは**知らせ（`Warning`）だけ**で、絵にも音にも1バイトも入らない。
  // ⚠️ **この file がこの門番に捕まったのは正しい**＝射程を広げた直後に、私が目印を読む一行を
  // 足したので赤くなった。**説明できるから逃がす**のであって、赤いから逃がすのではない。
  "src/domain/timeline/validateTimelineDoc.ts",
  // ⚠️ **範囲を詰めるときは目印を動かす**（#1193）＝**絵にも音にも入れない**。
  // 動かすのは「消した長さだけ前へ寄せる」だけで、**描く側も焼く側もここを通らない**。
  // ⚠️ **逃がす理由は「動かす必要がある」こと**＝詰めると全体の尺が縮むので、動かさないと
  // **既にある目印が全部、別の場面を指す**（ADR-0026④）。
  // ⚠️ **赤いから逃がすのではない**＝ここが捕まえたのは正しい動き。説明できるから逃がす。
  "src/domain/timeline/deleteRange.ts",
];

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
  const files = VIDEO_DIRS.flatMap((d) => filesUnder(join(root, d), root))
    .filter((f) => !ALLOWED.includes(f.path));

  it("走査が絵と音を作る側へ届いている（見えていないのに緑、を作らない）", () => {
    // ⚠️ **実数で留める**＝走査の根を間違えると 0 件でも緑になる（この型を何度も踏んだ）。
    // ⚠️ **歩いた数も留める**（#1153）＝ただし**根の取り違えを実際に捕まえるのは下の名指し**で、
    // ここは補助（変異チェックでこの1行だけを緩めても、名指しが赤くなる＝等価）。
    // それでも置くのは、**名指しに挙げていない file が丸ごと消えた**ときの粗い網になるから。
    expect(files.length, "描く側の file が見つからない＝走査の根が違う").toBeGreaterThan(30);
    for (const must of [
      "src/domain/timeline/export.ts",
      "src/domain/timeline/audio.ts",
      // ⚠️ **焼く側が委ねている先**（#1153）＝ここが射程の外だと、尺と置き場所に
      // 目印を混ぜても門番は緑になる。
      "src/domain/timeline/playback.ts",
      "src/domain/timeline/video.ts",
      // ⚠️ **描く核**（`layoutTimelineAt` はここ）。
      "src/renderer/timelineLayout.ts",
      // ⚠️ **入れ子の下も歩いていること**＝歩き方から再帰を外すと、上の名前は残るのに
      // `src/renderer/export/**`（焼く側の本体）が丸ごと射程の外になる。
      "src/renderer/export/rasterize.ts",
    ]) {
      expect(files.map((f) => f.path), `${must} が射程の外`).toContain(must);
    }
    // ⚠️ **目印そのものの file は外してある**＝外し忘れると、いつも赤くなって門番が捨てられる。
    expect(files.map((f) => f.path)).not.toContain("src/domain/timeline/markers.ts");
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

  it("逃がす file は、名指しの一覧だけ（勝手に広がらない）", () => {
    // ⚠️ **一覧を増やすのは「動画を作らない」と説明できる file だけ**＝
    // 迷って足すと、そこが抜け道になる（門番の射程は狭める方向にしか壊れない）。
    expect(ALLOWED).toEqual([
      "src/domain/timeline/markers.ts",
      "src/domain/timeline/types.ts",
      "src/domain/timeline/validateTimelineDoc.ts",
      // ⚠️ **範囲を詰めるときだけ目印を動かす**（#1193）＝絵にも音にも入らない。
      "src/domain/timeline/deleteRange.ts",
    ]);
  });

  it("似た名前を巻き込まない（語の切れ目で見る）", () => {
    expect(readsMarkers("const markersCount = 1;")).toEqual([]);
    expect(readsMarkers("const marker = 1;")).toEqual([]);
  });

  it("行番号を付けて返す（どこを直すか分かる）", () => {
    expect(readsMarkers("const a = 1;\nconst ms = doc.markers;")[0]).toMatch(/^2: /);
  });
});
