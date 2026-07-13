import { describe, expect, it } from 'vitest';
import { animationsEndSec, sceneAnimationActive, slotIsAnimated } from './sceneAnimation';
import type { ElementAnimation, Scene } from './types';
import type { Group } from '../group/types';

const anim = { id: 'anim_001', sceneId: 's1', targetId: 'el1', keyframes: [] } as unknown as ElementAnimation;
const base = { sceneId: 's1', templateId: 'tpl', durationSec: 5 } as unknown as Scene;

describe('sceneAnimationActive（④・ADR-0019 アニメ適用可否・preview/export 共有）', () => {
  it('アニメあり・掛け合いなし・動画スロットなし → true', () => {
    expect(sceneAnimationActive(base, [anim], false)).toBe(true);
  });

  it('アニメが空 / undefined → false', () => {
    expect(sceneAnimationActive(base, [], false)).toBe(false);
    expect(sceneAnimationActive(base, undefined, false)).toBe(false);
  });

  it('掛け合い（lines あり）でもアニメあり → true（行セグメント×フレームで対応・③）', () => {
    const withLines = { ...base, lines: [{ lineId: 'line_001', text: 'a' }] } as unknown as Scene;
    expect(sceneAnimationActive(withLines, [anim], false)).toBe(true);
  });

  it('動画スロットあり・非掛け合い → true（#435：前景=最上層を per-frame で動画に overlay）', () => {
    expect(sceneAnimationActive(base, [anim], true)).toBe(true);
  });

  it('動画スロットあり・掛け合い → false（行区間×フレームの二重合成は v1 未対応＝静止・後続）', () => {
    const withLines = { ...base, lines: [{ lineId: 'line_001', text: 'a' }] } as unknown as Scene;
    expect(sceneAnimationActive(withLines, [anim], true)).toBe(false);
  });
});

describe('slotIsAnimated（#442・動画スロット本体がアニメ対象か＝書き出し経路の分岐）', () => {
  const mkAnim = (targetId: string): ElementAnimation =>
    ({ id: 'a', sceneId: 's1', targetId, keyframes: [{ timeSec: 0 }, { timeSec: 0.5 }] } as unknown as ElementAnimation);
  const grp = (id: string, members: string[]): Group => ({ id, members } as unknown as Group);

  it('スロット層を直接の対象にするアニメ → true', () => {
    expect(slotIsAnimated([mkAnim('slot_1')], ['slot_1'], [])).toBe(true);
  });

  it('スロット以外の要素だけを動かすアニメ → false（動画は固定＝#435 経路で足りる）', () => {
    expect(slotIsAnimated([mkAnim('text_1')], ['slot_1'], [])).toBe(false);
  });

  it('スロットを含むグループ対象のアニメ → true', () => {
    const groups = [grp('group_1', ['slot_1', 'text_1'])];
    expect(slotIsAnimated([mkAnim('group_1')], ['slot_1'], groups)).toBe(true);
  });

  it('ネストしたグループ配下のスロットも検出 → true', () => {
    const groups = [grp('group_outer', ['group_inner', 'text_1']), grp('group_inner', ['slot_1'])];
    expect(slotIsAnimated([mkAnim('group_outer')], ['slot_1'], groups)).toBe(true);
  });

  it('スロットを含まないグループ対象のアニメ → false', () => {
    const groups = [grp('group_1', ['text_1', 'shape_1'])];
    expect(slotIsAnimated([mkAnim('group_1')], ['slot_1'], groups)).toBe(false);
  });

  it('アニメが空 / スロットが無い → false', () => {
    expect(slotIsAnimated([], ['slot_1'], [])).toBe(false);
    expect(slotIsAnimated(undefined, ['slot_1'], [])).toBe(false);
    expect(slotIsAnimated([mkAnim('slot_1')], [], [])).toBe(false);
  });
});

describe('animationsEndSec（④・#376 高速化＝最終キーフレーム時刻）', () => {
  const mk = (times: number[]): ElementAnimation =>
    ({ id: 'a', sceneId: 's1', targetId: 'el', keyframes: times.map((t) => ({ timeSec: t })) } as unknown as ElementAnimation);

  it('アニメが無い/undefined/空キーフレームは 0', () => {
    expect(animationsEndSec(undefined)).toBe(0);
    expect(animationsEndSec([])).toBe(0);
    expect(animationsEndSec([mk([])])).toBe(0);
  });

  it('単一アニメの最後のキーフレーム時刻を返す', () => {
    expect(animationsEndSec([mk([0, 0.5, 1])])).toBe(1);
  });

  it('複数アニメ横断で最大の時刻を返す（順不同でも max）', () => {
    expect(animationsEndSec([mk([0, 1]), mk([2, 0.3]), mk([0.8])])).toBe(2);
  });
});
