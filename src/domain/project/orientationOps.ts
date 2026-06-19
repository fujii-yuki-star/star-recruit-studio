// 既存プロジェクトの向き変更（16:9⇆9:16・B5-b・ADR-0012）。各場面のテンプレを同カテゴリ・目標向きへ写像する。
// 純粋関数（副作用なし）。assetRefs/テキスト/セリフ等は保持し、配置は新テンプレの slot 幾何に従って描画側が再フィットする。
import type { Orientation } from '../enums';
import type { Scene } from './types';
import type { Template } from '../template/types';

export interface OrientationChangeResult {
  /** 写像後の場面一覧（変更が無い場面は元の参照のまま）。 */
  scenes: Scene[];
  /** 向きを切り替えた場面数。 */
  changed: number;
  /** 目標向きの同カテゴリ・テンプレが無く切り替えられなかった場面数（原状維持）。 */
  unsupported: number;
}

/**
 * 全場面のテンプレを目標の向きへ写像する。各場面を「同カテゴリ・目標向き」のテンプレへ差し替える。
 * 既に目標向きの場面はそのまま。目標向きの同カテゴリ・テンプレが無い場面は原状維持し unsupported に数える
 * （横型は一部カテゴリのみ＝縦→横で変換先が無い場面が出うる・ADR-0012）。
 */
export function changeScenesOrientation(
  scenes: Scene[],
  templates: Template[],
  target: Orientation,
): OrientationChangeResult {
  const byId = new Map(templates.map((t) => [t.templateId, t] as const));
  let changed = 0;
  let unsupported = 0;
  const next = scenes.map((scene) => {
    const current = byId.get(scene.templateId);
    if (current?.aspectRatio === target) return scene; // 既に目標向き＝変更不要
    const alt = templates.find((t) => t.category === scene.sceneType && t.aspectRatio === target);
    if (!alt) {
      unsupported += 1;
      return scene;
    }
    changed += 1;
    return { ...scene, templateId: alt.templateId };
  });
  return { scenes: next, changed, unsupported };
}
