// 見た目パターン（テンプレ）がどの場面で使われているかの検出（純粋ロジック・§7・#406）。
// 場面は scene.templateId でテンプレを参照する。素材の assetUsage と対で置き、逆引き導線（使用場面バッジ）で共有する。
import type { Scene } from './types';
import type { Template } from '../template/types';
import { switchSceneTemplate } from './sceneOps';
import { losesContentBySwitch, standardTemplateForScene } from '../template/templateSelection';

/** この見た目（テンプレ）を使っている場面の配列（順序は scenes のまま）。逆引き（#406）に使う。 */
export function scenesUsingTemplate(scenes: Scene[], templateId: string): Scene[] {
  return scenes.filter((s) => s.templateId === templateId);
}

/**
 * 削除された（グローバル）ユーザーテンプレを参照している場面を、標準（同カテゴリ・同じ向き）へ置換する（#458・06_UI_SPEC §9）。
 * ユーザーテンプレはグローバル削除できるため、参照していた場面が孤立参照（存在しない templateId）になるのを、削除と同時に
 * 開いているプロジェクト側で標準へ置換して防ぐ。置換方針は AI 変換の TEMPLATE_NOT_FOUND 補正（transformPlan）と同じ
 * ＝同カテゴリ・同じ向きの**標準**の見た目（`standardTemplateForScene`＝マイ見た目は当て先にしない）。代替が無い場面は原状維持（読込/描画時の §9 補正が honest 表示＝手動選択へ促す）。
 * 変化が無ければ同一参照を返す（未保存/再描画を無駄に起こさない・sceneOps と同流儀）。
 */
export function substituteDeletedTemplateInScenes(
  scenes: Scene[],
  deletedTemplateId: string,
  availableTemplates: Template[],
  orientation: Template['aspectRatio'],
): Scene[] {
  // 削除対象自身は当て先にしない（マイ見た目除外に暗黙で頼らない＝将来ほかの種類を削除できるようにしても壊れない）。
  const candidates = availableTemplates.filter((t) => t.templateId !== deletedTemplateId);
  let changed = false;
  const next = scenes.map((sc) => {
    if (sc.templateId !== deletedTemplateId) return sc;
    // 当て先は「標準の見た目」＝マイ見た目を除く（`standardTemplateForScene` に一本化・#547）。
    // 除外しないと**別のマイ見た目**へ化けることがあり、削除確認で示す「標準の見た目に変わります」と食い違う。
    const alt = standardTemplateForScene(candidates, sc.sceneType, orientation);
    if (!alt) return sc; // 代替が無ければ原状維持（§9 補正が読込/描画時に対応）。
    changed = true;
    // templateId 差し替えだけでなく、テンプレ依存の assetRefs/slotFits/warnings も正準経路で清算する
    // （手動のテンプレ切替と同じ＝11 §5・#236。別の孤立参照＝存在しないスロットへの残骸を残さない・#458 レビュー）。
    // category を渡す（ADR-0030）。渡さないと FREE 場面でも通常扱いになり、休眠中の通常配置が清算される
    // ＝「通常へ戻せば復元」が失われる。一括適用（store）と同じ規則にする（ADR-0026②）。
    return switchSceneTemplate(sc, alt.templateId, alt.layers, alt.category);
  });
  return changed ? next : scenes;
}

/** 見た目を削除したときに、その場面がどうなるか（#547・削除確認で先に示す）。 */
export interface TemplateDeleteImpact {
  /** 標準の見た目へ変わる場面。 */
  changing: Scene[];
  /** 合う標準が無く、見た目が未解決のまま残る場面（書き出しは止まるので選び直しが要る）。 */
  unresolved: Scene[];
  /** 標準へ変わるが、写真・文字などが動画に出なくなる場面（`changing` の部分集合）。 */
  losingContent: Scene[];
}

/**
 * この見た目を削除したときの、開いているプロジェクトへの影響（#547）。
 *
 * 削除確認で「N個の場面は標準の見た目に変わります」とだけ言うと、①合う標準が無くて**変わらない**場面や
 * ②変わったが写真・文字が**出なくなる**場面を取り違える。削除は取り消せないので、置換そのもの
 * （`substituteDeletedTemplateInScenes`）と**同じ当て先の選び方**でここを算出し、表示と実挙動をずらさない。
 */
export function templateDeleteImpact(
  scenes: Scene[],
  deletedTemplateId: string,
  availableTemplates: Template[],
  orientation: Template['aspectRatio'],
): TemplateDeleteImpact {
  const deleted = availableTemplates.find((t) => t.templateId === deletedTemplateId);
  const candidates = availableTemplates.filter((t) => t.templateId !== deletedTemplateId);
  const impact: TemplateDeleteImpact = { changing: [], unresolved: [], losingContent: [] };
  for (const sc of scenes) {
    if (sc.templateId !== deletedTemplateId) continue;
    const alt = standardTemplateForScene(candidates, sc.sceneType, orientation);
    if (!alt) {
      impact.unresolved.push(sc);
      continue;
    }
    impact.changing.push(sc);
    // 削除するテンプレが分かる場面なので prev として渡す＝**いま実際に出ているもの**だけを数える。
    if (losesContentBySwitch(sc, alt, deleted)) impact.losingContent.push(sc);
  }
  return impact;
}

/** 削除影響を件数へ畳む（削除確認の文言に渡す形。2画面で同じ数え方にする）。 */
export function deleteImpactCounts(impact: TemplateDeleteImpact): { changing: number; losingContent: number; unresolved: number } {
  return { changing: impact.changing.length, losingContent: impact.losingContent.length, unresolved: impact.unresolved.length };
}
