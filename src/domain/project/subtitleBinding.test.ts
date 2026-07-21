import { describe, expect, it } from 'vitest';
import { NARRATION_STATUS } from '../enums';
import type { SceneSegmentSpec } from './lineTimeline';
import { segmentAt } from './lineTimeline';
import { defaultSubtitleSource, effectiveSpeakerKey, normalizeSubtitleSources, resolveSubtitleForElement, sceneDisplayedSubtitleTexts, sceneSubtitleSpeakerOptions, speakerKeyEquals, subtitleSourceFromValue, subtitleSourceToValue } from './subtitleBinding';
import type { FreeElement, NarrationLine, Scene, SubtitleSource } from './types';
import type { Template } from '../template/types';

function sceneWith(partial: Partial<Scene>): Scene {
  return {
    sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'free', templateId: 'free_canvas_v1',
    durationSec: 10, assetRefs: {}, character: { enabled: false, characterId: 'yuko' }, texts: {},
    narration: { text: 'ナレ', status: NARRATION_STATUS.none }, warnings: [], ...partial,
  } as Scene;
}

function subEl(subtitleSource?: SubtitleSource): FreeElement {
  return { id: 'free_001', kind: 'subtitle', x: 0, y: 0, w: 100, h: 50, subtitleSource };
}

const line = (lineId: string, text: string, over: Partial<NarrationLine> = {}): NarrationLine => ({
  lineId, text, status: NARRATION_STATUS.none, ...over,
});

const seg = (over: Partial<SceneSegmentSpec>): SceneSegmentSpec => ({ startSec: 0, durationSec: 10, isFirst: true, ...over });

describe('effectiveSpeakerKey（実効話者・ADR-0029 P1-2）', () => {
  it('catalog にある speaker はその番号（catalog）', () => {
    expect(effectiveSpeakerKey(line('line_001', 'a', { speaker: 3 }))).toEqual({ kind: 'catalog', speaker: 3 });
  });
  it('speaker 未指定は既定声（default）', () => {
    expect(effectiveSpeakerKey(line('line_001', 'a'))).toEqual({ kind: 'default' });
  });
  it('catalog 外の speaker は既定声（default）＝resolveLineVoice と同じフォールバック', () => {
    expect(effectiveSpeakerKey(line('line_001', 'a', { speaker: 9999 }))).toEqual({ kind: 'default' });
  });
});

describe('speakerKeyEquals', () => {
  it('catalog は番号一致で同値', () => {
    expect(speakerKeyEquals({ kind: 'catalog', speaker: 3 }, { kind: 'catalog', speaker: 3 })).toBe(true);
    expect(speakerKeyEquals({ kind: 'catalog', speaker: 3 }, { kind: 'catalog', speaker: 2 })).toBe(false);
  });
  it('default 同士は同値・種別違いは非同値', () => {
    expect(speakerKeyEquals({ kind: 'default' }, { kind: 'default' })).toBe(true);
    expect(speakerKeyEquals({ kind: 'default' }, { kind: 'catalog', speaker: 3 })).toBe(false);
  });
});

describe('defaultSubtitleSource（未指定時の既定）', () => {
  it('lines ありは全行（allLines）', () => {
    expect(defaultSubtitleSource(sceneWith({ lines: [line('line_001', 'a')] }))).toEqual({ kind: 'allLines' });
  });
  it('lines なしは読み上げ（narration）', () => {
    expect(defaultSubtitleSource(sceneWith({}))).toEqual({ kind: 'narration' });
  });
});

