// 正典の索引が**二重管理へ戻らない**ことの門番（2026-09-08 の資料整理）。
//
// ⚠️ **`CLAUDE.md` は毎セッション全文が読まれる**＝ここが太ると、**何を書く前でも**費用がかかる。
// 以前は §11 が 42,288字（同ファイルの83%）で、中身は 38本の ADR の要約＝**ADR 本体との二重管理**だった
// （状態を動かすたびに3か所を直す必要があった）。整理して索引へ戻したので、**戻らないように**機械で見る。
//
// ⚠️ **中身の正しさは見ない**＝ここが見るのは「太っていない」「一覧が全部そろっている」
// 「状態を二重に持っていない」「例示の帯が生きている」の4つ。正典との整合は `/canon-check`。
//
// ⚠️ **門番自身にも穴が空く**（α-7 で20件）＝判定は純粋関数に出し、下の「門番自身の検査」で
// **わざと壊した入力**を通して、見つけることまで固定する。
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const CLAUDE = 'CLAUDE.md';
const ADR_DIR = 'docs/yuko_recruit_docs/adr';
const DOCS_DIR = 'docs/yuko_recruit_docs';

/**
 * `CLAUDE.md` に許す長さ。
 *
 * ⚠️ **実数で縛る**＝「短く保つ」と書くだけでは、1行ずつ足されて元へ戻る（実際に 50,916字まで育った）。
 * 上限に当たったら**まず ADR 本体へ移せないかを考える**（増やすのは最後の手段）。
 */
export const CLAUDE_MAX_CHARS = 16000;

/** 状態の語（`CLAUDE.md` が持ってはいけないもの＝一覧は `adr/README.md` に1つ）。 */
const STATUS_WORDS = ['Accepted', 'Proposed', 'Superseded', 'Rejected'];

/** ADR ファイルの番号（雛形 `0000` は除く）。 */
export function adrNumbers(files: readonly string[]): string[] {
  return files
    .filter((f) => /^\d{4}-.*\.md$/.test(f) && !f.startsWith('0000'))
    .map((f) => f.slice(0, 4))
    .sort();
}

/**
 * 行に**最初に現れる**状態の語（無ければ `null`）。
 *
 * ⚠️ **「最初の語」で見る**＝本文は `**一部 Superseded by …**／もとは Accepted（…）` のように
 * 経緯を続けて書く流儀があり、語を全部拾うと必ず食い違う。README も同じ流儀なので、
 * **先頭の語**どうしなら突き合わせられる。
 */
export function firstStatusWord(line: string): string | null {
  let best: string | null = null;
  let at = Number.POSITIVE_INFINITY;
  for (const w of STATUS_WORDS) {
    const i = line.indexOf(w);
    if (i >= 0 && i < at) {
      at = i;
      best = w;
    }
  }
  return best;
}

/**
 * **ADR 本文の状態**と **`adr/README.md` の状態欄**が食い違っている番号（`CLAUDE.md §11`）。
 *
 * ⚠️ **正典は「2点を同時に直す」と決めているのに、機械は見ていなかった**（レビュー由来 ℹ️・2026-09-10）
 * ＝この門番が見ていたのは「一覧に**載っているか**」（番号だけ）で、**状態が合っているか**は
 * 誰も見ていなかった。実際 ADR-0032 の Accepted 化で片方だけ動いた事故が起きている
 *（このファイルの冒頭がその経緯を書いている）のに、いまも捕まえられない状態だった。
 *
 * @param bodies `[ファイル名, 本文]` の一覧（`0000-template.md` は呼ぶ側で外す）
 */
