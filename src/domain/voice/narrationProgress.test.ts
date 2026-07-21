import { describe, expect, it } from 'vitest';
import type { Scene } from '../project/types';
import { isNarrationGenerating, narrationProgress } from './narrationProgress';

function scene(id: string, text: string, status: Scene['narration']['status']): Scene {
  return {
    sceneId: id, partId: 'part_001', order: 1, sceneType: 'opening', templateId: 't',
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: 'yuko' },
    texts: {}, narration: { text, status }, warnings: [],
  };
}

describe('narrationProgress', () => {
  it('対象＝本文非空の場面、done＝生成済み数', () => {
    const scenes = [
      scene('s1', 'あ', 'generated'),
      scene('s2', 'い', 'pending'),
      scene('s3', '', 'none'), // 本文空＝対象外
      scene('s4', 'え', 'failed'),
    ];
    expect(narrationProgress(scenes)).toEqual({ done: 1, total: 3 });
  });

  it('空白のみの本文は対象外', () => {
    expect(narrationProgress([scene('s1', '   ', 'none')])).toEqual({ done: 0, total: 0 });
  });

  it('空配列は 0/0', () => {
    expect(narrationProgress([])).toEqual({ done: 0, total: 0 });
  });

  it('掛け合い：lines は行ごとに集計（本文非空の行のみ・narration は無視）', () => {
    const s: Scene = {
      ...scene('s1', 'ignored', 'none'),
      lines: [
        { lineId: 'line_001', text: 'やあ', status: 'generated' },
        { lineId: 'line_002', text: 'どうも', status: 'pending' },
        { lineId: 'line_003', text: '', status: 'none' }, // 本文空＝対象外
      ],
    };
    expect(narrationProgress([s])).toEqual({ done: 1, total: 2 });
  });
});

describe('isNarrationGenerating（書き出し開始のブロック判定・#570 P1 レビュー・#547 P2-6）', () => {
  it('pending の場面があれば true（生成中）', () => {
    expect(isNarrationGenerating([scene('s1', 'あ', 'generated'), scene('s2', 'い', 'pending')])).toBe(true);
  });
  it('pending が無ければ false（none/generated/failed）', () => {
    expect(isNarrationGenerating([scene('s1', 'あ', 'generated'), scene('s2', 'い', 'none'), scene('s3', 'う', 'failed')])).toBe(false);
  });
  it('掛け合いは行の pending を見る（sceneLines・pending 行を取りこぼさない）', () => {
    const dlg = {
      ...scene('d', '', 'none'),
      lines: [{ lineId: 'l1', text: 'A', status: 'generated' }, { lineId: 'l2', text: 'B', status: 'pending' }],
    } as Scene;
    expect(isNarrationGenerating([dlg])).toBe(true);
  });
  it('掛け合いで pending 行が無ければ false（生成完了/未生成のみ）', () => {
    const dlg = {
      ...scene('d', '', 'none'),
      lines: [{ lineId: 'l1', text: 'A', status: 'generated' }, { lineId: 'l2', text: 'B', status: 'none' }],
    } as Scene;
    expect(isNarrationGenerating([dlg])).toBe(false);
  });
});
