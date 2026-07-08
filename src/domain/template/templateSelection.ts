// 見た目パターンの選択整合（ADR-0012・#415）。純粋関数（副作用なし・テスト容易）。
import type { Orientation, SceneCategory } from '../enums';
import type { Template } from './types';

/** 場面編集の見た目ピッカーに渡す整合結果（#415）。 */
export interface PickableTemplates {
  /** そのまま選べる見た目＝同じ場面カテゴリ（scene.sceneType↔template.category）＋同じ向き（11 §2.1／ADR-0012）。 */
  options: Template[];
  /**
   * 現在のテンプレが向き/カテゴリ不一致のときの、それ（旧データ等）。表示用＝選択値を消さないために出すが、
   * **有効な選択肢（options）とは分ける**＝「整合済み」に見せない（不一致を明示・選択不可にして選び直させる・#415 P2）。
   */
  mismatchedCurrent?: Template;
}

/**
 * 見た目ピッカーの選択肢を「同じ場面カテゴリ＋同じ向き」に絞る（ADR-0012・#415）＝向き不一致・別カテゴリの崩れた動画を作らせない。
 * 現在のテンプレがその絞り込みに入らない（旧データ等の不一致）場合は options には入れず mismatchedCurrent として返す
 *（呼び出し側で「合っていない・選び直して」と明示し、選択不可で表示＝整合済みに見せない）。純粋関数。
 */
export function pickableTemplatesForScene(
  templates: Template[],
  sceneType: SceneCategory,
  orientation: Orientation,
  current: Template | undefined,
): PickableTemplates {
  const options = templates.filter((t) => t.category === sceneType && t.aspectRatio === orientation);
  const mismatchedCurrent =
    current && !options.some((t) => t.templateId === current.templateId) ? current : undefined;
  return { options, mismatchedCurrent };
}
