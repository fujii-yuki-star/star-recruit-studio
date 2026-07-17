import { describe, expect, it } from 'vitest';
import { SCENE_DEFAULT_DURATION_SEC, VIDEO_HARD_MAX_SEC } from '../constants';
import { clampSceneDuration } from './sceneDuration';

// #553：場面ごとの上限/下限は持たない（旧 [3,15] は AI 生成の“目安”がハード適用されていたもので、技術要件でも
// schema 制約でもなかった）。縛るのは動画全体の上限だけ。守るのは schema 不変条件の durationSec > 0。
describe('clampSceneDuration（§7 durationのclamp・#411/#553）', () => {
  it('正の値はそのまま通す＝場面ごとの上限/下限で丸めない', () => {
    expect(clampSceneDuration(8)).toBe(8);
    expect(clampSceneDuration(1)).toBe(1); // 旧下限(3)未満でも通る
    expect(clampSceneDuration(0.5)).toBe(0.5); // 秒（実数）が正準＝小数もそのまま
    expect(clampSceneDuration(60)).toBe(60); // 旧上限(15)超でも通る＝#553 の主目的
    expect(clampSceneDuration(VIDEO_HARD_MAX_SEC)).toBe(VIDEO_HARD_MAX_SEC);
  });

  it('動画全体の上限を超えたらそこで頭打ち（唯一残る上限）', () => {
    expect(clampSceneDuration(VIDEO_HARD_MAX_SEC + 1)).toBe(VIDEO_HARD_MAX_SEC);
    expect(clampSceneDuration(99999)).toBe(VIDEO_HARD_MAX_SEC);
  });

  it('0・負・NaN・Infinity は壊れた入力＝既定尺へ（0秒の場面を作らせない＝schema durationSec > 0）', () => {
    expect(clampSceneDuration(0)).toBe(SCENE_DEFAULT_DURATION_SEC);
    expect(clampSceneDuration(-5)).toBe(SCENE_DEFAULT_DURATION_SEC);
    expect(clampSceneDuration(NaN)).toBe(SCENE_DEFAULT_DURATION_SEC);
    expect(clampSceneDuration(Infinity)).toBe(SCENE_DEFAULT_DURATION_SEC);
  });
});
