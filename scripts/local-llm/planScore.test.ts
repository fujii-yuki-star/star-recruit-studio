// 動画案の点数（ADR-0052 決定7）。
import { describe, expect, it } from 'vitest';
import type { TemplateSummary } from '../../src/domain/ai/aiProvider';
import type { AiScene, AiVideoPlan } from '../../src/domain/ai/types';
import type { Asset } from '../../src/domain/project/types';
import { scorePlan, subtitleOverlap } from './planScore';

const templates: TemplateSummary[] = [
  { templateId: 't1', category: 'message', hasYuko: true, maxNarrationLength: 10, maxSubtitleLength: 5 },
  { templateId: 't2', category: 'message', hasYuko: true, maxNarrationLength: 10, maxSubtitleLength: 5 },
];
const assets = [
  { assetId: 'img', assetType: 'image' },
  { assetId: 'mov', assetType: 'video' },
  { assetId: 'yuko', assetType: 'yuko' },
] as Asset[];

function s(over: Partial<AiScene>): AiScene {
  return { sceneType: 'message', templateId: 't1', durationSec: 10, texts: {}, narrationText: '', ...over } as AiScene;
}
function plan(scenes: AiScene[]): AiVideoPlan {
  return { schemaVersion: '1.0', videoPlan: { title: '題', purpose: 'company_intro', targetDurationSec: 60 }, parts: [{ partTitle: 'p', scenes }] };
}
const ctx = { templates, assets, targetDurationSec: 20, companyName: '株式会社サンプル物流' };

describe('scorePlan', () => {
  it('尺の差・素材の使用率・連続・越え・見た目と素材の不明を数える', () => {
    const score = scorePlan(plan([
      s({ assetRefs: { mainVisual: 'img', x: 'nope', y: null }, narrationText: 'あ'.repeat(11) }),
      s({ assetRefs: { mainVisual: 'img' } }),
      s({ templateId: 'zzz', sceneType: 'chapter', durationSec: 15 }),
    ]), ctx);
    expect(score).toMatchObject({
      scenes: 3, durationDiff: 15, durationDiffRatio: 0.75, assetUseRate: 0.5,
      sameTemplateRuns: 1, sameTypeRuns: 1, overlong: 1, unknownTemplates: 1, unknownAssets: 1,
    });
  });

  it('写真・動画を渡していなければ使用率は null（立ち絵は数えない）', () => {
    expect(scorePlan(plan([s({})]), { ...ctx, assets: [assets[2]] }).assetUseRate).toBeNull();
  });

  it('会社名の完全な形・崩れ・残った印を数える', () => {
    const score = scorePlan(plan([s({ narrationText: '株式会社サンプル物流と株式会社サンプルの{会社名}', texts: { title: '｛採用ページ｝' } })]), ctx);
    expect(score).toMatchObject({ nameMentions: 1, nameTruncated: 1, placeholdersLeft: 2 });
  });

  it('字幕と語りの対応は、両方ある場面の平均', () => {
    const score = scorePlan(plan([
      s({ narrationText: '若手が多い会社です', texts: { subtitle: '若手が多い' } }),
      s({ narrationText: '研修が手厚いです', texts: { subtitle: '人物像' } }),
      s({ narrationText: '字幕なし' }),
    ]), ctx);
    expect(score.subtitleMatch).toBe(0.5);
  });
});

describe('subtitleOverlap', () => {
  it('字幕の2字の並びが語りにある割合（記号は無視）', () => {
    expect(subtitleOverlap('若手が多い。', '若手が多いです')).toBe(1);
    expect(subtitleOverlap('求める人物像', '若手が多いです')).toBe(0);
    expect(subtitleOverlap('あ', 'あ')).toBeNull();
  });
});
