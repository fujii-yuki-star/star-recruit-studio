import { describe, expect, it } from 'vitest';
import { resolveVideoStartDelaySec, clipTimeAtSceneTime } from './videoStartTiming';
import { VIDEO_START_MODE } from '../enums';
import type { VideoStartSpec } from './types';

describe('resolveVideoStartDelaySec（モード→遅延秒・#444・ADR-0027）', () => {
  const W = 2; // 窓尺（アニメ区間長）
  it('未設定は 0（アニメと同時・#442 既定）', () => {
    expect(resolveVideoStartDelaySec(undefined, W)).toBe(0);
  });
  it('withAnim は 0', () => {
    expect(resolveVideoStartDelaySec({ mode: VIDEO_START_MODE.withAnim }, W)).toBe(0);
  });
  it('afterAnim は W（窓の間は待ち、settled から）', () => {
    expect(resolveVideoStartDelaySec({ mode: VIDEO_START_MODE.afterAnim }, W)).toBe(2);
  });
  it('delay は delaySec（途中から）', () => {
    expect(resolveVideoStartDelaySec({ mode: VIDEO_START_MODE.delay, delaySec: 0.6 }, W)).toBeCloseTo(0.6, 6);
  });
  it('delay は [0, W] にクランプ（保存値が W 超でも実効は W・アニメ短縮時の安全劣化）', () => {
    expect(resolveVideoStartDelaySec({ mode: VIDEO_START_MODE.delay, delaySec: 99 }, W)).toBe(2);
    expect(resolveVideoStartDelaySec({ mode: VIDEO_START_MODE.delay, delaySec: -1 }, W)).toBe(0);
  });
  it('delay で delaySec 欠落は 0 扱い（schema では拒否されるが関数は堅牢に）', () => {
    expect(resolveVideoStartDelaySec({ mode: VIDEO_START_MODE.delay } as VideoStartSpec, W)).toBe(0);
  });
  it('W=0（アニメ無し等）は常に 0', () => {
    expect(resolveVideoStartDelaySec({ mode: VIDEO_START_MODE.afterAnim }, 0)).toBe(0);
    expect(resolveVideoStartDelaySec({ mode: VIDEO_START_MODE.delay, delaySec: 1 }, 0)).toBe(0);
  });
});

describe('clipTimeAtSceneTime（クリップ再生位置・preview=export 共有・#444）', () => {
  const opts = { startDelaySec: 0.5, clipStartSec: 2, speed: 1 };
  it('[0, d] は clipStart に張り付く（代表フレームで静止）', () => {
    expect(clipTimeAtSceneTime(0, opts)).toBe(2);
    expect(clipTimeAtSceneTime(0.5, opts)).toBe(2); // ちょうど d
    expect(clipTimeAtSceneTime(0.25, opts)).toBe(2); // d の途中も静止
  });
  it('[d, …] は clipStart から再生（t−d ぶん進む）', () => {
    expect(clipTimeAtSceneTime(1.5, opts)).toBeCloseTo(2 + 1.0, 6); // (1.5−0.5)*1
  });
  it('d=0（同時）は clipStart + t*speed（#442 既定＝後方互換）', () => {
    expect(clipTimeAtSceneTime(1, { startDelaySec: 0, clipStartSec: 3, speed: 1 })).toBe(4);
  });
  it('speed を反映（2倍速は t−d の2倍進む）', () => {
    expect(clipTimeAtSceneTime(1.5, { startDelaySec: 0.5, clipStartSec: 0, speed: 2 })).toBeCloseTo(2.0, 6);
  });
  it('settled 開始 = clipTimeAtSceneTime(W) = clipStart + (W−d)*speed（窓の続き）', () => {
    const W = 3;
    expect(clipTimeAtSceneTime(W, { startDelaySec: 1, clipStartSec: 5, speed: 1 })).toBe(5 + (3 - 1));
  });
});
