import { describe, expect, it } from 'vitest';
import { NARRATION_STATUS } from '../enums';
import type { SceneSegmentSpec } from './lineTimeline';
import { segmentAt } from './lineTimeline';
import { defaultSubtitleSource, effectiveSpeakerKey, resolveSubtitleForElement, speakerKeyEquals } from './subtitleBinding';
import type { FreeElement, NarrationLine, Scene, SubtitleSource } from './types';

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