describe('resolveSubtitleForElement（対象解決・ADR-0029）', () => {
  it('subtitle 以外の要素は null（text 要素に texts.subtitle を流用しない）', () => {
    const el: FreeElement = { id: 'free_001', kind: 'text', x: 0, y: 0, w: 1, h: 1, text: 'x' };
    expect(resolveSubtitleForElement(el, sceneWith({ texts: { subtitle: 'S' } }), { segment: seg({}) })).toBeNull();
  });

  describe('narration（読み上げ・texts.subtitle）', () => {
    it('texts.subtitle を返す', () => {
      const s = sceneWith({ texts: { subtitle: '読み上げ字幕' } });
      expect(resolveSubtitleForElement(subEl({ kind: 'narration' }), s, { segment: seg({}) })).toBe('読み上げ字幕');
    });
    it('subtitleEnabledDefault===false は非表示', () => {
      const s = sceneWith({ texts: { subtitle: 'S' }, subtitleEnabledDefault: false });
      expect(resolveSubtitleForElement(subEl({ kind: 'narration' }), s, { segment: seg({}) })).toBeNull();
    });
    it('texts.subtitle 空は非表示', () => {
      expect(resolveSubtitleForElement(subEl({ kind: 'narration' }), sceneWith({ texts: {} }), { segment: seg({}) })).toBeNull();
    });
    it('source 未指定は単独場面（lines なし）で narration 扱い', () => {
      const s = sceneWith({ texts: { subtitle: 'S' } });
      expect(resolveSubtitleForElement(subEl(), s, { segment: seg({}) })).toBe('S');
    });
    it('narration も間（isGap）では非表示＝対象を問わず間は出さない（P1-1）', () => {
      // 掛け合いの頭空白（先頭行 startSec>0）で narration を選んでも texts.subtitle を出さない。
      const s = sceneWith({ texts: { subtitle: 'S' }, lines: [line('line_001', 'A', { startSec: 2 })] });
      expect(resolveSubtitleForElement(subEl({ kind: 'narration' }), s, { segment: seg({ isGap: true, subtitleText: null }) })).toBeNull();
    });
  });

  describe('allLines（全行）', () => {
    const s = sceneWith({ lines: [line('line_001', 'A'), line('line_002', 'B')] });
    it('セグメントの字幕を返す', () => {
      expect(resolveSubtitleForElement(subEl({ kind: 'allLines' }), s, { segment: seg({ lineId: 'line_001', subtitleText: 'A' }) })).toBe('A');
    });
    it('間（isGap）は非表示', () => {
      expect(resolveSubtitleForElement(subEl({ kind: 'allLines' }), s, { segment: seg({ isGap: true, subtitleText: null }) })).toBeNull();
    });
    it('OFF 行（subtitleText null）は非表示', () => {
      expect(resolveSubtitleForElement(subEl({ kind: 'allLines' }), s, { segment: seg({ lineId: 'line_001', subtitleText: null }) })).toBeNull();
    });
    it('source 未指定は掛け合い場面（lines あり）で allLines 扱い', () => {
      expect(resolveSubtitleForElement(subEl(), s, { segment: seg({ lineId: 'line_001', subtitleText: 'A' }) })).toBe('A');
    });
  });

  describe('speaker（実効話者で絞る）', () => {
    const lines = [line('line_001', 'A', { speaker: 3 }), line('line_002', 'B', { speaker: 2 }), line('line_003', 'C')]; // C=既定声
    const s = sceneWith({ lines });
    it('対象話者(catalog 3)の行だけ表示・他話者は非表示（二重描画にしない）', () => {
      const el = subEl({ kind: 'speaker', speaker: { kind: 'catalog', speaker: 3 } });
      expect(resolveSubtitleForElement(el, s, { segment: seg({ lineId: 'line_001', subtitleText: 'A' }) })).toBe('A');
      expect(resolveSubtitleForElement(el, s, { segment: seg({ lineId: 'line_002', subtitleText: 'B' }) })).toBeNull();
    });
    it('既定声の行は default ボックスに出る（生 speaker で絞ると出ない問題の解消・P1-2）', () => {
      const elDefault = subEl({ kind: 'speaker', speaker: { kind: 'default' } });
      expect(resolveSubtitleForElement(elDefault, s, { segment: seg({ lineId: 'line_003', subtitleText: 'C' }) })).toBe('C');
      expect(resolveSubtitleForElement(elDefault, s, { segment: seg({ lineId: 'line_001', subtitleText: 'A' }) })).toBeNull();
    });
    it('間（isGap）は話者一致でも非表示', () => {
      const el = subEl({ kind: 'speaker', speaker: { kind: 'catalog', speaker: 3 } });
      expect(resolveSubtitleForElement(el, s, { segment: seg({ isGap: true, subtitleText: null }) })).toBeNull();
    });
    it('同時開始：primary 以外（parallelLineIds）の話者ボックスも自分の行の字幕を出す（ADR-0031）', () => {
      // segment＝primary line_001(話者3・subtitleText='A')＋同時に line_002(話者2)。話者2は parallelLineIds から解決。
      const segSimul = seg({ lineId: 'line_001', parallelLineIds: ['line_002'], subtitleText: 'A' });
      const el3 = subEl({ kind: 'speaker', speaker: { kind: 'catalog', speaker: 3 } });
      const el2 = subEl({ kind: 'speaker', speaker: { kind: 'catalog', speaker: 2 } });
      expect(resolveSubtitleForElement(el3, s, { segment: segSimul })).toBe('A'); // primary＝自分の行だけ
      expect(resolveSubtitleForElement(el2, s, { segment: segSimul })).toBe('B'); // 同時の話者2＝line_002 の字幕
    });
    it('同時開始：allLines は primary＋同時行を改行結合（2行表示）', () => {
      // subtitleText は primary のみ（'A'）。line_002 は parallelLineIds から解決して結合＝'A\nB'。
      const segSimul = seg({ lineId: 'line_001', parallelLineIds: ['line_002'], subtitleText: 'A' });
      expect(resolveSubtitleForElement(subEl({ kind: 'allLines' }), s, { segment: segSimul })).toBe('A\nB');
    });
  });

  it('プレビュー＝書き出し：segmentAt 由来のモーメントで解決（間→非表示・行→表示）', () => {
    const lines = [line('line_001', 'A', { speaker: 3, startSec: 2 })]; // 先頭に間 [0,2)
    const s = sceneWith({ lines });
    const el = subEl({ kind: 'allLines' });
    expect(resolveSubtitleForElement(el, s, { segment: segmentAt(s, {}, 1) })).toBeNull(); // 間
    expect(resolveSubtitleForElement(el, s, { segment: segmentAt(s, {}, 5) })).toBe('A'); // 行
  });

  it('全0秒行フォールバック：segmentAt は場面全体1セグメント（lineId なし）＝allLines は非表示・narration は texts.subtitle', () => {
    // 全行 startSec===durationSec ＝全0秒 → sceneSegmentSpecs は場面全体1セグメント（行 id なし）＝書き出しと一致（ADR-0029 P1-1）。
    const lines = [line('line_001', 'A', { speaker: 3, startSec: 10 })]; // durationSec(10) と同値ゆえ全0秒
    const s = sceneWith({ lines, texts: { subtitle: '読み上げ' } });
    const seg0 = segmentAt(s, {}, 0);
    expect(seg0.lineId).toBeUndefined(); // フォールバック＝行 id なし
    expect(resolveSubtitleForElement(subEl({ kind: 'allLines' }), s, { segment: seg0 })).toBeNull();
    expect(resolveSubtitleForElement(subEl({ kind: 'narration' }), s, { segment: seg0 })).toBe('読み上げ');
  });
});

