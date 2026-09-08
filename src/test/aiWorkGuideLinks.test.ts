// 作業ガイド（`docs/ai_work_guides/`）が**行き先として生きている**ことの門番。
//
// ⚠️ **入口資料は、指し先が消えた瞬間に「無いより悪いもの」になる**＝読む側は「そこに書いてある」と
// 信じて開き、無ければ**探し直すか、読まずに書く**。正典の節番号は実際に動く（節を足す・分ける）ので、
// 人の注意力では追えない。指し先が実在するかを機械で見る。
//
// ⚠️ **中身の正しさは見ない**（見られない）＝ここが見るのは「リンクが解ける」「引いた節が実在する」
// 「入口の一覧と実ファイルが一致する」「短いまま」の4つだけ。正典と合っているかは `/canon-check`。
//
// ⚠️ **門番自身にも穴が空く**（α-7 で20件）＝規則を書いただけでは、いまの資料がたまたま正しい間は
// **規則を壊しても緑のまま**になる（この門番も最初は7件生き残った）。だから判定は**純粋関数に出し**、
// 下の「門番自身の検査」で**わざと壊した入力**を通して、見つけることまで固定する。
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, normalize, posix } from 'node:path';

const GUIDE_DIR = 'docs/ai_work_guides';
const guideFiles = readdirSync(GUIDE_DIR).filter((f) => f.endsWith('.md'));
const read = (f: string): string => readFileSync(join(GUIDE_DIR, f), 'utf8');

/** ガイドが節番号で引いてよい資料（呼び名 → パス）。 */
const CANON: Record<string, string> = {
  '04': 'docs/yuko_recruit_docs/04_TEMPLATE_SPEC.md',
  '05': 'docs/yuko_recruit_docs/05_RENDERING_SPEC.md',
  '06': 'docs/yuko_recruit_docs/06_UI_SPEC.md',
  '08': 'docs/yuko_recruit_docs/08_TEST_PLAN.md',
  '11': 'docs/yuko_recruit_docs/11_SCHEMA_REFERENCE.md',
  '12': 'docs/yuko_recruit_docs/12_AI_PROMPT_AND_MAPPING.md',
  '13': 'docs/yuko_recruit_docs/13_DEPENDENCIES_AND_LICENSING.md',
  '14': 'docs/yuko_recruit_docs/14_TEST_STRATEGY.md',
  '15': 'docs/yuko_recruit_docs/15_ERROR_STATE_MODEL.md',
  '16': 'docs/yuko_recruit_docs/16_GLOSSARY.md',
  'CLAUDE.md': 'CLAUDE.md',
};

/**
 * 入口（README）に許す長さと、ガイド1本に許す長さ。
 *
 * ⚠️ **実数を下の検査で固定する**＝ここを緩めるだけで門番は黙るのに、
 * 上限との相対で書いた検査は**一緒に緩んで気づけない**（変異チェックで生き残った）。
 */
export const MAX_CHARS = { readme: 6000, guide: 4000 };

/** 資料の呼び名の直後に置ける文字（バッククォートと空白）。 */
const SEP = '[`\\s]{0,2}';

/**
 * その資料が持っている節番号。
 *
 * ⚠️ **見出しだけを見ない**＝正典には太字で始まる小節（`7.1.1 videoSettings`）があり、
 * 見出しだけを集めると**実在するのに「無い」と言う**（嘘の赤）。
 */
export function sectionsOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split('\n')) {
    const head = line.match(/^#{2,6} (\d+(?:\.\d+)*)/);
    if (head) out.add(head[1]!);
    const bold = line.match(/^\*\*(\d+(?:\.\d+)+)\s/);
    if (bold) out.add(bold[1]!);
  }
  return out;
}

/** その資料の呼び名を探す正規表現の断片（数字の呼び名は前後の数字と地続きにしない）。 */
function namePattern(key: string): string {
  return key === 'CLAUDE.md' ? 'CLAUDE\\.md' : '(?:^|[^0-9])' + key;
}

