import { describe, expect, it } from 'vitest';
import { SCENE_MAX_DURATION_SEC, SCENE_MIN_DURATION_SEC } from '../constants';
import { clampSceneDuration } from './sceneDuration';

describe('clampSceneDuration（§7 durationのclamp・#411）', () => {
  it('範囲内はそのまま', () => {
    expect(clampSceneDuration(8)).toBe(8);
    expect(clampSceneDuration(SCENE_MIN_DURATION_SEC)).toBe(SCENE_MIN_DURATION_SEC);
    expect(clampSceneDuration(SCENE_MAX_DURATION_SEC)).toBe(SCENE_MAX_DURATION_SEC);
  });
  it('下限未満は下限へ（0・負・下限−1）', () => {
    expect(clampSceneDuration(0)).toBe(SCENE_MIN_DURATION_SEC);
    expect(clampSceneDuration(-5)).toBe(SCENE_MIN_DURATION_SEC);
    expect(clampSceneDuration(SCENE_MIN_DURATION_SEC - 1)).toBe(SCENE_MIN_DURATION_SEC);
  });
  it('上限超は上限へ', () => {
    expect(clampSceneDuration(SCENE_MAX_DURATION_SEC + 1)).toBe(SCENE_MAX_DURATION_SEC);
    expect(clampSceneDuration(999)).toBe(SCENE_MAX_DURATION_SEC);
  });
  it('NaN は下限へ（最小の有効値）', () => {
    expect(clampSceneDuration(NaN)).toBe(SCENE_MIN_DURATION_SEC);
  });
});