describe('sceneSubtitleSpeakerOptions（対象＝話者の選択肢・PR-C）', () => {
  it('掛け合いの実効話者を重複排除して返す（catalog はキャラ名・default は既定の声・登場順）', () => {
    const lines = [
      line('line_001', 'A', { speaker: 3 }), // ずんだもん
      line('line_002', 'B', { speaker: 3 }), // 重複＝1件に
      line('line_003', 'C', { speaker: 2 }), // 四国めたん
      line('line_004', 'D'),                 // 既定の声（speaker なし）
    ];
    const opts = sceneSubtitleSpeakerOptions(sceneWith({ lines }));
    expect(opts.map((o) => o.label)).toEqual(['ずんだもん', '四国めたん', '既定の声']);
    expect(opts.map((o) => o.key)).toEqual([
      { kind: 'catalog', speaker: 3 }, { kind: 'catalog', speaker: 2 }, { kind: 'default' },
    ]);
  });
});

describe('subtitleSourceToValue / subtitleSourceFromValue（UI シリアライズ・PR-C）', () => {
  const cases: [SubtitleSource, string][] = [
    [{ kind: 'narration' }, 'narration'],
    [{ kind: 'allLines' }, 'allLines'],
    [{ kind: 'speaker', speaker: { kind: 'catalog', speaker: 3 } }, 'speaker:catalog:3'],
    [{ kind: 'speaker', speaker: { kind: 'default' } }, 'speaker:default'],
  ];
  it('往復（source→value→source）で一致', () => {
    for (const [src, val] of cases) {
      expect(subtitleSourceToValue(src)).toBe(val);
      expect(subtitleSourceFromValue(val)).toEqual(src);
    }
  });
  it('未知値は narration へフォールバック（黙って壊さない）', () => {
    expect(subtitleSourceFromValue('bogus')).toEqual({ kind: 'narration' });
  });
});

