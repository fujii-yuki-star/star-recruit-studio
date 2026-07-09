// 見た目パターン（テンプレ）がどの場面で使われているかの検出（純粋ロジック・§7・#406）。
// 場面は scene.templateId でテンプレを参照する。素材の assetUsage と対で置き、逆引き導線（使用場面バッジ）で共有する。
import type { Scene } from './types';
import type { Template } from '../template/types';

/** この見た目（テンプレ）を使っている場面の配列（順序は scenes のまま）。逆引き（#406）に使う。 */
export function scenesUsingTemplate(scenes: Scene[], templateId: string): Scene[] {
  return scenes.filter((s) => s.templateId === templateId);
}

/**
 * 削除された（グローバル）ユーザーテンプレを参照している場面を、標準（同カテゴリ・同じ向き）へ置換する（#458・06_UI_SPEC §9）。
 * ユーザーテンプレはグローバル削除できるため、参照していた場面が孤立参照（存在しない templateId）になるのを、削除と同時に
 * 開いているプロジェクト側で標準へ置換して防ぐ。置換方針は AI 変換の TEMPLATE_NOT_FOUND 補正（transformPlan）と同じ
 * ＝同カテゴリ・同じ向きの見た目。代替が無い場面は原状維持（読込/描画時の §9 補正が honest 表示＝手動選択へ促す）。
 * 変化が無ければ同一参照を返す（未保存/再描画を無駄に起こさない・sceneOps と同流儀）。
 */
export function substituteDeletedTemplateInScenes(
  scenes: Scene[],
  deletedTemplateId: string,
  availableTemplates: Template[],
  orientation: Template['aspectRatio'],
): Scene[] {
  let changed = false;
  const next = scenes.map((sc) => {
    if (sc.templateId !== deletedTemplateId) return sc;
    const alt = availableTemplates.find(
      (t) => t.templateId !== deletedTemplateId && t.category === sc.sceneType && t.aspectRatio === orientation,
    );
    if (!alt) return sc; // 代替が無ければ原状維持（§9 補正が読込/描画時に対応）。
    changed = true;
    return { ...sc, templateId: alt.templateId };
  });
  return changed ? next : scenes;
}
