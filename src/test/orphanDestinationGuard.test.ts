// 「消える名前」を行き先にした決定が残っていないことの門番（ADR-0043・#1192）。
//
// ⚠️ **これが要る理由**＝ADR-0043 は「**箱と昇格条件を同時に書く**」という**運用の規則**を作ったが、
// 規則だけでは止まらないことが**その PR 自身で実証された**（PR #1196 のレビュー）＝
// 同じファイルの 497 行目は直したのに、**読者が最初に見る決定表（86 行目）を見落とした**。
// さらに全文を洗うと **3件目**（`ADR-0024` の未決定事項）まで出た。
//
// ⚠️ **見落としは注意力の問題ではない**＝行き先の記述が**長大な地の文の中に散らばっていて**、
// 目で拾える形になっていない。だから**機械で拾う**。
//
// ⚠️ **禁じるのは「α-N 以降／α-N 候補」だけ**＝これは**当時のロードマップの区切り**であり、
// 区切りが消えると中身ごと消える。`general-backlog` のような**実在する箱**は名前が消えない。
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** 行き先として使うと消える書き方（当時のロードマップの区切り）。 */
const VANISHING = /α-\d\s*(以降|候補)/;

/** その行が、行き先を与え直した注記を持っているか。 */
const ANNOTATED = /ADR-0043|general-backlog/;

/**
 * 「消える名前を行き先にしている行」を拾う（純粋関数）。
 *
 * ⚠️ **拾い方を関数へ出す**＝歩く形だけだと、拾い方を消しても
 * 「いまの資料に漏れが無いので緑」になる（`CLAUDE.md §7`）。
 * ⚠️ **注記は「同じ行か、すぐ下の引用行」に在ればよい**＝表のセルには改行を書けないので
 * 同じ行に、箇条書きなら下の `>` 行に足す形になる。
 */
export function vanishingDestinations(src: string): number[] {
  const lines = src.split(/\r?\n/);
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (!VANISHING.test(line)) continue;
    const near = [line, lines[i + 1] ?? '', lines[i + 2] ?? ''].join('\n');
    if (ANNOTATED.test(near)) continue;
    hits.push(i + 1);
  }
  return hits;
}

/**
 * 見ない資料。
 *
 * ⚠️ **規則そのものを書いた資料と、棚卸しの記録は外す**＝どちらも「`α-6 以降` と書いてあった」ことを
 * **説明するために引用している**ので、そこを赤くすると**説明が書けなくなる**。
 * ⚠️ **数は増やさない**＝迷って足すと、そこが抜け道になる（下の「門番自身の検査」で数を留める）。
 */
const SKIP_FILES = [
  'docs/yuko_recruit_docs/adr/0043-alpha-beta-scope-and-general-backlog.md',
  'docs/yuko_recruit_docs/audits/2026-09-17-video-editing-maturity.md',
];

function mdFiles(dir: string): { path: string; src: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    // ⚠️ **`archive` は見ない**＝終わった資料の中の当時の書き方まで直すと、履歴が読めなくなる。
    if (e.isDirectory()) return e.name === 'archive' ? [] : mdFiles(p);
    return e.name.endsWith('.md') ? [{ path: p.split('\\').join('/'), src: readFileSync(p, 'utf8') }] : [];
  });
}

describe('消える名前を行き先にしない（ADR-0043）', () => {
  it('「α-N 以降」「α-N 候補」だけで済ませている所が無い', () => {
    const hits = mdFiles('docs')
      .filter((f) => !SKIP_FILES.includes(f.path))
      .flatMap((f) => vanishingDestinations(f.src).map((n) => `${f.path}:${n}`));
    expect(
      hits,
      '行き先が「当時のロードマップの区切り」だけになっています。**実在する箱**（α-N マイルストーン／`general-backlog`／「やらない」）と、**α へ上げる条件**を同じ所へ書いてください（ADR-0043）',
    ).toEqual([]);
  });
});

describe('門番自身の検査（わざと壊した入力）', () => {
  // ⚠️ **逃がす資料は名指しの一覧だけ**（勝手に広がらない）。
  it('見ない資料は2つだけ', () => {
    expect(SKIP_FILES).toEqual([
      'docs/yuko_recruit_docs/adr/0043-alpha-beta-scope-and-general-backlog.md',
      'docs/yuko_recruit_docs/audits/2026-09-17-video-editing-maturity.md',
    ]);
  });

  it('注記の無い「α-6 以降」を拾う', () => {
    expect(vanishingDestinations('- これは α-6 以降。')).toEqual([1]);
    expect(vanishingDestinations('- これは α-7 候補。')).toEqual([1]);
  });

  it('注記があれば拾わない（同じ行／下の行のどちらでも）', () => {
    expect(vanishingDestinations('- α-6 以降 ⚠️ いまは ADR-0043 で general-backlog。')).toEqual([]);
    expect(vanishingDestinations('- α-6 以降。\n  > 行き先は ADR-0043 で決め直した。')).toEqual([]);
  });

  // ⚠️ **関係ない「α-5」まで拾わない**＝節の見出しや、済んだ作業の記録まで赤くしない。
  it('行き先でない言い方は拾わない', () => {
    expect(vanishingDestinations('α-5 で入れた機能の一覧。')).toEqual([]);
    expect(vanishingDestinations('α-6 の締めで直した。')).toEqual([]);
  });
});
