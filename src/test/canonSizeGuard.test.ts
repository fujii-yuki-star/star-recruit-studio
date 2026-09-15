// 正典・入口が書いている**資料の大きさ**が、実態とずれていないことの門番（#1150）。
//
// ⚠️ **実際にずれていた**（α 出口監査 2026-09-14）＝`CLAUDE.md` の入口は `15` を「58,561字」と
// 書いていたが実測 21,121字＝**2.8倍大きく**見せていた（TSV へ切り出して縮んだのに数だけ古いまま）。
// この数は「`15` を読むかどうか」の判断に直接使われるので、**読むべきものを読ませなくする**向きの嘘。
//
// ⚠️ **同じ対象に3通りの数**があった＝`11_TIMELINE` の大きさが `11` では 71,784、入口では 72,349、
// 実測は 73,440。誰も検査していないので、動かしても誰も気づかない。
//
// ⚠️ **「数を落とす」ではなく「門番に持たせる」を採った**（利用者判断 2026-09-15）＝
// 入口の数は**読む／読まないの判断に効く情報**なので、落とすと入口の役目が半分落ちる。
// `cssDuplicateDeclGuard`（下限）や `errorStateTable`（行数）と同じ「**実数で留めて、ずれたら
// その場で赤くする**」流儀に揃える。
//
// ⚠️ **1割まで許す**＝資料は毎回少しずつ動くので、1字ずれるたびに直させると**数を消す方へ倒れる**
//（守れない門番は、いずれ緩められて黙る）。判断をゆがめるほどのずれ（上の 2.8 倍・20% 超）は捕まる。
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const DOCS = "docs/yuko_recruit_docs";

/** その file の文字数。 */
function chars(rel: string): number {
  return readFileSync(join(ROOT, rel), "utf8").length;
}

/** その入れ物の中の `.md` を全部（入れ子も）。 */
function mdFiles(rel: string): string[] {
  const dir = join(ROOT, rel);
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return mdFiles(join(rel, name));
    return name.endsWith(".md") ? [join(rel, name)] : [];
  });
}

const sum = (rels: string[]): number => rels.reduce((a, r) => a + chars(r), 0);

/** 資料ぜんぶ（`docs/yuko_recruit_docs/**` の `.md` ＋ `CLAUDE.md` ＋ エラーの表）。 */
function allDocsChars(): number {
  return sum(mdFiles(DOCS)) + chars("CLAUDE.md") + chars(`${DOCS}/errors/error-state-table.tsv`);
}

/** `errors/error-state-table.tsv` の行数（末尾の空行は数えない）。 */
function tsvLines(): number {
  return readFileSync(join(ROOT, DOCS, "errors/error-state-table.tsv"), "utf8").replace(/\n+$/, "").split("\n").length;
}

/** `messages.rs` が持つ、画面へ返す文の定数の本数（`15 §6.0` が書いている）。 */
function rustMessageConsts(): number {
  const src = readFileSync(join(ROOT, "src-tauri/src/messages.rs"), "utf8");
  return (src.match(/^pub const \w+: &str/gm) ?? []).length;
}

/** コードから `§7.6` を指している所の数（節番号を付け替えなかった理由として書いてある）。 */
function sectionRefs(): number {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      return /\.tsx?$/.test(e.name) ? [p] : [];
    });
  return walk(join(ROOT, "src"))
    .map((p) => readFileSync(p, "utf8"))
    .reduce((n, src) => n + (src.match(/§7\.6/g) ?? []).length, 0);
}

/** 書いてある主張（1つ目のかっこが数・カンマ入り）。 */
export interface SizeClaim {
  /** 主張が書いてある file（`/` 区切りの相対）。 */
  readonly file: string;
  /** 何の数か（赤くなったときの案内に出る）。 */
  readonly what: string;
  /** 主張を取り出す（1つ目のかっこが数）。 */
  readonly re: RegExp;
  /** 実際の値。 */
  readonly actual: () => number;
}

/** 許すずれ（1割）。⚠️ **ここを緩めると門番が黙る**ので、下で実数を固定する。 */
export const SIZE_TOLERANCE = 0.1;

