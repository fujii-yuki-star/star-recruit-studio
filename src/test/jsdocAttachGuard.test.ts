// 説明文（JSDoc）を**別の宣言から奪わない**ための門番（α-6 出口監査・再発防止）。
//
// 既存の `export const X` の**すぐ上**に新しい定義を差し込むと、`X` に付いていた `/** … */` が
// 差し込んだ側へ移り、`X` は説明を失う。**このセッションだけで 11 回起きた**（`fitLabel`／
// `editBlockedMessage`／`UNKNOWN_FONT_HINT`／`BRAND_LOGO_NOT_APPLIED_MESSAGE`／`timelineAudioRuns` ほか）。
// ⚠️ **型でも lint でも守れない**＝どちらの並びも文法として正しく、動作も変わらない。だから機械で留める。
//
// 見るのは「**説明文の直後にまた説明文が来る**」形だけ。宣言に付けるつもりの文が2つ並んだら、
// 後ろの1つしか宣言に付かない（＝前の1つは宙に浮いている）。
//
// ⚠️ **いまは 0 件**（#923 で一掃）。据え置きの ratchet として作ったが、記録が空になったので
// **実質「1件でも出たら落ちる」門番**になっている。
// ⚠️ **「増えたら」ではなく「ずれたら」落とす**（PR #922 範囲5 レビュー ℹ️）＝増える側だけ見ると、
// 直しても**基準が下がらないまま緑**＝減ったことが記録に残らず、次に増えたぶんを**直した枠が吸収**して
// しまう（門番が静かに緩む）。直したら基準の数も一緒に下げる＝**その1行が「何件直したか」の記録**になる。
import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** その本文の中で「説明文の直後にまた説明文」が何回あるか。 */
export function detachedDocCount(src: string): number {
  const lines = src.split('\n');
  let n = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    // 説明文の終わり（複数行の `*/` か、1行で閉じた `/** … */`）。
    const closes = t === '*/' || (t.startsWith('/**') && t.endsWith('*/'));
    if (!closes) continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j += 1;
    if (j < lines.length && lines[j].trim().startsWith('/**')) n += 1;
  }
  return n;
}

/**
 * ファイルごとの上限。**0 件が正しい状態**＝#923 で 65 件すべてを片づけたので空にしてある
 * （内訳＝domain/renderer/infrastructure 26・store/hooks/panels 17・画面 22）。
 *
 * ⚠️ **ファイル名だけの許可リストにしない**＝いちばん触るファイル（`uiLabels.ts`・
 * `TimelineProjectScreen.tsx`）ほど載ることになり、**そこでの再発を素通し**する。数で持つ。
 *
 * ⚠️ **空のまま保つ**＝新しく1件でも増えたら落ちる。直すときは「1つ下へ移す」ではなく、
 * **孤児の中身を読んで本来の持ち主を特定する**（`fitLabel` のように**170行離れている**ことがある。
 * 指す先が消えていたら消す・同じ宣言の話が2つ並んでいたら1つにする・節の見出しなら `//` にする）。
 */
const BASELINE: Record<string, number> = {
};

