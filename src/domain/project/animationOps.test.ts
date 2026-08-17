import { describe, expect, it } from 'vitest';
import { animationsForElement, duplicateSceneAnimations, removeAnimationsForScene, removeAnimationsForTargets, retargetAnimations, vanishedAnimationTargets } from './animationOps';
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

describe('vanishedAnimationTargets（消えた動きの対象を拾う・#779）', () => {
  const el = (id: string, x = 0) => ({ id, kind: 'shape', x, y: 0, w: 10, h: 10 }) as never;
  const grp = (id: string, members: string[]) => ({ id, members }) as never;

  it('消えた FREE 要素を拾う', () => {
    const before = { freeLayout: [el('free_001'), el('free_002')], groups: [] };
    const after = { freeLayout: [el('free_002')], groups: [] };
    expect(vanishedAnimationTargets(before, after)).toEqual(['free_001']);
  });

  it('**まとまりを解除したとき**も拾う（要素は残るがまとまりは消える・#779 の穴その1）', () => {
    // ⚠️ ここが拾えないと、`group_NNN` の番号再利用で**後から作った別のまとまり**に動きが効く。
    const before = { freeLayout: [el('free_001'), el('free_002')], groups: [grp('group_001', ['free_001', 'free_002'])] };
    const after = { freeLayout: [el('free_001'), el('free_002')], groups: [] };
    expect(vanishedAnimationTargets(before, after)).toEqual(['group_001']);
  });

  it('**メンバーが消えて空になったまとまり**も拾う（#779 の穴その2）', () => {
    const before = { freeLayout: [el('free_001')], groups: [grp('group_001', ['free_001'])] };
    const after = { freeLayout: [], groups: [] };
    expect(vanishedAnimationTargets(before, after).sort()).toEqual(['free_001', 'group_001']);
  });

  it('複数のまとまりが同時に消えても、消えたぶんだけ挙がる（入れ子の親子でも同じ）', () => {
    // ⚠️ ここが見ているのは**前後差**であって「入れ子の解決」ではない（実装は id 集合の差分＝
    // `members` は辿らない）。入れ子を畳むのは消す側（`removeMembersFromGroups` ほか）の仕事。
    const before = {
      freeLayout: [el('free_001')],
      groups: [grp('group_001', ['free_001']), grp('group_002', ['group_001'])],
    };
    const after = { freeLayout: [], groups: [] };
    expect(vanishedAnimationTargets(before, after).sort()).toEqual(['free_001', 'group_001', 'group_002']);
  });

  it('残っているものは挙げない（消していない編集で動きを落とさない）', () => {
    const before = { freeLayout: [el('free_001')], groups: [grp('group_001', ['free_001'])] };
    const after = { freeLayout: [el('free_001', 99)], groups: [grp('group_001', ['free_001'])] }; // 動かしただけ
    expect(vanishedAnimationTargets(before, after)).toEqual([]);
  });

  it('足しただけなら何も挙がらない', () => {
    const before = { freeLayout: [el('free_001')], groups: [] };
    const after = { freeLayout: [el('free_001'), el('free_002')], groups: [grp('group_001', ['free_001', 'free_002'])] };
    expect(vanishedAnimationTargets(before, after)).toEqual([]);
  });

  it('未設定（undefined）でも壊れない', () => {
    expect(vanishedAnimationTargets({}, {})).toEqual([]);
    expect(vanishedAnimationTargets({ groups: [grp('group_001', [])] }, {})).toEqual(['group_001']);
  });
});

describe('removeAnimationsForScene（場面を消したときの掃除・#779）', () => {
  const anims = [
    anim('anim_001', 'scene_001', 'free_001'),
    anim('anim_002', 'scene_001', 'group_001'),
    anim('anim_003', 'scene_002', 'free_001'),
  ];

  it('その場面のぶんだけ落とす（要素もまとまりもまとめて）', () => {
    expect(removeAnimationsForScene(anims, 'scene_001').map((a) => a.id)).toEqual(['anim_003']);
  });

  it('他の場面は触らない（同じ要素 id でも別の場面のものは残す）', () => {
    // ⚠️ `free_001` は場面ごとに別物＝場面で絞らないと、消していない場面の動きまで落ちる。
    const rest = removeAnimationsForScene(anims, 'scene_002');
    expect(rest.map((a) => a.id)).toEqual(['anim_001', 'anim_002']);
  });

  it('対象が無ければそのまま', () => {
    expect(removeAnimationsForScene(anims, 'scene_999')).toHaveLength(3);
  });
});
