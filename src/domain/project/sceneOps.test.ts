import { describe, it, expect } from 'vitest';
import type { Part, Scene } from './types';
import { NARRATION_STATUS } from '../enums';
import { duplicateSceneInList, moveSceneInList, rebuildPartSceneIds } from './sceneOps';

function scene(id: string, order: number, partId = 'part_001', narration?: Scene['narration']): Scene {
  return {
    sceneId: id,
    partId,
    order,
    sceneType: 'photo_intro',
    templateId: 't1',
    durationSec: 5,
    assetRefs: {},
    character: { enabled: false, characterId: 'yuko' },
    texts: {},
    narration: narration ?? { text: 'こんにちは', status: NARRATION_STATUS.none },
    warnings: [],
  };
}

const onePart = (): Part[] => [
  { partId: 'part_001', title: 'パート1', order: 1, sceneIds: ['scene_001', 'scene_002', 'scene_003'] },
];
const threeScenes = (): Scene[] => [scene('scene_001', 1), scene('scene_002', 2), scene('scene_003', 3)];

describe('moveSceneInList', () => {
  it('下へ移動で順序が入れ替わり order と part.sceneIds が整合する', () => {
    const r = moveSceneInList(threeScenes(), onePart(), 'scene_001', 'down');
    expect(r.scenes.map((s) => s.sceneId)).toEqual(['scene_002', 'scene_001', 'scene_003']);
    expect(r.scenes.map((s) => s.order)).toEqual([1, 2, 3]);
    expect(r.parts[0].sceneIds).toEqual(['scene_002', 'scene_001', 'scene_003']);
  });

  it('上へ移動で順序が入れ替わる', () => {
    const r = moveSceneInList(threeScenes(), onePart(), 'scene_003', 'up');
    expect(r.scenes.map((s) => s.sceneId)).toEqual(['scene_001', 'scene_003', 'scene_002']);
  });

  it('先頭を上・末尾を下へは変化なし（端）', () => {
    expect(moveSceneInList(threeScenes(), onePart(), 'scene_001', 'up').scenes.map((s) => s.sceneId)).toEqual([
      'scene_001',
      'scene_002',
      'scene_003',
    ]);
    expect(moveSceneInList(threeScenes(), onePart(), 'scene_003', 'down').scenes.map((s) => s.sceneId)).toEqual([
      'scene_001',
      'scene_002',
      'scene_003',
    ]);
  });

  it('パートをまたいで移動しても partId は変わらず sceneIds が整合する', () => {
    const parts: Part[] = [
      { partId: 'part_001', title: 'P1', order: 1, sceneIds: ['scene_001'] },
      { partId: 'part_002', title: 'P2', order: 2, sceneIds: ['scene_002'] },
    ];
    const scenes = [scene('scene_001', 1, 'part_001'), scene('scene_002', 2, 'part_002')];
    const r = moveSceneInList(scenes, parts, 'scene_001', 'down');
    expect(r.scenes.map((s) => s.sceneId)).toEqual(['scene_002', 'scene_001']);
    expect(r.scenes[1].partId).toBe('part_001'); // 所属（partId）は維持される
    expect(r.parts[0].sceneIds).toEqual(['scene_001']); // 各パートは所属ベースで再構築
    expect(r.parts[1].sceneIds).toEqual(['scene_002']);
  });
});

describe('duplicateSceneInList', () => {
  it('直後に複製を挿入し order を振り直す。文言は引き継ぎ音声はリセットする', () => {
    const scenes = [
      scene('scene_001', 1, 'part_001', { text: '会社紹介', status: NARRATION_STATUS.generated, voicePath: 'voices/scene_001.wav' }),
      scene('scene_002', 2),
    ];
    const parts: Part[] = [{ partId: 'part_001', title: 'パート1', order: 1, sceneIds: ['scene_001', 'scene_002'] }];
    const r = duplicateSceneInList(scenes, parts, 'scene_001', 'scene_003');
    expect(r.scenes.map((s) => s.sceneId)).toEqual(['scene_001', 'scene_003', 'scene_002']);
    expect(r.scenes.map((s) => s.order)).toEqual([1, 2, 3]);
    const dup = r.scenes[1];
    expect(dup.narration.text).toBe('会社紹介'); // セリフは引き継ぐ
    expect(dup.narration.status).toBe(NARRATION_STATUS.none); // 音声は作り直し
    expect(dup.narration.voicePath).toBeNull();
    expect(dup.warnings).toEqual([]); // 警告はクリア（再検証前提）
    expect(r.scenes[0].narration.voicePath).toBe('voices/scene_001.wav'); // 元は保持
    expect(r.parts[0].sceneIds).toEqual(['scene_001', 'scene_003', 'scene_002']);
  });

  it('存在しない sceneId は変化なし', () => {
    const r = duplicateSceneInList(threeScenes(), onePart(), 'scene_999', 'scene_004');
    expect(r.scenes).toHaveLength(3);
  });
});

describe('rebuildPartSceneIds', () => {
  it('scenes 配列順に合わせて各パートの sceneIds を作り直す（所属は保持）', () => {
    const parts: Part[] = [
      { partId: 'part_001', title: 'P1', order: 1, sceneIds: ['scene_001'] },
      { partId: 'part_002', title: 'P2', order: 2, sceneIds: ['scene_002'] },
    ];
    const scenes = [scene('scene_002', 1, 'part_002'), scene('scene_001', 2, 'part_001')];
    const r = rebuildPartSceneIds(parts, scenes);
    expect(r[0].sceneIds).toEqual(['scene_001']);
    expect(r[1].sceneIds).toEqual(['scene_002']);
  });
});
