// 見た目パターンの選択整合（ADR-0012・#415）。純粋関数（副作用なし・テスト容易）。
import type { Orientation, SceneCategory } from '../enums';
import type { Template } from './types';

/**
 * 場面編集の見た目ピッカーに出すテンプレ一覧。**同じ場面カテゴリ（scene.sceneType↔template.category）＋同じ向き**に絞る。
 * ＝向き不一致・別カテゴリの崩れた動画を作らせない（11 §2.1／ADR-0012）。
 * 現在のテンプレ（current）は絞り込みに入らなくても必ず含める（旧データ等の不一致でも選択値を見せる＝選択の消失を防ぐ）。
 * 当該カテゴリ・向きにテンプレが1つ（現行のみ）のときは呼び出し側で「他に無い」旨を案内する。
 */
export function pickableTemplatesForScene(
  templates: Template[],
  sceneType: SceneCategory,
  orientation: Orientation,
  current: Template | undefined,
): Template[] {
  const matches = templates.filter((t) => t.category === sceneType && t.aspectRatio === orientation);
  return current && !matches.some((t) => t.templateId === current.templateId)
    ? [current, ...matches]
    : matches;
}
