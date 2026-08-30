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
// ⚠️ **いまは 0 件にできない**＝同じ形が既に各所にあり（多くは同じ取り違え）、一掃すると
// この監査PRの範囲を大きく超える。よって**現状を基準として据え置き、ずれたら落とす**（ratchet）。
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
 * ファイルごとの現状（＝これ以上増やさない上限）。
 *
 * ⚠️ **ファイル名だけの許可リストにしない**＝いちばん触るファイル（`uiLabels.ts`・
 * `TimelineProjectScreen.tsx`）ほど載ることになり、**そこでの再発を素通し**する。数で持つ。
 */
// 凍結時点の数（合計 39 件・11ファイル）。⚠️ **直したら数も一緒に下げる**（この1行が「何件直したか」の記録）。
// #923 で domain / renderer / infrastructure の19件を 0 にした（残りは app 配下）。
const BASELINE: Record<string, number> = {
  'app/components/ColorPicker.tsx': 1,
  'app/components/FreeLayoutOverlay.tsx': 1,
  'app/components/layout/PanelLayoutView.tsx': 1,
  'app/hooks/keyboardShortcut.ts': 1,
  'app/screens/LooksEditScreen.tsx': 2,
  'app/screens/SceneEditScreen.tsx': 1,
  'app/screens/TimelineProjectScreen.tsx': 16,
  'app/store/assetImport.ts': 1,
  'app/store/projectStore.ts': 3,
  'app/store/timelineStore.ts': 11,
  'app/timelinePanels.ts': 1,
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