/**
 * **ここから下は、ぴったり合っていること**（#1150 の変異チェックで生き残った）。
 *
 * ⚠️ **割合の許容は、小さい数には緩すぎる**＝`messages.rs` の定数「17 本」を 16 に戻す変異が
 * **5.9% のずれとして通って**しまった。実際にずれていたのがまさにこの数（実装 17・門番 17・
 * 正典だけ 16）なので、**捕まえたいものを捕まえられない**設定だった。
 * ⚠️ **大きい数は割合でよい**＝資料の文字数は毎回動くので、1字ごとに直させると数を消す方へ倒れる。
 * 小さい数（本数・行数）は**動いたら必ず人が触る**ものなので、ぴったりで困らない。
 */
export const EXACT_BELOW = 1000;

/**
 * 実態から離れすぎた主張（`file: what 書いた値 → 実測` で返す）。
 *
 * ⚠️ **見つからない主張も返す**＝正規表現が当たらなくなったら、**数が消えた**か**書き方が変わった**。
 * どちらも「黙って通す」と門番が空振りする（`guards-blind-not-red`）。
 */
export function sizeDrift(claims: readonly SizeClaim[], read: (f: string) => string): string[] {
  return claims.flatMap((c) => {
    const m = c.re.exec(read(c.file));
    if (!m) return [`${c.file}: ${c.what} の記述が見つからない（数を消したか、書き方を変えた）`];
    const written = Number(m[1]!.replace(/,/g, ""));
    const actual = c.actual();
    const off = Math.abs(written - actual) / Math.max(actual, 1);
    const bad = actual < EXACT_BELOW ? written !== actual : off > SIZE_TOLERANCE;
    return bad
      ? [`${c.file}: ${c.what} 書いた値 ${written.toLocaleString()} → 実測 ${actual.toLocaleString()}`]
      : [];
  });
}

