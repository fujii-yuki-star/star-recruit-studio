// キーフレームアニメ（④・ADR-0019）の「この場面で per-frame 描画を適用するか」を判定する純粋ロジック。
// preview（ScenePreview 経由）と export（buildExportScenes）がこの単一判定を共有し、
// 「プレビューでは動くのに書き出しMP4は静止」というパリティ破れ（ADR-0001 の生命線）を防ぐ。
import type { ElementAnimation, Scene } from './types';

/**
 * 場面にキーフレームアニメ（毎フレーム描画）を適用するか。適用条件＝アニメがある。
 * **非掛け合いは動画スロットの有無に依らず適用**＝動画スロット場面は前景（最上層＝above）を per-frame の
 * 画像列にして動画へ overlay する（#435・ADR-0019 の動画スロット除外を解除。背景/動画間の要素のアニメは v1 では
 * 静止＝現実のアニメは前景ゆえ通常問題なし）。**掛け合い（行セグメント分割）は非動画のみ**＝各行区間ごとに毎フレーム
 * 描画（③）。動画スロット×掛け合いのアニメは行区間×フレームの二重で複雑なため v1 未対応（静止・後続）。
 * preview と export がこの関数を共有することで両者の適用条件が構造的に一致する（ADR-0001 パリティ）。
 * @param scene 場面（掛け合い判定に使う）
 * @param hasVideoSlot この場面に動画スロットがあるか（findVideoSlots の解決結果・呼び出し側が算出）
 */
export function sceneAnimationActive(
  scene: Scene,
  animations: ElementAnimation[] | undefined,
  hasVideoSlot: boolean,
): boolean {
  if (!animations || animations.length === 0) return false;
  // 動画スロット×掛け合いのアニメは v1 未対応（行区間×フレームの二重合成＝後続）＝静止。
  if (hasVideoSlot && !!(scene.lines && scene.lines.length > 0)) return false;
  return true;
}

/**
 * 与えたアニメーション群の「最後のキーフレーム時刻」（場面ローカル秒）。アニメが無い/空なら 0。
 * ADR-0019 の補間はこの時刻以降レイアウトが一定（最終キーフレーム値でクランプ）になるため、
 * 書き出しは [0, animEnd] だけを per-frame 描画し、以降は最終フレームを保持すればよい（#376 の高速化）。
 * keyframes は timeSec 昇順が正だが、順不同でも安全なよう max を取る。
 */
export function animationsEndSec(animations: ElementAnimation[] | undefined): number {
  if (!animations || animations.length === 0) return 0;
  let end = 0;
  for (const a of animations) {
    for (const k of a.keyframes) {
      if (k.timeSec > end) end = k.timeSec;
    }
  }
  return end;
}
