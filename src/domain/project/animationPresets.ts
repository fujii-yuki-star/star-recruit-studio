// キーフレームアニメの簡易プリセット（④・ADR-0019 (1c)）。純粋・決定論（§7 テスト対象）。
// 場面編集の簡易オーサリングが使う（詳細なキーフレーム編集は将来タイムライン＝上位仕上げ面・ADR-0023）。
import { EASING } from '../enums';
import type { Keyframe } from './types';

/** フェードイン（ふわっと表示）の既定の所要秒。 */
export const FADE_IN_DEFAULT_SEC = 0.6;
/** フェードインで指定できる所要秒の下限/上限（場面尺に依らず操作できる簡易範囲）。 */
export const FADE_IN_MIN_SEC = 0.1;
export const FADE_IN_MAX_SEC = 5;

/**
 * フェードイン（不透明度 0 → endOpacity）のキーフレーム列を作る。
 * 終点（endOpacity）＝要素の本来の不透明度（図形は el.opacity、文字/画像は 1）。区間のイージングは終点KFに載せる
 * （keyframes.ts の規約＝「区間 [前KF, 当KF] のイージングは当KF.easing」）。ease-in-out で緩急のある自然な出現に。
 */
export function fadeInKeyframes(endOpacity: number, durationSec: number): Keyframe[] {
  const end = Math.max(0, Math.min(1, endOpacity));
  const dur = Math.max(FADE_IN_MIN_SEC, Math.min(FADE_IN_MAX_SEC, durationSec));
  return [
    { timeSec: 0, opacity: 0 },
    { timeSec: dur, opacity: end, easing: EASING.easeInOut },
  ];
}

/** フェードインの所要秒を読む（末尾KFの timeSec）。既存アニメの編集UIで現在値を表示するのに使う。無ければ既定。 */
export function fadeInDurationOf(keyframes: readonly Keyframe[]): number {
  const last = keyframes[keyframes.length - 1];
  return last?.timeSec ?? FADE_IN_DEFAULT_SEC;
}
