// 12§4 入力アセンブリの一部（純粋・テスト対象）：
// - Template[] → AI へ渡すテンプレ要約（11§7.5 aiHint＋層構成）
// - 利用可能なゆうこ表情タグ（yuko 素材の tags を集約）
// プロンプト本文の組み立ては buildVideoPlanRequest.ts、検証は validateVideoPlan.ts が担う。
import { ASSET_TYPE } from '../enums';
import type { Asset } from '../project/types';
import type { Template } from '../template/types';
import type { TemplateSummary } from './aiProvider';

/**
 * Template[] を AI へ渡す要約へ変換する（12§4）。
 * requiredSlots は slot 層の id、hasYuko は character 層の有無、上限類は aiHint から取る。
 */
export function buildTemplateSummaries(templates: Template[]): TemplateSummary[] {
  return templates.map((t) => ({
    templateId: t.templateId,
    category: t.category,
    useCase: t.aiHint?.useCase,
    requiredSlots: t.layers.filter((l) => l.type === 'slot').map((l) => l.id),
    hasYuko: t.layers.some((l) => l.type === 'character'),
    maxNarrationLength: t.aiHint?.maxNarrationLength,
    maxSubtitleLength: t.aiHint?.maxSubtitleLength,
    maxDurationSec: t.aiHint?.maxDurationSec,
  }));
}

/** yuko 素材の tags を重複なく集約する（12§4「利用可能なゆうこ表情タグ一覧」）。 */
export function buildYukoPoseTags(assets: Asset[]): string[] {
  const tags = new Set<string>();
  for (const asset of assets) {
    if (asset.assetType === ASSET_TYPE.yuko) {
      for (const tag of asset.tags ?? []) tags.add(tag);
    }
  }
  return [...tags];
}