/**
 * 1行に現れる資料の呼び名（重複なし）。
 *
 * ⚠️ **裸の数字を資料名と見なさない**＝表の桁数や節番号（`47,731`・`§12.1`）を資料の呼び名と
 * 読んでしまい、**別の資料の節を探しに行く**（嘘の赤・実際に出た）。見るのは
 * ファイル名（`06_UI_SPEC`）と、節の直前に置かれた呼び名（`06 §9`）だけ。
 */
function docsOnLine(line: string): string[] {
  const out = new Set<string>();
  for (const key of Object.keys(CANON)) {
    if (key === 'CLAUDE.md') {
      if (line.includes('CLAUDE.md')) out.add(key);
      continue;
    }
    const fileName = CANON[key]!.split('/').pop()!.replace('.md', '');
    if (line.includes(fileName) || new RegExp(namePattern(key) + SEP + '§').test(line)) out.add(key);
  }
  return [...out];
}

/**
 * ガイドが引いている節を `(資料, 節)` で取り出す。
 *
 * ⚠️ **どの資料の節か決まらない書き方を許さない**＝直前に資料名が無く、同じ行にも資料が1つに
 * 決まらない場合は `owner:null` で返す（読む側も**どこを開けばいいか分からない**）。
 */
export function citationsIn(text: string): { owner: string | null; section: string; line: number }[] {
  const out: { owner: string | null; section: string; line: number }[] = [];
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/§(\d+(?:\.\d+)*)/g)) {
      const before = line.slice(Math.max(0, m.index! - 14), m.index!);
      const near = Object.keys(CANON).find((k) => new RegExp(namePattern(k) + SEP + '$').test(before));
      const onLine = docsOnLine(line);
      out.push({ owner: near ?? (onLine.length === 1 ? onLine[0]! : null), section: m[1]!, line: i + 1 });
    }
  });
  return out;
}

/** 引けない節（どの資料か決まらない／その資料に無い）。 */
export function badCitations(text: string, sections: Map<string, Set<string>>): string[] {
  const out: string[] = [];
  for (const c of citationsIn(text)) {
    if (c.owner === null) out.push(`${c.line}: §${c.section}（どの資料か分からない）`);
    else if (!sections.get(c.owner)!.has(c.section)) out.push(`${c.line}: ${c.owner} §${c.section}（無い）`);
  }
  return out;
}

/** 相対リンクのうち、指し先が無いもの。 */
export function brokenLinks(text: string, dir: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\]\((?!https?:)([^)#\s]+)(?:#[^)]*)?\)/g)) {
    if (!existsSync(normalize(join(dir, m[1]!)))) out.push(m[1]!);
  }
  return out;
}

/**
 * ガイドが挙げているコードのパスのうち、実在しないもの。
 *
 * ⚠️ **リンクと節だけでは足りない**（PR #1089 レビュー 🟡）＝ガイドは門番や関数のありかを
 * **バッククォートのパス**で示すが、そこはリンクでも節でもないので**誰も確かめていなかった**
 * （実際に `src/test/errorStateTable.test.ts` と書いて外していた＝実体は `src/app/` の下）。
 * ⚠️ **`*` を含むものは見ない**＝`src/app/**` のような「あたり」を示す書き方は実在確認になじまない。
 */
