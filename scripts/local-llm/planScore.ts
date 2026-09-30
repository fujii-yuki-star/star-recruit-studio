// 動画案の点数（ADR-0052 決定7＝良くなったかを数で見る）。`eval-real-prompt.ts` が整える前と後の両方に掛ける。
// 純粋関数。日本語の自然さは点数にしない（人の目で見る欄を別に持つ＝`local-llm-build.md` の記録）。
import type { TemplateSummary } from '../../src/domain/ai/aiProvider';
import { findOverlongTexts, repairTruncatedName } from '../../src/domain/ai/refineVideoPlan';
import type { AiScene, AiVideoPlan } from '../../src/domain/ai/types';
import { ASSET_TYPE } from '../../src/domain/enums';
import type { Asset } from '../../src/domain/project/types';

export interface PlanScore {
  scenes: number;
  /** 合計の尺と目標の差（秒・越えたら正）。 */
  durationDiff: number;
  /** 目標に対する差の割合（絶対値）。 */
  durationDiffRatio: number;
  /** 写真・動画のうち、どこかの場面に当てた割合（渡した写真・動画が無ければ null）。 */
  assetUseRate: number | null;
  /** 隣り合う場面が同じ見た目の数。 */
  sameTemplateRuns: number;
  /** 隣り合う場面が同じ種類の数（種類は AI の判断＝段階1では直さない。記録だけ）。 */
  sameTypeRuns: number;
  /** 見た目の上限を越えた文の数。 */
  overlong: number;
  /** 会社名が完全な形で出た数／崩れた形の数／置き換わらずに残った印の数。 */
  nameMentions: number;
  nameTruncated: number;
  placeholdersLeft: number;
  /** 字幕の2字の並びのうち、同じ場面の語りにもある割合の平均（字幕と語りの対応。字幕と語りが両方ある場面が無ければ null）。 */
  subtitleMatch: number | null;
  /** 一覧に無い見た目・素材の数。 */
  unknownTemplates: number;
  unknownAssets: number;
}

/** 場面の文字（画面・語り・掛け合い）をすべて並べる。 */
function sceneStrings(s: AiScene): string[] {
  return [
    s.sceneTitle ?? '',
    ...Object.values(s.texts).map((v) => v ?? ''),
    s.narrationText ?? '',
    ...(s.narrationLines ?? []).flatMap((l) => [l.text, l.subtitle ?? '']),
  ];
}

function bigrams(text: string): string[] {
  const t = text.replace(/[\s、。！？!?「」『』（）()・…ー]/g, '');
  const out: string[] = [];
  for (let i = 0; i + 1 < t.length; i++) out.push(t.slice(i, i + 2));
  return out;
}

/** 字幕の2字の並びのうち、語りにもあるものの割合。字幕が1字以下なら null。 */
export function subtitleOverlap(subtitle: string, narration: string): number | null {
  const sub = bigrams(subtitle);
  if (sub.length === 0) return null;
  const nar = new Set(bigrams(narration));
  return sub.filter((b) => nar.has(b)).length / sub.length;
}

export function scorePlan(
  plan: AiVideoPlan,
  ctx: { templates: TemplateSummary[]; assets: Asset[]; targetDurationSec: number; companyName?: string },
): PlanScore {
  const scenes = plan.parts.flatMap((p) => p.scenes);
  const templateIds = new Set(ctx.templates.map((t) => t.templateId));
  const assetIds = new Set(ctx.assets.map((a) => a.assetId));
  const visual = new Set(ctx.assets
    .filter((a) => a.assetType === ASSET_TYPE.image || a.assetType === ASSET_TYPE.video)
    .map((a) => a.assetId));
  const used = new Set<string>();
  let unknownAssets = 0;
  for (const s of scenes) {
    for (const v of Object.values(s.assetRefs ?? {})) {
      if (typeof v !== 'string') continue;
      if (!assetIds.has(v)) unknownAssets++;
      if (visual.has(v)) used.add(v);
    }
  }
  const total = scenes.reduce((n, s) => n + s.durationSec, 0);
  let sameTemplateRuns = 0;
  let sameTypeRuns = 0;
  for (let i = 1; i < scenes.length; i++) {
    if (scenes[i].templateId === scenes[i - 1].templateId) sameTemplateRuns++;
    if (scenes[i].sceneType === scenes[i - 1].sceneType) sameTypeRuns++;
  }
  const strings = [plan.videoPlan.title, ...plan.parts.map((p) => p.partTitle), ...scenes.flatMap(sceneStrings)];
  const name = ctx.companyName?.trim() ?? '';
  let nameMentions = 0;
  let nameTruncated = 0;
  let placeholdersLeft = 0;
  for (const s of strings) {
    if (name) {
      nameMentions += s.split(name).length - 1;
      nameTruncated += repairTruncatedName(s, name).fixes;
    }
    placeholdersLeft += (s.match(/[{｛][^}｝]*[}｝]/g) ?? []).length;
  }
  const overlaps = scenes
    .map((s) => (s.texts.subtitle && s.narrationText ? subtitleOverlap(s.texts.subtitle, s.narrationText) : null))
    .filter((v): v is number => v !== null);
  return {
    scenes: scenes.length,
    durationDiff: Number((total - ctx.targetDurationSec).toFixed(1)),
    durationDiffRatio: Number((Math.abs(total - ctx.targetDurationSec) / ctx.targetDurationSec).toFixed(3)),
    assetUseRate: visual.size > 0 ? Number((used.size / visual.size).toFixed(3)) : null,
    sameTemplateRuns,
    sameTypeRuns,
    overlong: findOverlongTexts(plan, ctx.templates).length,
    nameMentions,
    nameTruncated,
    placeholdersLeft,
    subtitleMatch: overlaps.length > 0 ? Number((overlaps.reduce((a, b) => a + b, 0) / overlaps.length).toFixed(3)) : null,
    unknownTemplates: scenes.filter((s) => !templateIds.has(s.templateId)).length,
    unknownAssets,
  };
}
