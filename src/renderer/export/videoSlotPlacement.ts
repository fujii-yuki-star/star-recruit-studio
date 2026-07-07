// 動画スロットがあるのに「レイアウトへ配置できない（穴を切り出せない）」状態の検出（#434・ADR-0026）。
// findVideoSlots はスロット（動画割り当て）を返すのに、layoutScene が role='slot' のアイテムを出さない場合
// （内部不整合、またはスロット要素/グループを非表示にした等）に splitVideoSceneSvgMulti は null を返す。
// これを黙って静止画へ落とすと「書き出したら動画が消えた」に見え、原因も次の行動も示せない（§2-5 違反）。
// precheck（事前警告）と書き出し（停止）が**同一判定**を共有できるよう純粋関数に切り出す。
import type { Asset, Scene } from '../../domain/project/types';
import type { Template } from '../../domain/template/types';
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