export function adrStatusMismatch(
  bodies: readonly (readonly [string, string])[],
  readme: string,
): string[] {
  const listed = new Map<string, string | null>();
  for (const line of readme.split("\n")) {
    const m = /^\|\s*\[(\d{4})\]\(/.exec(line);
    if (!m) continue;
    const cells = line.split("|");
    // 状態欄は**最後の列**（一覧の形＝`| 番号 | 題 | 状態 |`）。
    listed.set(m[1]!, firstStatusWord(cells[cells.length - 2] ?? ""));
  }
  const out: string[] = [];
  for (const [file, text] of bodies) {
    const n = /^(\d{4})-/.exec(file)?.[1];
    if (n == null || file.startsWith("0000")) continue;
    const body = firstStatusWord(text.split("\n").find((l) => l.startsWith("- **状態**")) ?? "");
    const row = listed.get(n) ?? null;
    if (body !== row) out.push(`${n} 本文=${body ?? "無し"} / README=${row ?? "無し"}`);
  }
  return out;
}

/**
 * **実装が ADR の状態を書き写している行**（`CLAUDE.md §11`＝状態を持つのは2点だけ）。
 *
 * ⚠️ **実際に3点目が居た**（レビュー由来 🔴・2026-09-10）＝`appSettings.ts` の説明が
 * 「ADR-0039 は Proposed＝…利用者確認待ち」と書いており、状態を動かした瞬間に**嘘になった**。
 * ⚠️ **ADR を参照すること自体は禁じない**＝禁じるのは「ADR の番号と状態の語が**同じ行に**並ぶ」形。
 * `ADR-0033 結果・影響` のような参照はそのまま書けるので、誤検出にならない。
 *
 * @param entries `[ファイル名, 本文]` の一覧
 */
export function adrStatusInCode(
  entries: readonly (readonly [string, string])[],
): string[] {
  const out: string[] = [];
  for (const [file, text] of entries) {
    text.split("\n").forEach((line, i) => {
      if (!/ADR-\d{4}/.test(line)) return;
      const word = STATUS_WORDS.find((w) => line.includes(w));
      if (word != null) out.push(`${file}:${i + 1} 「${word}」← ${line.trim()}`);
    });
  }
  return out;
}

/** `adr/README.md` の一覧に載っている番号。 */
export function listedNumbers(readme: string): string[] {
  return [...new Set([...readme.matchAll(/\[(\d{4})\]\(/g)].map((m) => m[1]!))].sort();
}

/**
 * `CLAUDE.md` の中で、ADR の**状態**を書いてしまっている行。
 *
 * ⚠️ **状態は `adr/README.md` に1つだけ**＝ここにも書くと、動かすたびに2か所を直すことになり
 * （以前は3か所）、**片方だけ直った状態**が生まれる（ADR-0032 の Accepted 化で実際に起きた）。
 */
export function statusLinesIn(text: string): string[] {
  const out: string[] = [];
  text.split('\n').forEach((line, i) => {
    if (!/ADR-\d{4}|adr\/\d{4}/.test(line)) return;
    if (STATUS_WORDS.some((w) => line.includes(`**${w}**`))) out.push(`${i + 1}: ${line.slice(0, 60)}`);
  });
  return out;
}

/**
 * 帯（正典かどうかの断り）と、作業ガイドへの導線を持たない資料。
 *
 * ⚠️ **「引用行があること」で見ない**＝導線の行も `>` で始まるので、**帯だけ落としても通ってしまう**
 * （変異チェックで生き残った）。帯は `> ⚠️ **…` の形と決めて、その形で探す。
 */
export function docsWithoutBanner(entries: readonly (readonly [string, string])[]): string[] {
  return entries
    .filter(([, text]) => {
      const head = text.split('\n').slice(0, 8);
      const hasBanner = head.some((l) => l.startsWith('> ⚠️ **'));
      const hasGuide = head.some((l) => l.includes('ai_work_guides'));
      return !hasBanner || !hasGuide;
    })
    .map(([name]) => name);
}

/** 移設の段の目印（`CLAUDE.md` のどの節から来たか）。 */
const MOVED_MARKERS = ['から移した要約・追補', 'から移した注記'];

/**
 * 同じ移設の段が二度以上ある ADR（`名前=目印x回数`）。
 *
 * ⚠️ **目印ごとに数える**＝§10 と §11 の両方から受け取った ADR がある（0012・0018・0032）ので、
 * 「から移した」の総数で見ると**正しいものを重複と呼ぶ**（嘘の赤）。
 */
export function duplicatedMovedSections(entries: readonly (readonly [string, string])[]): string[] {
  const out: string[] = [];
  for (const [name, text] of entries) {
    for (const marker of MOVED_MARKERS) {
      const n = text.split(marker).length - 1;
      if (n > 1) out.push(`${name}=${marker}x${n}`);
    }
  }
  return out;
}

/**
 * 一覧と実ファイルの食い違い（両向き）。
 *
 * ⚠️ **片側だけで見ない**＝「一覧に無い ADR」（誰も見つけられない）と
 * 「一覧にあるのに無い ADR」（行き止まり）は別の壊れ方。
 */
export function listingGap(actual: readonly string[], listed: readonly string[]): { 一覧に無い: string[]; 一覧にあるのに無い: string[] } {
  return {
    一覧に無い: actual.filter((n) => !listed.includes(n)),
    一覧にあるのに無い: listed.filter((n) => !actual.includes(n)),
  };
}

/**
 * `docs/` の中の相対リンクのうち、指し先が無いもの（`ファイル -> 指し先`）。
 *
 * ⚠️ **資料どうしのリンクは誰も確かめていなかった**＝2026-09-08 の整理でまとめて見たところ、
 * ADR-0032 の「関連」に**存在しないファイル名**が2つあった（`0008-free-layout.md`／`0007-ai-pipeline.md`）。
 * 読む側は「そこに書いてある」と信じて開くので、**指し先が無いリンクは無いより悪い**。
 */
export function brokenDocLinks(files: readonly (readonly [string, string])[], exists: (p: string) => boolean): string[] {
  const out: string[] = [];
  for (const [path, text] of files) {
    const dir = path.slice(0, path.lastIndexOf('/'));
    for (const m of text.matchAll(/\]\((?!https?:|#)([^)#\s]+)(?:#[^)]*)?\)/g)) {
      if (!exists(`${dir}/${m[1]!}`)) out.push(`${path} -> ${m[1]}`);
    }
  }
  return out;
}

const adrFiles = readdirSync(ADR_DIR);
const claude = readFileSync(CLAUDE, 'utf8');

describe('正典の索引（二重管理へ戻らない）', () => {
  it('CLAUDE.md は毎セッション読める大きさに収まっている', () => {
    expect(claude.length, `CLAUDE.md=${claude.length}字（上限 ${CLAUDE_MAX_CHARS}）`).toBeLessThanOrEqual(
      CLAUDE_MAX_CHARS,
    );
  });

  // 片側ずつ書くと、片方の行を消しても**もう片方が緑のまま**になる（両向きを1つの比較で見る）。
  it('ADR の一覧（adr/README.md）に、全 ADR が載っている', () => {
    const actual = adrNumbers(adrFiles);
    const listed = listedNumbers(readFileSync(`${ADR_DIR}/README.md`, 'utf8'));
    expect(listingGap(actual, listed), 'ADR の一覧と実ファイルが食い違う').toEqual({ 一覧に無い: [], 一覧にあるのに無い: [] });
  });

  // ⚠️ **状態を CLAUDE.md へ書き戻さない**＝索引が2つに増えると、片方だけ直った状態が生まれる。
  it('CLAUDE.md は ADR の状態を持たない（一覧は adr/README.md に1つ）', () => {
    expect(statusLinesIn(claude), 'CLAUDE.md に ADR の状態が書かれている').toEqual([]);
  });

  it('CLAUDE.md が名指しする ADR は実在する', () => {
    const nums = adrNumbers(adrFiles);
    const named = [...new Set([...claude.matchAll(/ADR-(\d{4})/g)].map((m) => m[1]!))];
    expect(named.filter((n) => !nums.includes(n)), '実在しない ADR を名指ししている').toEqual([]);
    expect(named.length, 'いつも効く決定が1つも書かれていない').toBeGreaterThan(5);
  });

  // ⚠️ **例示の資料には帯を立てる**＝`CLAUDE.md §0` に書いてあっても、
  //    **ファイルを直接開いた人には見えない**（`03`・`07` は正典と食い違う JSON を持つ）。
  it('01〜10 は「何であるか」の帯と、作業ガイドへの導線を持つ', () => {
    const names = readdirSync(DOCS_DIR).filter((f) => /^(0[1-9]|10)_.*\.md$/.test(f));
    expect(names.length, '対象の資料が見つからない').toBe(10);
    const entries = names.map((f) => [f, readFileSync(`${DOCS_DIR}/${f}`, 'utf8')] as const);
    expect(docsWithoutBanner(entries), '帯か導線が無い資料').toEqual([]);
  });

  // ⚠️ **資料どうしのリンクを機械で見る**＝整理でまとめて見たら、既に2つ壊れていた。
  it('docs の中の相対リンクは、指し先が実在する', () => {
    const files: [string, string][] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(`${dir}/${e.name}`);
        else if (e.name.endsWith('.md')) files.push([`${dir}/${e.name}`, readFileSync(`${dir}/${e.name}`, 'utf8')]);
      }
    };
    walk('docs');
    expect(files.length, '資料が見つからない').toBeGreaterThan(30);
    expect(brokenDocLinks(files, existsSync), '指し先が無いリンク').toEqual([]);
  });

  // ⚠️ **状態は2点を同時に直す**（`CLAUDE.md §11`）＝**その2点が合っているか**を機械で見る。
  // これが無かったので、ADR-0032 の Accepted 化で片方だけ動いた事故を捕まえられなかった
  //（このファイルの冒頭がその経緯を書いているのに、検査は番号の有無しか見ていなかった）。
  it('ADR 本文の状態と、一覧の状態欄が合っている', () => {
    const bodies = adrFiles
      .filter((f) => /^\d{4}-.*\.md$/.test(f))
      .map((f) => [f, readFileSync(`${ADR_DIR}/${f}`, 'utf8')] as const);
    expect(
      adrStatusMismatch(bodies, readFileSync(`${ADR_DIR}/README.md`, 'utf8')),
      '状態は ADR 本文と `adr/README.md` の2点を同時に直してください（`CLAUDE.md §11`）',
    ).toEqual([]);
  });

  // ⚠️ **3点目を作らない**（`CLAUDE.md §11`）＝実装の説明に状態を書き写すと、状態を動かした
  // 瞬間に嘘になる（実際に `appSettings.ts` がそうなっていた＝レビュー由来 🔴）。
  it('実装が ADR の状態を書き写していない', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) return walk(p);
        return /\.(ts|tsx|rs)$/.test(e.name) ? [p] : [];
      });
    // ⚠️ **この門番のファイルは除く**（状態の語を一覧として持っているのはここ＝定義元）。
    const files = [...walk('src'), ...walk('src-tauri/src')].filter(
      (p) => !p.endsWith('canonIndexGuard.test.ts'),
    );
    // ⚠️ **両方を見ていることを確かめる**＝片方だけ歩く形に戻しても、いまのコードには
    // 3点目が無いので**赤くならない**（変異チェックで生き残った）。走査そのものを見る。
    expect(files.some((p) => p.endsWith('.ts')), '画面側を1つも見ていない').toBe(true);
    expect(files.some((p) => p.endsWith('.rs')), 'Rust 側を1つも見ていない').toBe(true);
    const entries = files.map((p) => [p, readFileSync(p, 'utf8')] as const);
    expect(
      adrStatusInCode(entries),
      '状態を持つのは ADR 本文と `adr/README.md` の2点だけです（`CLAUDE.md §11`）',
    ).toEqual([]);
  });

  // ⚠️ **移した段を二度足さない**＝同じ移設を再実行すると、ADR の末尾に同じ段が積み重なる。
  it('ADR へ移した段は、1ファイルにつき高々1つ', () => {
    const entries = adrFiles
      .filter((f) => f.endsWith('.md'))
      .map((f) => [f, readFileSync(`${ADR_DIR}/${f}`, 'utf8')] as const);
    expect(duplicatedMovedSections(entries), '同じ段が二度足されている').toEqual([]);
  });
});

