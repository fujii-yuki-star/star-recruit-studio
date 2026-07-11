// 動画スロットがあるのに「レイアウトへ配置できない（穴を切り出せない）」状態の検出（#434・ADR-0026）。
// findVideoSlots はスロット（動画割り当て）を返すのに、layoutScene が role='slot' のアイテムを出さない場合
// （内部不整合、またはスロット要素/グループを非表示にした等）に splitVideoSceneSvgMulti は null を返す。
// これを黙って静止画へ落とすと「書き出したら動画が消えた」に見え、原因も次の行動も示せない（§2-5 違反）。
// precheck（事前警告）と書き出し（停止）が**同一判定**を共有できるよう純粋関数に切り出す。
import type { Asset, ElementAnimation, Scene } from '../../domain/project/types';
import type { Template } from '../../domain/template/types';
import { animationsEndSec, slotIsAnimated } from '../../domain/project/sceneAnimation';
import { VIDEO_START_MODE } from '../../domain/enums';
import { layoutScene } from '../layout';
import { findVideoSlots } from './findVideoSlot';
import { splitVideoSceneSvgMulti } from './videoSceneSplit';

/** この場面に動画スロットがあるのにレイアウトへ配置できない（分割失敗）か。動画スロットが無い場面は false。 */
export function videoSlotUnplaceable(
  scene: Scene,
  template: Template,
  assetById: (id: string) => Asset | undefined,
): boolean {
  const slots = findVideoSlots(scene, template, assetById);
  if (slots.length === 0) return false;
  const layout = layoutScene(scene, template);
  // null＝どれかのスロット id が role='slot' として layout に見つからない（＝穴を切り出せない）。
  return splitVideoSceneSvgMulti(layout, slots.map((s) => s.slotLayerId)) === null;
}

/**
 * 分割失敗する場面の**番号（1始まり・表示用）**を返す。テンプレ未解決の場面は対象外（別チェックが扱う）。
 * precheck の「動画の配置」警告で場面つきに案内するのに使う。番号は scenes 配列の位置＝利用者が見る場面番号。
 */
export function unplaceableVideoSceneNumbers(
  scenes: Scene[],
  templateById: Map<string, Template>,
  assetById: (id: string) => Asset | undefined,
): number[] {
  const out: number[] = [];
  scenes.forEach((s, i) => {
    const t = templateById.get(s.templateId);
    if (t && videoSlotUnplaceable(s, t, assetById)) out.push(i + 1);
  });
  return out;
}

/**
 * 動画スロットの再生開始が「アニメの後（afterAnim）」なのに、アニメが場面の最後まで続く（settled 区間が無い）ため
 * 動画が一度も再生されない degenerate 状態か（ADR-0027 D3・#444）。settled があれば afterAnim もそこで再生されるので false。
 * UI で afterAnim を選んだ後にアニメを場面尺いっぱいへ伸ばすと到達し得る。「黙って静止画」を避けるため precheck 警告と
 * 書き出し停止（buildExportScenes）が同一判定を共有する（#434 と同流儀）。
 * @param sceneAnims この場面のアニメ（timelineOverlay.animations を sceneId で絞ったもの）
 */
export function videoSlotAfterAnimNeverPlays(
  scene: Scene,
  template: Template,
  assetById: (id: string) => Asset | undefined,
  sceneAnims: ElementAnimation[],
): boolean {
  // settled 区間がある（animEnd < 尺）なら afterAnim もそこで再生される＝degenerate ではない。
  if (animationsEndSec(sceneAnims) < scene.durationSec) return false;
  return findVideoSlots(scene, template, assetById).some(
    (s) =>
      slotIsAnimated(sceneAnims, [s.slotLayerId], scene.groups) &&
      scene.slotVideoStart?.[s.slotLayerId]?.mode === VIDEO_START_MODE.afterAnim,
  );
}

/**
 * 上記 degenerate（afterAnim×settled 無し）の場面**番号（1始まり・表示用）**を返す。precheck の案内に使う。
 * @param animationsFor 場面→その場面のアニメ列（呼び出し側が timelineOverlay を sceneId で絞る）
 */
export function afterAnimNoSettledSceneNumbers(
  scenes: Scene[],
  templateById: Map<string, Template>,
  assetById: (id: string) => Asset | undefined,
  animationsFor: (scene: Scene) => ElementAnimation[],
): number[] {
  const out: number[] = [];
  scenes.forEach((s, i) => {
    const t = templateById.get(s.templateId);
    if (t && videoSlotAfterAnimNeverPlays(s, t, assetById, animationsFor(s))) out.push(i + 1);
  });
  return out;
}
