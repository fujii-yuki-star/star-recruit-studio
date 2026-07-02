// キーフレームアニメ（④・ADR-0019）の「この場面で per-frame 描画を適用するか」を判定する純粋ロジック。
// preview（ScenePreview 経由）と export（buildExportScenes）がこの単一判定を共有し、
// 「プレビューでは動くのに書き出しMP4は静止」というパリティ破れ（ADR-0001 の生命線）を防ぐ。
import type { ElementAnimation, Scene } from './types';

/**
 * 場面にキーフレームアニメ（毎フレーム描画）を適用するか。
 * 適用条件＝アニメがある かつ 掛け合い（行セグメント分割）でない かつ 動画スロット（下/上合成）を伴わない。
 * 掛け合い・動画スロット併用のアニメは後続段（字幕の行分割・映像合成との両立が要る）＝現段階では静止扱いにする。
 * preview と export がこの関数を共有することで両者の適用条件が構造的に一致する（ADR-0001 パリティ）。
 * @param hasVideoSlot この場面に動画スロットがあるか（findVideoSlot の解決結果・呼び出し側が算出）
 */
export function sceneAnimationActive(
  scene: Scene,
  animations: ElementAnimation[] | undefined,
  hasVideoSlot: boolean,
): boolean {
  if (!animations || animations.length === 0) return false;
  if (scene.lines && scene.lines.length > 0) return false; // 掛け合いは行セグメント優先
  if (hasVideoSlot) return false; // 動画スロットは映像合成優先
  return true;
}
