import { describe, expect, it } from 'vitest';
import type { Scene } from '../project/types';
import { narrationProgress } from './narrationProgress';

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
});