describe('説明文を別の宣言から奪わない（再発防止の門番）', () => {
  it('説明文が2つ並んだ箇所が、記録した数と一致する', () => {
    const drifted: string[] = [];
    const seen = new Set<string>();
    for (const p of sourceFiles(SRC)) {
      const rel = p.slice(SRC.length + 1).split(sep).join('/');
      seen.add(rel);
      const n = detachedDocCount(readFileSync(p, 'utf8'));
      const want = BASELINE[rel] ?? 0;
      // ⚠️ 増えた＝**差し込んだ位置の1つ上**を見る。奪った説明文を、本来の宣言のすぐ上へ戻す。
      if (n > want) drifted.push(`${rel}: ${n} 件（記録は ${want} 件）＝説明文を奪った`);
      // ⚠️ 減った＝直したのに記録が古い。`BASELINE` の数を下げる（消えたら行ごと消す）。
      if (n < want) drifted.push(`${rel}: ${n} 件（記録は ${want} 件）＝記録を下げる`);
    }
    // 消えた・名前が変わったファイルの記録も残さない（数えられないものを守っている顔をしない）。
    for (const rel of Object.keys(BASELINE)) {
      if (!seen.has(rel)) drifted.push(`${rel}: このファイルが無い＝記録から消す`);
    }
    expect(drifted).toEqual([]);
  });

  it('門番が実際に効いている（走査と判定が壊れたら落ちる）', () => {
    // ⚠️ 上の検査は**何も拾わなくても緑**になる＝壊れたことに気づけない。自分自身を確かめる。
    expect(sourceFiles(SRC).length).toBeGreaterThan(100);
    expect(detachedDocCount('/** a */\n/** b */\nexport const x = 1;\n')).toBe(1);
    expect(detachedDocCount('/**\n * a\n */\n\n/** b */\nexport const x = 1;\n')).toBe(1);
    // 正しい並び（説明文の直後が宣言）は拾わない。
    expect(detachedDocCount('/** a */\nexport const x = 1;\n/** b */\nexport const y = 2;\n')).toBe(0);
    // ふつうの行コメントや、宣言の中の説明文は拾わない。
    expect(detachedDocCount('interface X {\n  /** a */\n  a: string;\n  /** b */\n  b: string;\n}\n')).toBe(0);
    expect(detachedDocCount('// a\n// b\nexport const x = 1;\n')).toBe(0);
  });
});

/**
 * Rust 側の同じ形（#263）。
 *
 * ⚠️ **同じ間違いを Rust でもやった**＝`#[test]` と関数の間に新しい関数を差し込み、
 * **`#[test]` が差し込んだ側へ移って、元のテストが登録されなくなっていた**（走らないのに緑）。
 * TS 側は説明文が浮くだけだが、Rust は**属性が動く**ので**守りが静かに外れる**＝こちらのほうが重い。
 * ⚠️ **型でも lint でも守れない**（どちらの並びも文法として正しい）。
 *
 * 見るのは2つ：
 * - **属性（`#[…]`）の直後に説明文（`///`）**＝属性と、その持ち主のあいだに割り込んだ形
 * - **説明文が2つ並ぶ**＝TS 側と同じ（前の1つが宙に浮く）
 */
export function detachedRustDocCount(src: string): number {
  const lines = src.split('\n');
  let n = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j += 1;
    if (j >= lines.length) continue;
    const next = lines[j].trim();
    // 属性の直後に説明文＝割り込み。
    if (t.startsWith('#[') && next.startsWith('///')) n += 1;
    // 説明文ブロックの終わり（次の行が `///` でない）の後に、空行を挟んでまた説明文。
    else if (t.startsWith('///') && !(lines[i + 1] ?? '').trim().startsWith('///') && next.startsWith('///') && j > i + 1) n += 1;
  }
  return n;
}

describe('Rust でも説明文・属性を別の宣言から奪わない（#263）', () => {
  it('属性の直後に説明文が来る箇所は無い', () => {
    const dir = join(process.cwd(), 'src-tauri', 'src');
    const files = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.rs'))
      .map((e) => join(dir, e.name));
    expect(files.length).toBeGreaterThan(3); // 走査が空振りしていないこと
    const drifted = files
      .map((p) => [p, detachedRustDocCount(readFileSync(p, 'utf8'))] as const)
      .filter(([, n]) => n > 0)
      .map(([p, n]) => `${p.split(sep).pop()}: ${n} 件`);
    expect(drifted).toEqual([]);
  });

  it('門番が実際に効いている（走査と判定が壊れたら落ちる）', () => {
    // 私が実際にやった形＝`#[test]` と関数の間に差し込む。
    expect(detachedRustDocCount('#[test]\n/// あたらしい説明\nfn a() {}\n')).toBe(1);
    // 説明文が2つ並ぶ。
    expect(detachedRustDocCount('/// a\n\n/// b\nfn x() {}\n')).toBe(1);
    // 正しい並びは拾わない（説明→属性→宣言）。
    expect(detachedRustDocCount('/// a\n#[test]\nfn x() {}\n')).toBe(0);
    // 続きの説明文（同じブロック）は拾わない。
    expect(detachedRustDocCount('/// a\n/// b\nfn x() {}\n')).toBe(0);
    // 属性が続くのも拾わない。
    expect(detachedRustDocCount('/// a\n#[cfg(test)]\n#[test]\nfn x() {}\n')).toBe(0);
  });
});
