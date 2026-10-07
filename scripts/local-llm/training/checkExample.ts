// 学習材料の理想の案を機械で確かめる（ADR-0052 段階4・#1294）。形・実在する ID・種類と見た目・表情・印・会社名の書き写し・字数・尺。
import Ajv2020 from 'ajv/dist/2020';
import aiVideoPlanSchema from '../../../docs/yuko_recruit_docs/schemas/ai-video-plan.schema.json';
import { findOverlongTexts } from '../../../src/domain/ai/refineVideoPlan';
import { buildTemplateSummaries, templatesForAssets } from '../../../src/domain/ai/videoPlanInput';
import { sampleTemplates } from '../../../src/infrastructure/sampleData';
import type { TrainingExample } from './pilotExamples';

const validate = new Ajv2020({ allErrors: true, strict: false }).compile(aiVideoPlanSchema);

/** 理想の案を機械で確かめる。問題の一覧（空なら合格）。 */
export function checkExample(ex: TrainingExample): string[] {
  const templates = templatesForAssets(buildTemplateSummaries(sampleTemplates, '16:9'), ex.input.assets);
  const problems: string[] = [];
  if (!validate(ex.plan)) problems.push(`形が正典に合わない: ${JSON.stringify(validate.errors?.slice(0, 2))}`);
  const ids = new Set(templates.map((t) => t.templateId));
  const assetIds = new Set(ex.input.assets.map((a) => a.assetId));
  const scenes = ex.plan.parts.flatMap((p) => p.scenes);
  for (const s of scenes) {
    if (!ids.has(s.templateId)) problems.push(`見せられない見た目: ${s.templateId}`);
    const t = templates.find((x) => x.templateId === s.templateId);
    if (t && t.category !== s.sceneType) problems.push(`種類と見た目が合わない: ${s.sceneType}/${s.templateId}`);
    for (const v of Object.values(s.assetRefs ?? {})) if (typeof v === 'string' && !assetIds.has(v)) problems.push(`無い素材: ${v}`);
    if (s.yukoPoseTag && !ex.input.yukoPoseTags.includes(s.yukoPoseTag)) problems.push(`無い表情: ${s.yukoPoseTag}`);
    // 文字の欄だけを見る（JSON の括弧を印と取り違えない）。
    const text = [s.sceneTitle ?? '', ...Object.values(s.texts).map((v) => v ?? ''), s.narrationText ?? '', s.notes ?? ''].join(' ');
    for (const m of text.match(/[{｛][^}｝]*[}｝]/g) ?? []) if (m !== '{会社名}' && m !== '{採用ページ}') problems.push(`知らない印: ${m}`);
    if (ex.input.videoKind === 'recruit' && ex.input.companyInfo?.companyName && text.includes(ex.input.companyInfo.companyName)) problems.push('会社名を書き写している（{会社名} にする）');
  }
  for (const o of findOverlongTexts(ex.plan, templates)) problems.push(`字数の上限越え: ${o.text.slice(0, 20)}…（${o.text.length}/${o.maxLength}）`);
  const total = scenes.reduce((n, s) => n + s.durationSec, 0);
  if (Math.abs(total - ex.input.targetDurationSec) > ex.input.targetDurationSec * 0.15) problems.push(`尺が目標から離れている: ${total}/${ex.input.targetDurationSec}`);
  return problems;
}

