// キーフレームアニメ（④・ADR-0019）の「この場面で per-frame 描画を適用するか」を判定する純粋ロジック。
// preview（ScenePreview 経由）と export（buildExportScenes）がこの単一判定を共有し、
// 「プレビューでは動くのに書き出しMP4は静止」というパリティ破れ（ADR-0001 の生命線）を防ぐ。
import type { ElementAnimation, Scene } from './types';
import type { Group } from '../group/types';
import { groupElementIds } from './groupOps';

/**
 * 場面にキーフレームアニメ（毎フレーム描画）を適用するか。適用条件＝アニメがある。
 * **非掛け合いは動画スロットの有無に依らず適用**＝動画スロット場面は下/中/上の静止層すべてを per-frame の
 * 画像列にして動画へ overlay する（#435・ADR-0019 の動画スロット除外を解除＝背景/動画間/前景/グループの要素が動く）。
 * **動画スロット本体（矩形）がアニメ対象のときは** buildExportScenes が「アニメ区間はスロットもサムネで場面全体を
 * per-frame＋settled 区間で実動画」の2段に分けて位置/拡縮/回転/不透明度も一致させる（#442・下記 slotIsAnimated で判定）。
 * **掛け合い（行セグメント分割）は非動画のみ**＝各行区間ごとに毎フレーム描画（③）。動画スロット×掛け合いの
 * アニメは行区間×フレームの二重で複雑なため v1 未対応（静止・後続）。
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
 * この場面のアニメが「動画スロット本体」を動かすか（#442・ADR-0019 追補）。スロット層 id を直接の対象にする
 * アニメ、またはスロットを（推移的に）含むグループ対象のアニメがあれば true。
 * true のとき書き出しは「アニメ区間はスロットもサムネで場面全体を焼く（Frames）＋settled 区間で実動画を最終位置で
 * 流す」に切替える。false（アニメはスロット以外のみ）のときは動画は基準位置で固定（#435 の per-frame 静止層経路で足りる）。
 * 動画の overlay 固定座標では位置/拡縮/回転/不透明度がプレビューと乖離するため、この判定で経路を分ける（ADR-0001/0026）。
 * @param slotLayerIds findVideoSlots が返すスロット層/要素 id（layout アイテム id）
 * @param groups 場面のグループ（FREE のみ・未指定/空は「スロット直接指定」だけ見る）
 */
export function slotIsAnimated(
  animations: ElementAnimation[] | undefined,
  slotLayerIds: readonly string[],
  groups: Group[] | undefined,
): boolean {
  if (!animations || animations.length === 0 || slotLayerIds.length === 0) return false;
  const slotSet = new Set(slotLayerIds);
  const gs = groups ?? [];
  for (const a of animations) {
    if (slotSet.has(a.targetId)) return true;
    // a.targetId がグループなら配下の葉要素 id、要素なら [] が返る（groupElementIds は循環/ネスト対応）。
    if (groupElementIds(gs, a.targetId).some((m) => slotSet.has(m))) return true;
  }
  return false;
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
