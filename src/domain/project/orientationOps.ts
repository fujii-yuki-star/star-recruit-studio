// 既存プロジェクトの向き変更（16:9⇆9:16・B5-b・ADR-0012）。各場面のテンプレを同カテゴリ・目標向きへ写像する。
// 純粋関数（副作用なし）。assetRefs/テキスト/セリフ等は保持し、配置は新テンプレの slot 幾何に従って描画側が再フィットする。
import type { Orientation } from '../enums';
import type { Scene, Warning } from './types';
import type { Template } from '../template/types';

// 向き不一致の警告コード（15 §6 の語彙）。B4 transformPlan と同一コードで一貫させる。
const ORIENTATION_MISMATCH_CODE = 'TEMPLATE_ORIENTATION_MISMATCH';

export interface OrientationChangeResult {
  /** 写像後の場面一覧（変更が無い場面は元の参照のまま）。 */
  scenes: Scene[];
  /** 向きを切り替えた場面数。 */
  changed: number;
  /** 目標向きの同カテゴリ・テンプレが無く切り替えられなかった場面数（原状維持＝scene.warnings に記録）。 */
  unsupported: number;
}

/**
 * 全場面のテンプレを目標の向きへ写像する。各場面を「同カテゴリ・目標向き」のテンプレへ差し替える。
 * 既に目標向きの場面はそのまま。目標向きの同カテゴリ・テンプレが無い場面は原状維持し、
 * 向き不一致を scene.warnings に記録する（11.9。横型は一部カテゴリのみ＝縦→横で変換先が無い場面が出うる・ADR-0012）。
 * テンプレ選択は category＋aspectRatio の最初の一致（schema に「標準」マーカーは無い）。
 * **マイ見た目も当て先に含める**（利用者が自分のプロジェクトの向きを変える操作なので、自作の見た目に寄るのは自然）。
 * 取り込み（AI 変換）と削除時の置換は `standardTemplateForScene` でマイ見た目を除外する（ADR-0017「AI 入力から除外」・
 * 削除は「標準へ寄せる」と明示する＝#547）。**意図的な差**なのでここは一本化しない。
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
    // 向き不一致の警告は「最終的な向き」に依存するため毎回作り直す（トグルで重複・残留させない）。
    const base = scene.warnings.filter((w) => w.code !== ORIENTATION_MISMATCH_CODE);
    const strippedStale = base.length !== scene.warnings.length;

    if (current?.aspectRatio === target) {
      // 既に目標向き。残っていた向き不一致警告だけ取り除く（無ければ元の参照を維持）。
      return strippedStale ? { ...scene, warnings: base } : scene;
    }

    const alt = templates.find((t) => t.category === scene.sceneType && t.aspectRatio === target);
    if (alt) {
      changed += 1;
      return { ...scene, templateId: alt.templateId, warnings: base };
    }

    // 目標向きの同カテゴリが無い＝原状維持。向き不一致を記録する（11.9・§2-5 で次の行動を示す）。
    unsupported += 1;
    const warning: Warning = {
      code: ORIENTATION_MISMATCH_CODE,
      message: '動画の向きに合う見た目が見つかりませんでした。見た目パターンを手動で選んでください',
      field: 'templateId',
      severity: 'warning',
      autoFixed: false,
    };
    return { ...scene, warnings: [...base, warning] };
  });
  return { scenes: next, changed, unsupported };
}