describe('normalizeSubtitleSources（無効な対象を既定へ戻す・ADR-0026④・P1）', () => {
  const withSub = (subtitleSource: SubtitleSource | undefined, extra: Partial<Scene> = {}): Scene =>
    sceneWith({ freeLayout: [{ id: 'free_001', kind: 'subtitle', x: 0, y: 0, w: 100, h: 50, ...(subtitleSource ? { subtitleSource } : {}) }], ...extra });
  const subSource = (s: Scene): SubtitleSource | undefined => s.freeLayout?.[0]?.subtitleSource;

  it('単独（lines なし）では allLines/speaker を未設定へ戻す（→ 読み上げ＝黙って消さない）', () => {
    expect(subSource(normalizeSubtitleSources(withSub({ kind: 'allLines' })))).toBeUndefined();
    expect(subSource(normalizeSubtitleSources(withSub({ kind: 'speaker', speaker: { kind: 'catalog', speaker: 3 } })))).toBeUndefined();
  });

  it('単独でも narration は不変（有効）', () => {
    const s = withSub({ kind: 'narration' });
    expect(normalizeSubtitleSources(s)).toBe(s); // 同一参照＝変化なし
  });

  it('掛け合いで対象話者が場面にいれば不変・いなければ未設定へ戻す', () => {
    const lines = [line('line_001', 'A', { speaker: 3 })];
    // speaker 3 は在席＝有効
    const ok = withSub({ kind: 'speaker', speaker: { kind: 'catalog', speaker: 3 } }, { lines });
    expect(normalizeSubtitleSources(ok)).toBe(ok);
    // speaker 2 は不在＝未設定へ
    const gone = withSub({ kind: 'speaker', speaker: { kind: 'catalog', speaker: 2 } }, { lines });
    expect(subSource(normalizeSubtitleSources(gone))).toBeUndefined();
    // allLines は掛け合いでは有効
    const all = withSub({ kind: 'allLines' }, { lines });
    expect(normalizeSubtitleSources(all)).toBe(all);
  });

  it('対象を持つ字幕が無ければ同一参照（未保存/履歴にしない）', () => {
    const s = withSub(undefined);
    expect(normalizeSubtitleSources(s)).toBe(s);
  });
});

