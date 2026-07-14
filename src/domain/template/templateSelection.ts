// 見た目パターンの選択整合（ADR-0012・#415／FREE 全場面化・0.4.2 動確）。純粋関数（副作用なし・テスト容易）。
import { FREE_CATEGORY } from '../enums';
import type { Orientation, SceneCategory } from '../enums';
import type { Template } from './types';

/** 場面編集の見た目ピッカーに渡す整合結果（#415）。 */
export interface PickableTemplates {
  /** そのまま選べる見た目＝同じ向きで、同じ場面カテゴリ＋FREE（自由配置は全場面で選べる）。FREE 場面はどのカテゴリへも切替可。 */
  options: Template[];
  /**
   * 現在のテンプレが向き不一致のときの、それ（旧データ等）。表示用＝選択値を消さないために出すが、
   * **有効な選択肢（options）とは分ける**＝「整合済み」に見せない（不一致を明示・選択不可にして選び直させる・#415 P2）。
   */
  mismatchedCurrent?: Template;
}

/**
 * 見た目ピッカーの選択肢を返す。同じ向き（ADR-0012）で、
 * - **同じ場面カテゴリの見た目**（役割どおり・#415）、
 * - **FREE（自由配置）は全場面で選べる**（0.4.2 動確・利用者要望＝どのシーンでも自由配置へ切替可・選ぶと FREE 化＝`switchSceneTemplate` が sceneType を追従）、
 * - **FREE 場面はどのカテゴリの見た目へも切替可**（FREE 化から元の役割の見た目へ戻れる＝一方通行の罠を防ぐ）。
 * 向きが合わない現行テンプレは options に入れず mismatchedCurrent として返す（呼び出し側で「合っていない・選び直して」と明示）。純粋関数。
 */
export function pickableTemplatesForScene(
  templates: Template[],
  sceneType: SceneCategory,
  orientation: Orientation,
  current: Template | undefined,
): PickableTemplates {
  const options = templates.filter(
    (t) =>
      t.aspectRatio === orientation &&
      (t.category === sceneType || // 同じ役割の見た目
        t.category === FREE_CATEGORY || // FREE は全場面で選べる（自由配置への切替）
        sceneType === FREE_CATEGORY), // FREE 場面はどのカテゴリへも戻れる
  );
  const mismatchedCurrent =
    current && !options.some((t) => t.templateId === current.templateId) ? current : undefined;
  return { options, mismatchedCurrent };
}
