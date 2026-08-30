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
// この監査PRの範囲を大きく超える。よって**現状を基準として据え置き、増えたら落とす**（ratchet）。
// 直したら基準の数を下げること（下げ忘れても緑のままなので、下の「効いている」検査で門番自体を守る）。
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
// 凍結時点の数（合計 65 件・30ファイル）。⚠️ **`uiLabels.ts` と `domain/timeline/export.ts` は
// このPRで 0 にした**＝文言の単一の参照元と、書き出しの入口だから先に片づけた。
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
  'domain/asset/relink.test.ts': 1,
  'domain/constants.ts': 1,
  'domain/enums.ts': 1,
  'domain/project/compileTimeline.ts': 1,
  'domain/project/sceneTransitions.ts': 2,
  'domain/project/types.ts': 1,
  'domain/template/layerOps.ts': 1,
  'domain/timeline/bake.ts': 1,
  'domain/timeline/clipEdge.ts': 1,
  'domain/timeline/edit.ts': 5,
  'domain/timeline/split.ts': 1,
  'domain/voice/readingDict.test.ts': 1,
  'domain/voice/readingDict.ts': 1,
  'infrastructure/voiceProviders/readingDictSync.test.ts': 1,
  'renderer/explodeParity.test.ts': 2,
  'renderer/export/buildExportScenes.ts': 1,
  'renderer/layout.ts': 1,
  'renderer/sceneSvg.ts': 1,
  'renderer/timelineLayout.ts': 2,
};

describe('説明文を別の宣言から奪わない（再発防止の門番）', () => {
  it('説明文が2つ並んだ箇所が、記録した数より増えていない', () => {
    const grown: string[] = [];
    for (const p of sourceFiles(SRC)) {
      const rel = p.slice(SRC.length + 1).split(sep).join('/');
      const n = detachedDocCount(readFileSync(p, 'utf8'));
      const max = BASELINE[rel] ?? 0;
      if (n > max) grown.push(`${rel}: ${n}（上限 ${max}）`);
    }
    // ⚠️ 落ちたら**差し込んだ位置の1つ上**を見る。奪った説明文を、本来の宣言のすぐ上へ戻す。
    expect(grown).toEqual([]);
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
