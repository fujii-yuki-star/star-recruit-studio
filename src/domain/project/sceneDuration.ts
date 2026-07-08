// 場面の表示時間（秒）の範囲クランプ（§7「durationのclamp」＝必ずテストする純粋ロジック・#411）。副作用なし。
import { SCENE_MAX_DURATION_SEC, SCENE_MIN_DURATION_SEC } from '../constants';

/**
 * 場面の表示時間（秒）を正典の範囲 [SCENE_MIN_DURATION_SEC, SCENE_MAX_DURATION_SEC] にクランプする。
 * NaN は下限（最小の有効値）に落とす。UI の確定（blur）で有効値だけを store に入れるために使う（範囲外値を保存しない）。
 */
export function clampSceneDuration(value: number): number {
  if (Number.isNaN(value)) return SCENE_MIN_DURATION_SEC;
  return Math.min(SCENE_MAX_DURATION_SEC, Math.max(SCENE_MIN_DURATION_SEC, value));
}
