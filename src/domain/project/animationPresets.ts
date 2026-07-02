// キーフレームアニメの簡易プリセット（④・ADR-0019 (1c)/(2)）。純粋・決定論（§7 テスト対象）。
// 場面編集の簡易オーサリングが使う（詳細な手動キーフレーム編集は将来タイムライン＝上位仕上げ面・ADR-0023）。
// プリセットは「登場の動き」を2キーフレームで表す。描画（x/y/scale/rotation/opacity 補間）は layoutScene(t) 側（(1a)）。
import { EASING } from '../enums';
import type { Easing } from '../enums';
import type { FreeElement, Keyframe } from './types';

/** プリセットの所要秒（既定/下限/上限）。場面尺に依らず操作できる簡易範囲。 */
export const PRESET_DEFAULT_SEC = 0.6;
export const PRESET_MIN_SEC = 0.1;
export const PRESET_MAX_SEC = 5;
/** スライドで「登場」させる初期オフセット（キャンバス座標・px）。はっきり動きが分かる既定量。 */
export const SLIDE_DISTANCE = 400;
/** ポップの開始拡大率（schema は scale>0 のため 0 は使えない＝小さめから等倍へ）。 */
export const POP_START_SCALE = 0.3;
/** 回転で登場する初期角度（度・負＝反時計回りから戻す）。 */
export const SPIN_START_DEG = -180;

/** 動きの種類（オーサリングUI用。keyframes から導出でき、永続化はしない）。 */
export const PRESET_KINDS = ['fade', 'slide', 'pop', 'spin'] as const;
export type PresetKind = (typeof PRESET_KINDS)[number];
/** スライドの向き（どこから入るか）。 */
export const SLIDE_DIRECTIONS = ['left', 'right', 'up', 'down'] as const;
export type SlideDirection = (typeof SLIDE_DIRECTIONS)[number];

const clampDur = (s: number): number => Math.max(PRESET_MIN_SEC, Math.min(PRESET_MAX_SEC, s));
const clampOpacity = (o: number): number => Math.max(0, Math.min(1, o));

/** フェードイン（ふわっと・不透明度 0 → 本来値）。終点KFにイージング（区間 [前,当] のイージング＝当KF.easing）。 */
export function fadeInKeyframes(endOpacity: number, durationSec: number, easing: Easing = EASING.easeInOut): Keyframe[] {
  return [
    { timeSec: 0, opacity: 0 },
    { timeSec: clampDur(durationSec), opacity: clampOpacity(endOpacity), easing },
  ];
}

/** スライドイン（すべって・本来位置からのオフセット→0＋フェード）。x/y は相対＝要素を後から動かしても追従（layout 側で加算）。 */
export function slideInKeyframes(el: FreeElement, direction: SlideDirection, durationSec: number, easing: Easing = EASING.easeInOut): Keyframe[] {
  const end = clampOpacity(el.opacity ?? 1);
  const horizontal = direction === 'left' || direction === 'right';
  const offset = direction === 'left' || direction === 'up' ? -SLIDE_DISTANCE : SLIDE_DISTANCE;
  const start: Keyframe = { timeSec: 0, opacity: 0, ...(horizontal ? { x: offset } : { y: offset }) };
  const endKf: Keyframe = { timeSec: clampDur(durationSec), opacity: end, easing, ...(horizontal ? { x: 0 } : { y: 0 }) };
  return [start, endKf];
}

/** ポップ（ぽんっと・小さく→等倍＋フェード）。scale は係数で layout が中心維持＝x/y の焼き込み不要（位置編集に追従）。 */
export function popInKeyframes(el: FreeElement, durationSec: number, easing: Easing = EASING.easeInOut): Keyframe[] {
  const end = clampOpacity(el.opacity ?? 1);
  return [
    { timeSec: 0, scale: POP_START_SCALE, opacity: 0 },
    { timeSec: clampDur(durationSec), scale: 1, opacity: end, easing },
  ];
}

/** 回転で登場（くるっと・本来角度からのオフセット→0＋フェード）。rotation は相対＝要素の角度を変えても追従。 */
export function spinInKeyframes(el: FreeElement, durationSec: number, easing: Easing = EASING.easeInOut): Keyframe[] {
  const end = clampOpacity(el.opacity ?? 1);
  return [
    { timeSec: 0, rotation: SPIN_START_DEG, opacity: 0 },
    { timeSec: clampDur(durationSec), rotation: 0, opacity: end, easing },
  ];
}

/** 種類・向き・秒・イージングからキーフレーム列を作る（オーサリングUIの単一入口）。 */
export function presetKeyframes(
  kind: PresetKind,
  el: FreeElement,
  opts: { durationSec: number; easing: Easing; direction?: SlideDirection },
): Keyframe[] {
  const { durationSec, easing, direction } = opts;
  switch (kind) {
    case 'fade':
      return fadeInKeyframes(el.opacity ?? 1, durationSec, easing);
    case 'slide':
      return slideInKeyframes(el, direction ?? 'left', durationSec, easing);
    case 'pop':
      return popInKeyframes(el, durationSec, easing);
    case 'spin':
      return spinInKeyframes(el, durationSec, easing);
  }
}

/** アニメの所要秒（末尾KFの timeSec）。UIで現在値を表示するのに使う。 */
export function presetDurationSec(keyframes: readonly Keyframe[]): number {
  return keyframes[keyframes.length - 1]?.timeSec ?? PRESET_DEFAULT_SEC;
}

/** キーフレームの終点の不透明度だけを差し替える（種類は変えない）。図形の透明度スライダー連動に使う。 */
export function withEndOpacity(keyframes: readonly Keyframe[], endOpacity: number): Keyframe[] {
  const clamped = clampOpacity(endOpacity);
  const lastIdx = keyframes.length - 1;
  return keyframes.map((k, i) => (i === lastIdx && k.opacity != null ? { ...k, opacity: clamped } : { ...k }));
}

/**
 * キーフレーム列から、オーサリングUIが必要とする「種類・所要秒・イージング・向き」を導出する（永続化しない）。
 * 種類は主となる補間プロパティで判定：scale→pop / rotation→spin / x|y→slide / それ以外(opacity のみ)→fade。
 * 向きは開始KFのオフセット符号（相対値）で判定＝要素を後から動かしても不変。プリセット由来のアニメを前提。判定不能は null。
 */
export function describeAnimation(
  keyframes: readonly Keyframe[],
): { kind: PresetKind | null; durationSec: number; easing: Easing; direction: SlideDirection } {
  const durationSec = presetDurationSec(keyframes);
  const last = keyframes[keyframes.length - 1];
  const easing: Easing = last?.easing ?? EASING.linear;
  const has = (p: keyof Keyframe): boolean => keyframes.some((k) => k[p] != null);
  let kind: PresetKind | null = null;
  if (keyframes.length === 0) kind = null;
  else if (has('scale')) kind = 'pop';
  else if (has('rotation')) kind = 'spin';
  else if (has('x') || has('y')) kind = 'slide';
  else if (has('opacity')) kind = 'fade';
  // スライドの向きは開始KFのオフセット符号で判定（x 優先→y）。相対値なので要素位置に依らず一定。
  const first = keyframes[0];
  let direction: SlideDirection = 'left';
  if (first) {
    if (first.x != null && first.x !== 0) direction = first.x < 0 ? 'left' : 'right';
    else if (first.y != null && first.y !== 0) direction = first.y < 0 ? 'up' : 'down';
  }
  return { kind, durationSec, easing, direction };
}
