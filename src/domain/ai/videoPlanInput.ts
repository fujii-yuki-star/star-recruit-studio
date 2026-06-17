// 12§4 入力アセンブリの一部（純粋・テスト対象）：
// - Template[] → AI へ渡すテンプレ要約（11§7.5 aiHint＋層構成）
// - 利用可能なゆうこ表情タグ（yuko 素材の tags を集約）
// プロンプト本文の組み立ては buildVideoPlanRequest.ts、検証は validateVideoPlan.ts が担う。
import { ASSET_TYPE } from '../enums';
import type { Asset, CompanyInfo, GeneralBrief } from '../project/types';
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

/**
 * AI へ渡す対象視聴者を解決する（ADR-0011 #12）。
 * general は generalBrief.targetAudience、recruit は companyInfo.recruitTarget を使い、どちらも空なら "" を返す。
 * videoKind では分岐せず「general 専用の入力 → 採用の採用対象」の優先順で拾う（一般/採用で同居しない前提）。
 */
export function resolveTargetAudience(meta: {
  generalBrief?: GeneralBrief;
  companyInfo?: CompanyInfo;
}): string {
  return meta.generalBrief?.targetAudience || meta.companyInfo?.recruitTarget || '';
}