export function missingPaths(text: string, exists: (p: string) => boolean): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/`((?:src|docs|scripts)\/[^`\s]+)`/g)) {
    const p = m[1]!.replace(/\/$/, '');
    if (!p.includes('*') && !exists(p)) out.push(m[1]!);
  }
  return out;
}

/**
 * 入口の一覧と実ファイルの食い違い。
 *
 * ⚠️ **両向きを見る**＝片方だけだと「一覧に無いガイド」（誰も開かない）か
 * 「一覧にあるのに無いガイド」（行き止まり）のどちらかを見逃す。
 */
export function listingMismatch(readme: string, files: readonly string[]): { unlisted: string[]; ghost: string[] } {
  const listed = new Set([...readme.matchAll(/\]\((\w+\.md)\)/g)].map((m) => m[1]!));
  const actual = new Set(files.filter((f) => f !== 'README.md'));
  return {
    unlisted: [...actual].filter((f) => !listed.has(f)),
    ghost: [...listed].filter((f) => !actual.has(f)),
  };
}

/** 長すぎる入口資料（`名前=文字数` で返す）。 */
export function tooLong(entries: readonly (readonly [string, number])[]): string[] {
  return entries
    .filter(([f, n]) => n > (f === 'README.md' ? MAX_CHARS.readme : MAX_CHARS.guide))
    .map(([f, n]) => `${f}=${n}`);
}

const canonSections = new Map(Object.entries(CANON).map(([k, p]) => [k, sectionsOf(readFileSync(p, 'utf8'))]));

describe('作業ガイドの行き先（docs/ai_work_guides）', () => {
  it('リンクの指し先が実在する', () => {
    const broken = guideFiles.flatMap((f) => brokenLinks(read(f), GUIDE_DIR).map((l) => `${f} -> ${l}`));
    expect(broken, '指し先が無いリンク').toEqual([]);
  });

  it('引いている節が、その資料に実在する', () => {
    const bad = guideFiles.flatMap((f) => badCitations(read(f), canonSections).map((b) => `${f}:${b}`));
    expect(bad, '引けない節').toEqual([]);
  });

  // ℹ️ **この行そのものを消す変異は捕まらない**（変異チェックで1件生き残る）＝**検査を消す**のと
  //    同じで、どんな検査も自分が消されたことは言えない。**規則の側**（`listingMismatch` の両向き）は
  //    下の「門番自身の検査」で押さえてあるので、規則が黙って緩むことはない。
  it('入口（README）の一覧と、ガイドの顔ぶれが一致する', () => {
    // 片側ずつ書くと、片方の行を消しても**もう片方が緑のまま**になる（両向きを1つの比較で見る）。
    expect(listingMismatch(read('README.md'), guideFiles), '入口の一覧と実ファイルが食い違う').toEqual({
      unlisted: [],
      ghost: [],
    });
  });

  // ⚠️ **入口が長くなったら意味が無い**＝「巨大な正典を読み直さない」ためのものなので、
  //    1回の作業で読む量（入口＋ガイド1本）を実数で縛る。
  it('入口とガイドは短いまま', () => {
    expect(tooLong(guideFiles.map((f) => [f, read(f).length] as const)), '入口資料が肥大化している').toEqual([]);
  });

  it('挙げているコードのありかが実在する', () => {
    const missing = guideFiles.flatMap((f) => missingPaths(read(f), existsSync).map((p) => `${f} -> ${p}`));
    expect(missing, '実在しないパスを指している').toEqual([]);
  });

  it('posix 区切りのリンクだけを書く（Windows 区切りを混ぜない）', () => {
    const bad: string[] = [];
    for (const f of guideFiles) {
      for (const m of read(f).matchAll(/\]\((?!https?:)([^)\s]+)\)/g)) {
        if (m[1]!.includes(String.fromCharCode(92))) bad.push(`${f} -> ${m[1]}`);
      }
    }
    expect(bad, 'Windows 区切りのリンク').toEqual([]);
    expect(posix.sep).toBe('/');
  });
});

// ⚠️ **門番自身の検査**＝いまの資料が正しい間は、規則を壊しても上の検査は緑のまま。
//    わざと壊した入力を規則へ通して、**見つけること**まで固定する。
describe('門番自身の検査（わざと壊した入力を通す）', () => {
  const sections = new Map([['11', new Set(['7', '7.6'])]]);

  it('見出しの節も、太字の小節も拾う', () => {
    const s = sectionsOf('## 7. フィールド表\n### 7.6 Timeline\n**7.1.1 videoSettings**: x\n## 12. 画面\n');
    expect([...s].sort()).toEqual(['12', '7', '7.1.1', '7.6']);
  });

  it('太字の小節を落とすと、実在するのに「無い」と言うことになる', () => {
    expect(sectionsOf('**7.1.1 videoSettings**: x').has('7.1.1')).toBe(true);
  });

  it('指し先が無いリンクを見つける', () => {
    expect(brokenLinks('[x](../yuko_recruit_docs/NO_SUCH_FILE.md)', GUIDE_DIR)).toEqual([
      '../yuko_recruit_docs/NO_SUCH_FILE.md',
    ]);
  });

  it('生きているリンクは見つけない（嘘の赤を出さない）', () => {
    expect(brokenLinks('[x](../yuko_recruit_docs/06_UI_SPEC.md)', GUIDE_DIR)).toEqual([]);
  });

  it('直前に資料名がある § は、その資料へ結ぶ', () => {
    expect(citationsIn('11 §7.6 を読む')[0]).toMatchObject({ owner: '11', section: '7.6' });
  });

  it('同じ行に資料が1つだけなら、その資料へ結ぶ', () => {
    expect(citationsIn('| 06_UI_SPEC.md | **§2 UI基本方針** |')[0]).toMatchObject({ owner: '06', section: '2' });
  });

  it('CLAUDE.md の節も結ぶ', () => {
    expect(citationsIn('CLAUDE.md §2-5 を守る')[0]).toMatchObject({ owner: 'CLAUDE.md', section: '2' });
  });

  it('どの資料か決まらない § は結ばない（読む側も開き先が分からない）', () => {
    expect(citationsIn('§7 を読む')[0]).toMatchObject({ owner: null });
    expect(citationsIn('11 §7 と 06 §9 の話で、あとは §3 も')[2]).toMatchObject({ owner: null });
  });

  it('その資料に無い節を見つける', () => {
    expect(badCitations('11 §99 を読む', sections)).toEqual(['1: 11 §99（無い）']);
  });

  it('どの資料か分からない § を見つける', () => {
    expect(badCitations('§7 を読む', sections)).toEqual(['1: §7（どの資料か分からない）']);
  });

  it('実在する節は見つけない（嘘の赤を出さない）', () => {
    expect(badCitations('11 §7.6 を読む', sections)).toEqual([]);
  });

  it('実在しないコードのありかを見つける', () => {
    expect(missingPaths('門番は `src/test/no_such.ts`', () => false)).toEqual(['src/test/no_such.ts']);
  });

  it('実在するありかは見つけない（嘘の赤を出さない）', () => {
    expect(missingPaths('門番は `src/app/errorStateTable.test.ts`', () => true)).toEqual([]);
  });

  it('あたりを示す書き方（`*`）は実在を問わない', () => {
    expect(missingPaths('画面は `src/app/**`', () => false)).toEqual([]);
  });

  it('一覧に載っていないガイドを見つける', () => {
    expect(listingMismatch('[a](a.md)', ['README.md', 'a.md', 'b.md']).unlisted).toEqual(['b.md']);
  });

  it('一覧にあるのに無いガイドを見つける', () => {
    expect(listingMismatch('[a](a.md) [b](b.md)', ['README.md', 'a.md']).ghost).toEqual(['b.md']);
  });

  it('一致しているときは何も言わない', () => {
    expect(listingMismatch('[a](a.md)', ['README.md', 'a.md'])).toEqual({ unlisted: [], ghost: [] });
  });

  it('長すぎる入口資料を見つける（入口とガイドで上限が違う）', () => {
    expect(tooLong([['README.md', MAX_CHARS.readme + 1]])).toEqual([`README.md=${MAX_CHARS.readme + 1}`]);
    expect(tooLong([['ui_change.md', MAX_CHARS.guide + 1]])).toEqual([`ui_change.md=${MAX_CHARS.guide + 1}`]);
    // 入口の上限をガイドにも当てると、この1本を見逃す。
    expect(tooLong([['ui_change.md', MAX_CHARS.readme - 1]])).toEqual([`ui_change.md=${MAX_CHARS.readme - 1}`]);
  });

  it('上限ちょうどは通す（境界で切らない）', () => {
    expect(tooLong([['README.md', MAX_CHARS.readme], ['ui_change.md', MAX_CHARS.guide]])).toEqual([]);
  });

  // ⚠️ **上限そのものを実数で固定する**＝上限との相対で書いた検査は、上限を緩めると**一緒に緩む**
  //    （実際に「肥大化しても何も言わない」変異が生き残った）。ここを変えるなら意図して変える。
  it('上限は入口 6,000 字・ガイド 4,000 字', () => {
    expect(MAX_CHARS).toEqual({ readme: 6000, guide: 4000 });
  });
});