const CLAIMS: SizeClaim[] = [
  // `CLAUDE.md` の入口ブロック＝**読む／読まないの判断に直接使われる**数。
  { file: "CLAUDE.md", what: "06 の大きさ", re: /`06` ([\d,]+)字/, actual: () => chars(`${DOCS}/06_UI_SPEC.md`) },
  {
    file: "CLAUDE.md", what: "11＋11_TIMELINE の合計", re: /`11`＋`11_TIMELINE` 合計 ([\d,]+)字/,
    actual: () => sum([`${DOCS}/11_SCHEMA_REFERENCE.md`, `${DOCS}/11_TIMELINE_REFERENCE.md`]),
  },
  { file: "CLAUDE.md", what: "15 の大きさ", re: /`15` ([\d,]+)字/, actual: () => chars(`${DOCS}/15_ERROR_STATE_MODEL.md`) },
  { file: "CLAUDE.md", what: "adr/ の合計", re: /`adr\/` 合計 ([\d,]+)字/, actual: () => sum(mdFiles(`${DOCS}/adr`)) },

  // 入口（`docs/ai_work_guides/README.md`）の一覧。
  { file: "docs/ai_work_guides/README.md", what: "CLAUDE.md", re: /\| `CLAUDE\.md` \| \*\*([\d,]+)\*\*/, actual: () => chars("CLAUDE.md") },
  { file: "docs/ai_work_guides/README.md", what: "11_SCHEMA_REFERENCE.md", re: /\| `11_SCHEMA_REFERENCE\.md` \| \*\*([\d,]+)\*\*/, actual: () => chars(`${DOCS}/11_SCHEMA_REFERENCE.md`) },
  { file: "docs/ai_work_guides/README.md", what: "06_UI_SPEC.md", re: /\| `06_UI_SPEC\.md` \| ([\d,]+) \|/, actual: () => chars(`${DOCS}/06_UI_SPEC.md`) },
  { file: "docs/ai_work_guides/README.md", what: "15_ERROR_STATE_MODEL.md", re: /\| `15_ERROR_STATE_MODEL\.md` \| \*\*([\d,]+)\*\*/, actual: () => chars(`${DOCS}/15_ERROR_STATE_MODEL.md`) },
  { file: "docs/ai_work_guides/README.md", what: "エラーの表の行数", re: /エラーの表・([\d,]+)行/, actual: tsvLines },
  { file: "docs/ai_work_guides/README.md", what: "エラーの表の大きさ", re: /エラーの表・[\d,]+行） \| ([\d,]+) \|/, actual: () => chars(`${DOCS}/errors/error-state-table.tsv`) },
  { file: "docs/ai_work_guides/README.md", what: "adr/ の本数", re: /`adr\/\*\.md`（([\d,]+)本）/, actual: () => mdFiles(`${DOCS}/adr`).length },
  { file: "docs/ai_work_guides/README.md", what: "adr/ の合計", re: /`adr\/\*\.md`（[\d,]+本） \| ([\d,]+) \|/, actual: () => sum(mdFiles(`${DOCS}/adr`)) },
  { file: "docs/ai_work_guides/README.md", what: "archive/ の合計", re: /（監査の報告・調査資料） \| \*\*([\d,]+)\*\*/, actual: () => sum(mdFiles(`${DOCS}/archive`)) },

  // 切り出しの理由（`11` と、そこを指す2本のガイド）＝**同じ対象に3通りの数**があった所。
  { file: `${DOCS}/11_SCHEMA_REFERENCE.md`, what: "11_TIMELINE の大きさ", re: /本節だけで ([\d,]+)字/, actual: () => chars(`${DOCS}/11_TIMELINE_REFERENCE.md`) },
  { file: `${DOCS}/11_SCHEMA_REFERENCE.md`, what: "§7.6 を指す記述の数", re: /コードだけで ([\d,]+) か所/, actual: sectionRefs },
  { file: "docs/ai_work_guides/README.md", what: "11_TIMELINE の大きさ", re: /\| `11 §7\.6` \| ([\d,]+) \|/, actual: () => chars(`${DOCS}/11_TIMELINE_REFERENCE.md`) },
  { file: "docs/ai_work_guides/schema_change.md", what: "11_TIMELINE の大きさ", re: /`11 §7\.6 TimelineProject` \*\*([\d,]+)\*\*/, actual: () => chars(`${DOCS}/11_TIMELINE_REFERENCE.md`) },
  { file: "docs/ai_work_guides/timeline_change.md", what: "11_TIMELINE の大きさ", re: /ファイル全体で ([\d,]+)字/, actual: () => chars(`${DOCS}/11_TIMELINE_REFERENCE.md`) },

  // `15 §6.0` が書いている「Rust が画面へ返す文の定数の本数」＝**門番（`errorStateTable`）と
  // 同じ値**でなければならない。⚠️ **実際にずれていた**（実装 17・門番 17・正典だけ 16）。
  { file: `${DOCS}/15_ERROR_STATE_MODEL.md`, what: "messages.rs の定数の本数", re: /いまの ([\d,]+) 本はすべて/, actual: rustMessageConsts },
  { file: `${DOCS}/15_ERROR_STATE_MODEL.md`, what: "エラーの表の行数", re: /\(errors\/error-state-table\.tsv\)\*\*（([\d,]+) 行）/, actual: tsvLines },

  // 総量（入口の「全部読むと、これだけ」）。
  { file: "docs/ai_work_guides/README.md", what: "資料ぜんぶ", re: /\| 資料ぜんぶ \| ([\d,]+)/, actual: allDocsChars },
  { file: "docs/ai_work_guides/README.md", what: "archive を除いた総量", re: /`archive\/` を除くと ([\d,]+)\*\*/, actual: () => allDocsChars() - sum(mdFiles(`${DOCS}/archive`)) },
];