// 場面が「実際に表示する字幕文」の列挙（precheck の長さ判定などが描画と同じ経路で見るための共通関数・#547 P1-3 レビュー）。
// resolveSubtitleForElement / layout の字幕層と同じ分岐・同じ OFF 除外で解く＝表示と検査がずれない。
describe('sceneDisplayedSubtitleTexts（表示される字幕文の列挙・ADR-0029・#547 P1-3）', () => {
  const freeTemplate = { category: 'free', layers: [] } as unknown as Template;
  const normalTemplate = (hasSubtitleLayer: boolean): Template =>
    ({ category: 'opening', layers: hasSubtitleLayer ? [{ id: 'subtitle', type: 'subtitle' }] : [{ id: 'title', type: 'text' }] }) as unknown as Template;
  const freeScene = (over: Partial<Scene>): Scene => sceneWith({ sceneType: 'free', templateId: 'free_canvas_v1', ...over });
  const hiddenGroup = (id: string, members: string[]): NonNullable<Scene['groups']>[number] =>
    ({ id, members, transform: { x: 0, y: 0, rotation: 0, scale: 1 }, hidden: true });

  describe('FREE（字幕要素の subtitleSource で解決）', () => {
    it('narration：texts.subtitle を列挙（OFF は除外・空は除外）', () => {
      const el = subEl({ kind: 'narration' });
      expect(sceneDisplayedSubtitleTexts(freeScene({ texts: { subtitle: 'S' }, freeLayout: [el] }), freeTemplate)).toEqual(['S']);
      expect(sceneDisplayedSubtitleTexts(freeScene({ texts: { subtitle: 'S' }, subtitleEnabledDefault: false, freeLayout: [el] }), freeTemplate)).toEqual([]);
      expect(sceneDisplayedSubtitleTexts(freeScene({ texts: {}, freeLayout: [el] }), freeTemplate)).toEqual([]);
    });
    it('allLines：ON の全行字幕を列挙（OFF 行は除外）', () => {
      const s = freeScene({
        lines: [line('line_001', 'A'), line('line_002', 'B', { subtitleEnabled: false }), line('line_003', 'C', { subtitleText: 'Cを表示' })],
        freeLayout: [subEl({ kind: 'allLines' })],
      });
      expect(sceneDisplayedSubtitleTexts(s, freeTemplate)).toEqual(['A', 'Cを表示']); // B は OFF・C は subtitleText 優先
    });
    it('speaker：対象話者の行だけ列挙（他話者は除外）', () => {
      const s = freeScene({
        lines: [line('line_001', 'A', { speaker: 3 }), line('line_002', 'B', { speaker: 2 })],
        freeLayout: [subEl({ kind: 'speaker', speaker: { kind: 'catalog', speaker: 3 } })],
      });
      expect(sceneDisplayedSubtitleTexts(s, freeTemplate)).toEqual(['A']);
    });
    it('字幕要素が複数あれば各対象を合算（narration＋allLines）', () => {
      const s = freeScene({
        texts: { subtitle: 'S' },
        lines: [line('line_001', 'A')],
        freeLayout: [subEl({ kind: 'narration' }), { id: 'free_002', kind: 'subtitle', x: 0, y: 60, w: 100, h: 50, subtitleSource: { kind: 'allLines' } }],
      });
      expect(sceneDisplayedSubtitleTexts(s, freeTemplate)).toEqual(['S', 'A']);
    });
    it('字幕要素が無ければ空（texts.subtitle があっても FREE では描画されない）', () => {
      expect(sceneDisplayedSubtitleTexts(freeScene({ texts: { subtitle: 'S' }, freeLayout: [] }), freeTemplate)).toEqual([]);
    });
    // subtitleSource 未設定＝字幕欄を追加した直後の実 UI 初期状態（createFreeElement は対象を設定しない・PR-C）。
    // 既定解決（defaultSubtitleSource）は resolveSubtitleForElement と別コードで複製されているため独立に検証する。
    it('subtitleSource 未設定：単独場面（lines なし）は既定=narration＝texts.subtitle を列挙', () => {
      const s = freeScene({ texts: { subtitle: 'S' }, freeLayout: [subEl(undefined)] });
      expect(sceneDisplayedSubtitleTexts(s, freeTemplate)).toEqual(['S']);
    });
    it('subtitleSource 未設定：掛け合い場面（lines あり）は既定=allLines＝全行を列挙', () => {
      const s = freeScene({ lines: [line('line_001', 'A'), line('line_002', 'B')], freeLayout: [subEl(undefined)] });
      expect(sceneDisplayedSubtitleTexts(s, freeTemplate)).toEqual(['A', 'B']);
    });
    // ℹ️1（correctness）：FREE テンプレが字幕**層**を持つと layout は層ループ（全カテゴリ）で描画する＝数える。
    // schema 上 category は単なるタグで FREE テンプレも字幕層を持ち得る（到達可能性は schema 基準）。
    it('FREE テンプレが字幕層を持てば、テンプレ層の字幕も数える（要素＝freeLayout の上に合算）', () => {
      const freeWithSubLayer = { category: 'free', layers: [{ id: 'subtitle', type: 'subtitle' }] } as unknown as Template;
      // 字幕要素は無いが、字幕層が texts.subtitle を描画する（単独）。
      expect(sceneDisplayedSubtitleTexts(freeScene({ texts: { subtitle: 'S' }, freeLayout: [] }), freeWithSubLayer)).toEqual(['S']);
      // 字幕層（texts.subtitle）＋ freeLayout 要素（narration＝texts.subtitle）＝両段を合算（重複は長さ判定に無害）。
      const both = freeScene({ texts: { subtitle: 'S' }, freeLayout: [subEl({ kind: 'narration' })] });
      expect(sceneDisplayedSubtitleTexts(both, freeWithSubLayer)).toEqual(['S', 'S']);
    });
    // P2（#547 レビュー）：非表示は描画されない＝数えない（実表示に一致・layout.ts:418-419）。
    it('非表示の字幕要素（el.hidden）は数えない（レイヤー一覧で隠した字幕）', () => {
      const el: FreeElement = { id: 'free_001', kind: 'subtitle', x: 0, y: 0, w: 100, h: 50, hidden: true, subtitleSource: { kind: 'narration' } };
      expect(sceneDisplayedSubtitleTexts(freeScene({ texts: { subtitle: 'S' }, freeLayout: [el] }), freeTemplate)).toEqual([]);
    });
    it('非表示グループ内の FREE 字幕要素は数えない（isHiddenByGroup・ADR-0022）', () => {
      const el: FreeElement = { id: 'free_001', kind: 'subtitle', x: 0, y: 0, w: 100, h: 50, subtitleSource: { kind: 'narration' } };
      const s = freeScene({ texts: { subtitle: 'S' }, freeLayout: [el], groups: [hiddenGroup('group_001', ['free_001'])] });
      expect(sceneDisplayedSubtitleTexts(s, freeTemplate)).toEqual([]);
    });
  });

  describe('通常テンプレ（字幕層があるときだけ）', () => {
    it('字幕層あり・単独：static字幕（texts.subtitle・OFF 除外）', () => {
      const s = sceneWith({ sceneType: 'opening', texts: { subtitle: 'S' } });
      expect(sceneDisplayedSubtitleTexts(s, normalTemplate(true))).toEqual(['S']);
      expect(sceneDisplayedSubtitleTexts(sceneWith({ ...s, subtitleEnabledDefault: false }), normalTemplate(true))).toEqual([]);
    });
    it('字幕層あり・掛け合い：各行の実効字幕（subtitleText ?? text・OFF 行除外）', () => {
      const s = sceneWith({ sceneType: 'opening', lines: [line('line_001', '本文', { subtitleText: '字幕' }), line('line_002', 'B', { subtitleEnabled: false })] });
      expect(sceneDisplayedSubtitleTexts(s, normalTemplate(true))).toEqual(['字幕']);
    });
    it('字幕層が無いテンプレは空（texts.subtitle があっても描画されない字幕を数えない）', () => {
      const s = sceneWith({ sceneType: 'opening', texts: { subtitle: 'S' } });
      expect(sceneDisplayedSubtitleTexts(s, normalTemplate(false))).toEqual([]);
    });
    // P2（#547 レビュー）：非表示グループ内のテンプレ字幕層は描画されない＝数えない（layout.ts:268 isHiddenByGroup）。
    it('非表示グループ内のテンプレ字幕層は空（通常字幕を隠した場合）', () => {
      const tmpl = { category: 'opening', layers: [{ id: 'subtitle', type: 'subtitle' }], groups: [hiddenGroup('group_001', ['subtitle'])] } as unknown as Template;
      const s = sceneWith({ sceneType: 'opening', texts: { subtitle: 'S' } });
      expect(sceneDisplayedSubtitleTexts(s, tmpl)).toEqual([]);
    });
    it('テンプレ未解決（undefined）は空', () => {
      expect(sceneDisplayedSubtitleTexts(sceneWith({ texts: { subtitle: 'S' } }), undefined)).toEqual([]);
    });
  });
});
