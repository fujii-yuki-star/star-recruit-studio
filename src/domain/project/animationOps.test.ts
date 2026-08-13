import { describe, expect, it } from 'vitest';
import { animationsForElement, duplicateSceneAnimations, removeAnimationsForTargets, retargetAnimations } from './animationOps';
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

describe('animationsForElement / retargetAnimations（要素ひとつの複製・貼り付け・#770）', () => {
  const anims = [
    anim('anim_001', 'scene_001', 'free_001'),
    anim('anim_002', 'scene_001', 'free_002'),
    anim('anim_003', 'scene_002', 'free_001'),
  ];

  it('その要素の動きだけを取り出す（他要素・他場面は混ぜない）', () => {
    expect(animationsForElement(anims, 'scene_001', 'free_001').map((a) => a.id)).toEqual(['anim_001']);
  });

  it('同じ場面の複製は targetId を宛て直す（動く要素を複製したのに動かない、を作らない）', () => {
    const src = animationsForElement(anims, 'scene_001', 'free_001');
    const added = retargetAnimations(src, anims, 'scene_001', 'free_009', makeId);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ id: 'anim_004', sceneId: 'scene_001', targetId: 'free_009' });
    expect(added[0].keyframes).toEqual(anims[0].keyframes);
    expect(added[0].keyframes).not.toBe(anims[0].keyframes); // 参照は別（深いコピー）
  });

  it('別の場面へ貼るときは場面も宛て直す（貼った場面の要素として動く）', () => {
    const src = animationsForElement(anims, 'scene_001', 'free_001');
    const added = retargetAnimations(src, anims, 'scene_002', 'free_009', makeId);
    expect(added[0]).toMatchObject({ sceneId: 'scene_002', targetId: 'free_009' });
  });

  it('複数の動きでも id を一度に採る（同じ番号を2度出さない）', () => {
    const two = [anim('anim_001', 'scene_001', 'free_001'), anim('anim_002', 'scene_001', 'free_001')];
    const added = retargetAnimations(two, two, 'scene_001', 'free_009', makeId);
    expect(added.map((a) => a.id)).toEqual(['anim_003', 'anim_004']);
  });

  it('元に動きが無ければ空配列（呼び出し側は足すものが無いと分かる）', () => {
    expect(retargetAnimations([], anims, 'scene_001', 'free_009', makeId)).toEqual([]);
  });
});