/**
 * ⚠️ **ここが見ていない数**（意図して外した・#1150）。
 *
 * - **過去の記録**（`CLAUDE.md` の「以前は 42,288字」・入口の「整理前 50,916」「切り出し前 120,581」
 *   「表を外へ出す前 61,322」）＝**そのときの実測**であって、いまの実態とは無関係。動かしてはいけない。
 * - **節ごとの大きさ**（`schema_change.md` の `§7.1 Project` 7,054 など）＝節を切り出す道具が無いと
 *   測れない。**入れられなかった**ので、ここに書いて残す（次に節の道具ができたら足す）。
 * - **割合**（`11` の「59.5%」）＝上の2つの実数が守られていれば自動的に近い値になる。
 */
export const NOT_GUARDED = ["過去の記録", "節ごとの大きさ", "割合"] as const;

describe("資料の大きさの記述が、実態とずれていない（#1150）", () => {
  it("書いてある数は、実測から1割の中に収まっている", () => {
    const read = (f: string): string => readFileSync(join(ROOT, f), "utf8");
    expect(
      sizeDrift(CLAIMS, read),
      "資料の大きさの記述が実態からずれています。**数を消さずに、書き直してください**（#1150＝この数は「読むかどうか」の判断に使われます）",
    ).toEqual([]);
  });

  // ⚠️ **走査が空振りしていない**＝主張を1つも拾えていなければ、何を壊しても緑になる。
  it("見ている主張の数が、記録と一致する", () => {
    expect(CLAIMS.length, "見る主張が増減しました（増やしたらこの数も直す）").toBe(22);
  });

  // ⚠️ **許すずれを実数で固定する**＝ここを緩めるだけで門番は黙るのに、
  //    相対で書いた検査は**一緒に緩んで気づけない**（`aiWorkGuideLinks` の `MAX_CHARS` と同じ理由）。
  it("許すずれは1割・小さい数はぴったり", () => {
    expect(SIZE_TOLERANCE).toBe(0.1);
    expect(EXACT_BELOW).toBe(1000);
  });

  // ⚠️ **拾い方そのものを叩く**＝歩く形だけだと「いまの資料にずれが無いので緑」になる。
  describe("拾い方の検査", () => {
    const claim = (actual: number): SizeClaim => ({ file: "x.md", what: "試し", re: /([\d,]+)字/, actual: () => actual });

    it("1割を超えたら見つける", () => {
      expect(sizeDrift([claim(100)], () => "111字")).toHaveLength(1);
    });

    it("1割ちょうどは通す（境界で切らない）", () => {
      expect(sizeDrift([claim(10_000)], () => "11,000字")).toEqual([]);
    });

    // ⚠️ **小さい数はぴったり**＝割合だと「17 本を 16 本」が 5.9% で通ってしまう
    //（実際にずれていたのがこの数＝捕まえたいものを捕まえられない設定だった）。
    it("小さい数は1違っても見つける", () => {
      expect(sizeDrift([claim(17)], () => "16字")).toHaveLength(1);
      expect(sizeDrift([claim(17)], () => "17字")).toEqual([]);
    });

    it("カンマ入りでも読む", () => {
      expect(sizeDrift([claim(120_000)], () => "121,838字")).toEqual([]);
    });

    // ⚠️ **数が消えたら赤くする**＝「見つからないから通す」にすると、**数を消すだけで門番が黙る**。
    it("記述が見つからなければ見つける（黙って通さない）", () => {
      expect(sizeDrift([claim(100)], () => "数はもう書いていない")).toHaveLength(1);
    });

    // ⚠️ **小さい側へのずれも見る**＝実際に踏んだのは「2.8倍大きく見せる」方だったが、
    //    小さく見せると「すぐ読める」と誤らせる（どちらも判断をゆがめる）。
    it("小さく書きすぎても見つける", () => {
      expect(sizeDrift([claim(100)], () => "50字")).toHaveLength(1);
      // ⚠️ **大きい数でも両向き見る**＝`Math.abs` をやめると、**小さく書いた側だけ**が
      // 素通りする（「すぐ読める」と誤らせる向き）。小さい数はぴったり判定が受けるので、
      // ここを大きい数で書かないと、その取りこぼしが見えない。
      expect(sizeDrift([claim(10_000)], () => "5,000字")).toHaveLength(1);
    });
  });
});
