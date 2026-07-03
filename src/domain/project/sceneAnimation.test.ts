import { describe, expect, it } from 'vitest';
import { sceneAnimationActive } from './sceneAnimation';
import type { ElementAnimation, Scene } from './types';

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

  it('動画スロットあり → false（書き出しは映像合成優先＝パリティ）', () => {
    expect(sceneAnimationActive(base, [anim], true)).toBe(false);
    // 掛け合い＋動画スロットも動画スロット優先で false（映像合成との両立は後続段）。
    const withLines = { ...base, lines: [{ lineId: 'line_001', text: 'a' }] } as unknown as Scene;
    expect(sceneAnimationActive(withLines, [anim], true)).toBe(false);
  });
});
