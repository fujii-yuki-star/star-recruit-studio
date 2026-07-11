import { describe, expect, it } from 'vitest';
import { clampClipTime, clampSpeed, resolveSlotClip } from './clip';
import { SPEED_DEFAULT, SPEED_MAX, SPEED_MIN } from '../constants';
import type { Clip, SlotClipOverride } from '../project/types';

describe('clampClipTime', () => {
  it('[0, max] に収める', () => {
    expect(clampClipTime(5, 10)).toBe(5);
    expect(clampClipTime(-2, 10)).toBe(0);
    expect(clampClipTime(12, 10)).toBe(10);
  });
  it('max 不明なら上限なし（下限0）', () => {
    expect(clampClipTime(999)).toBe(999);
    expect(clampClipTime(-1)).toBe(0);
  });
  it('min 指定（終了は開始以上にする等）', () => {
    expect(clampClipTime(3, 10, 5)).toBe(5);
    expect(clampClipTime(8, 10, 5)).toBe(8);
  });
  it('NaN・非有限は min（無効入力は下限へ）', () => {
    expect(clampClipTime(NaN, 10)).toBe(0);
    expect(clampClipTime(Infinity, 10, 4)).toBe(4);
    expect(clampClipTime(NaN, 10, 4)).toBe(4);
  });
  it('min > max のときは max が優先（絶対上限。呼び出し側は min ≤ max 前提）', () => {
    expect(clampClipTime(4, 3, 5)).toBe(3);
  });
});

describe('clampSpeed', () => {
  it('[SPEED_MIN, SPEED_MAX] に収める', () => {
    expect(clampSpeed(1.25)).toBe(1.25);
    expect(clampSpeed(0.1)).toBe(SPEED_MIN);
    expect(clampSpeed(5)).toBe(SPEED_MAX);
  });
  it('NaN・非有限は SPEED_DEFAULT', () => {
    expect(clampSpeed(NaN)).toBe(SPEED_DEFAULT);
    expect(clampSpeed(Infinity)).toBe(SPEED_DEFAULT);
  });
});

describe('resolveSlotClip（per-use 上書き＋asset.clip 継承・ADR-0028・#472）', () => {
  const base: Clip = { startSec: 1, endSec: 5, speed: 1, useOriginalAudio: true, originalAudioVolume: 0.4, fit: 'cover' };
  it('上書き無し（override 未設定）は asset.clip をそのまま継承', () => {
    expect(resolveSlotClip(undefined, base)).toEqual(base);
  });
  it('部分上書き＝そのフィールドだけ override・残りは base 継承', () => {
    const override: SlotClipOverride = { speed: 2 };
    expect(resolveSlotClip(override, base)).toEqual({ ...base, speed: 2 });
  });
  it('複数フィールド上書き（範囲・元音声）', () => {
    const override: SlotClipOverride = { startSec: 3, endSec: 4, useOriginalAudio: false, originalAudioVolume: 0.1 };
    expect(resolveSlotClip(override, base)).toEqual({ startSec: 3, endSec: 4, speed: 1, useOriginalAudio: false, originalAudioVolume: 0.1, fit: 'cover' });
  });
  it('fit は slotClips に無い＝base（素材既定）のまま（per-use fit は slotFits が担う）', () => {
    expect(resolveSlotClip({ speed: 1.5 }, base).fit).toBe('cover');
  });
  it('base 未設定（asset.clip 無し）でも override だけで解決', () => {
    expect(resolveSlotClip({ startSec: 2, speed: 0.5 }, undefined)).toEqual({ startSec: 2, endSec: undefined, useOriginalAudio: undefined, originalAudioVolume: undefined, speed: 0.5, fit: undefined });
  });
  it('override=0/false は有効な上書き（?? が拾う・falsy でも継承に落ちない）', () => {
    expect(resolveSlotClip({ startSec: 0, useOriginalAudio: false }, base)).toMatchObject({ startSec: 0, useOriginalAudio: false });
  });
});
