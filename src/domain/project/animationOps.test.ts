import { describe, expect, it } from 'vitest';
import { duplicateSceneAnimations, removeAnimationsForTargets } from './animationOps';
import type { ElementAnimation } from './types';

const anim = (id: string, sceneId: string, targetId: string): ElementAnimation =>
  ({ id, sceneId, targetId, keyframes: [{ timeSec: 0, opacity: 0 }, { timeSec: 0.6, opacity: 1 }] });

// createAnimationId 相当（anim_NNN の最小空き番号）を簡易再現したテスト用採番。
const makeId = (ids: readonly string[]): string => {
  const used = new Set(ids);
  let n = 1;
  while (used.has(`anim_${String(n).padStart(3, '0')}`)) n += 1;
  return `anim_${String(n).padStart(3, '0')}`;
};

describe('duplicateSceneAnimations（場面複製/分割の引き継ぎ・④）', () => {
  it('元場面のアニメだけを新場面へ複製（sceneId 差し替え・targetId 保持・新id・KF は深いコピー）', () => {
    const anims = [anim('anim_001', 'scene_001', 'free_001'), anim('anim_002', 'scene_002', 'free_001')];
    const copies = duplicateSceneAnimations(anims, 'scene_001', 'scene_003', makeId);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ id: 'anim_003', sceneId: 'scene_003', targetId: 'free_001' });
    expect(copies[0].keyframes).toEqual(anims[0].keyframes);
    expect(copies[0].keyframes).not.toBe(anims[0].keyframes); // 参照は別（深いコピー）
  });

  it('同一場面に複数アニメがあれば全て複製し id は重複しない', () => {
    const anims = [anim('anim_001', 'scene_001', 'free_001'), anim('anim_002', 'scene_001', 'free_002')];
    const copies = duplicateSceneAnimations(anims, 'scene_001', 'scene_003', makeId);
    expect(copies.map((c) => c.id)).toEqual(['anim_003', 'anim_004']);
    expect(copies.map((c) => c.targetId)).toEqual(['free_001', 'free_002']);
  });

  it('対象場面にアニメが無ければ空', () => {
    expect(duplicateSceneAnimations([anim('anim_001', 'scene_002', 'free_001')], 'scene_001', 'scene_003', makeId)).toEqual([]);
  });
});

describe('removeAnimationsForTargets（要素削除の孤児掃除・④）', () => {
  it('指定場面の指定要素のアニメだけ取り除く（他場面/他要素は不変）', () => {
    const anims = [
      anim('anim_001', 'scene_001', 'free_001'),
      anim('anim_002', 'scene_001', 'free_002'),
      anim('anim_003', 'scene_002', 'free_001'),
    ];
    const rest = removeAnimationsForTargets(anims, 'scene_001', ['free_001']);
    expect(rest.map((a) => a.id)).toEqual(['anim_002', 'anim_003']);
  });

  it('複数 target をまとめて掃除できる', () => {
    const anims = [anim('anim_001', 'scene_001', 'free_001'), anim('anim_002', 'scene_001', 'free_002')];
    expect(removeAnimationsForTargets(anims, 'scene_001', ['free_001', 'free_002'])).toEqual([]);
  });
});
