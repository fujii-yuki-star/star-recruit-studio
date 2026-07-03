// キーフレームアニメ（④・ADR-0019）の「この場面で per-frame 描画を適用するか」を判定する純粋ロジック。
// preview（ScenePreview 経由）と export（buildExportScenes）がこの単一判定を共有し、
// 「プレビューでは動くのに書き出しMP4は静止」というパリティ破れ（ADR-0001 の生命線）を防ぐ。
import type { ElementAnimation, Scene } from './types';

/**
 * 場面にキーフレームアニメ（毎フレーム描画）を適用するか。
 * 適用条件＝アニメがある かつ 動画スロット（下/上合成）を伴わない。
 * **掛け合い（行セグメント分割）も対応**＝各行の区間ごとに毎フレーム描画する（③・buildExportScenes が
 * 行セグメント×フレーム列で焼く。preview は行字幕＋アニメを同一 layoutScene(t) で描く）。
 * 動画スロット併用のアニメは引き続き後続段（映像合成との両立が要る）＝静止扱い。
 * preview と export がこの関数を共有することで両者の適用条件が構造的に一致する（ADR-0001 パリティ）。
 * @param _scene 場面（現状は判定に未使用＝掛け合いも対応したため。呼び出し側の可読性と将来拡張のため残す）
 * @param hasVideoSlot この場面に動画スロットがあるか（findVideoSlot の解決結果・呼び出し側が算出）
 */
export function sceneAnimationActive(
  _scene: Scene,
  animations: ElementAnimation[] | undefined,
  hasVideoSlot: boolean,
): boolean {
  if (!animations || animations.length === 0) return false;
  if (hasVideoSlot) return false; // 動画スロットは映像合成優先（掛け合いは行セグメント×フレームで対応・③）
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