// ⚠️ **門番自身の検査**＝いまの資料が正しい間は、規則を壊しても上の検査は緑のまま。
describe('門番自身の検査（わざと壊した入力を通す）', () => {
  it('状態が片方だけ動いたら見つける（2点同時の規則）', () => {
    const readme = '| 番号 | 題 | 状態 |\n|---|---|---|\n| [0001](0001-a.md) | あ | **Accepted**（…） |\n';
    // 揃っている＝通す。
    expect(adrStatusMismatch([['0001-a.md', '- **状態**: Accepted（…）\n']], readme)).toEqual([]);
    // 本文だけ動かした＝見つける（これが実際に起きた事故の形）。
    expect(adrStatusMismatch([['0001-a.md', '- **状態**: Proposed\n']], readme)).toHaveLength(1);
    // 本文に状態の行が無い＝見つける（黙って空にしない）。
    expect(adrStatusMismatch([['0001-a.md', '# ADR-0001\n']], readme)).toHaveLength(1);
    // 雛形は数えない。
    expect(adrStatusMismatch([['0000-template.md', '- **状態**: Proposed\n']], readme)).toEqual([]);
  });

  it('実装が状態を書き写したら見つける（参照そのものは通す）', () => {
    expect(adrStatusInCode([['a.ts', '// ADR-0039 は Proposed なので…\n']])).toHaveLength(1);
    // ⚠️ **参照だけなら通す**＝これを赤くすると、ADR を引くコメントが書けなくなる。
    expect(adrStatusInCode([['a.ts', '// 覚えの置き場（ADR-0033 結果・影響）\n']])).toEqual([]);
    // 状態の語だけ・ADR の番号だけ、では赤くしない。
    expect(adrStatusInCode([['a.ts', '// Accepted な案\n// ADR-0039 の決定3\n']])).toEqual([]);
  });

  it('一覧の状態欄は**最後の列**で見る（題に状態の語が混ざっても取り違えない）', () => {
    // ⚠️ 行まるごとで見ると、題に出てきた語を状態と読んでしまう。
    const readme = '| [0001](0001-a.md) | Accepted な話をした件 | **Proposed**（…） |\n';
    expect(adrStatusMismatch([['0001-a.md', '- **状態**: Proposed\n']], readme)).toEqual([]);
    expect(adrStatusMismatch([['0001-a.md', '- **状態**: Accepted\n']], readme)).toHaveLength(1);
  });

  it('経緯を続けて書いてある行でも、先頭の語で見る', () => {
    // ⚠️ この流儀は実在する（`0018` / `0023` / `0025`）＝語を全部拾うと必ず食い違う。
    expect(firstStatusWord('- **状態**: **一部 Superseded by …**／もとは Accepted（…）')).toBe('Superseded');
    expect(firstStatusWord('- **状態**: **Accepted**（…設計は Proposed）')).toBe('Accepted');
    expect(firstStatusWord('- **日付**: 2026-09-10')).toBeNull();
  });

  it('雛形（0000）は ADR の数に入れない', () => {
    expect(adrNumbers(['0000-template.md', '0001-a.md', 'README.md'])).toEqual(['0001']);
  });

  it('一覧の番号を拾う（重複は1つに畳む）', () => {
    expect(listedNumbers('| [0001](0001-a.md) | x |\n| [0001](0001-a.md) | y |\n| [0002](0002-b.md) | z |')).toEqual([
      '0001',
      '0002',
    ]);
  });

  it('一覧に無い ADR を見つける', () => {
    expect(listingGap(['0001', '0002'], ['0001']).一覧に無い).toEqual(['0002']);
  });

  it('一覧にあるのに無い ADR を見つける', () => {
    expect(listingGap(['0001'], ['0001', '0009']).一覧にあるのに無い).toEqual(['0009']);
  });

  it('そろっていれば何も言わない（嘘の赤を出さない）', () => {
    expect(listingGap(['0001'], ['0001'])).toEqual({ 一覧に無い: [], 一覧にあるのに無い: [] });
  });

  it('ADR の状態が書かれた行を見つける', () => {
    expect(statusLinesIn('- **ADR-0032** これは **Accepted** です')).toHaveLength(1);
  });

  it('ADR に触れていない行の状態語は見ない（嘘の赤を出さない）', () => {
    expect(statusLinesIn('この案は **Accepted** になった')).toEqual([]);
  });

  it('ADR に触れていても状態語が無ければ見ない', () => {
    expect(statusLinesIn('- **ADR-0032** 場面形式は凍結')).toEqual([]);
  });

  it('帯も導線も無い資料を見つける', () => {
    expect(docsWithoutBanner([['x.md', '# 題\n\n本文']])).toEqual(['x.md']);
  });

  it('帯があっても導線が無ければ見つける', () => {
    expect(docsWithoutBanner([['x.md', '# 題\n\n> ⚠️ **例示です**\n']])).toEqual(['x.md']);
  });

  it('帯と導線の両方があれば見つけない（嘘の赤を出さない）', () => {
    expect(docsWithoutBanner([['x.md', '# 題\n\n> ⚠️ **例示です**\n> ../ai_work_guides/README.md から選ぶ\n']])).toEqual(
      [],
    );
  });

  // ⚠️ 導線の行も `>` で始まるので、「引用行があるか」で見ると**帯だけ落としても通る**。
  it('導線だけ残して帯を落とした資料を見つける', () => {
    expect(docsWithoutBanner([['x.md', '# 題\n\n例示です\n> ../ai_work_guides/README.md から選ぶ\n']])).toEqual([
      'x.md',
    ]);
  });

  it('同じ段が二度ある ADR を見つける', () => {
    expect(duplicatedMovedSections([['a.md', 'から移した要約・追補\nから移した要約・追補']])).toEqual([
      'a.md=から移した要約・追補x2',
    ]);
  });

  it('1つだけなら見つけない（嘘の赤を出さない）', () => {
    expect(duplicatedMovedSections([['a.md', 'から移した要約・追補']])).toEqual([]);
  });

  // ⚠️ §10 と §11 の両方から受け取った ADR がある＝**別の目印は別に数える**（0012・0018・0032）。
  it('別の節から来た段が並んでいても重複と呼ばない', () => {
    expect(duplicatedMovedSections([['a.md', 'から移した要約・追補\nから移した注記']])).toEqual([]);
  });

  it('指し先が無い資料のリンクを見つける', () => {
    expect(brokenDocLinks([['docs/a/x.md', '[y](y.md)']], () => false)).toEqual(['docs/a/x.md -> y.md']);
  });

  it('生きているリンクは見つけない（嘘の赤を出さない）', () => {
    expect(brokenDocLinks([['docs/a/x.md', '[y](y.md)']], (p) => p === 'docs/a/y.md')).toEqual([]);
  });

  it('外部と見出し内リンクは見ない', () => {
    expect(brokenDocLinks([['docs/a/x.md', '[y](https://example.com) [z](#midashi)']], () => false)).toEqual([]);
  });

  it('上限は 16,000 字（相対で書かず実数で固定する）', () => {
    expect(CLAUDE_MAX_CHARS).toBe(16000);
  });
});
