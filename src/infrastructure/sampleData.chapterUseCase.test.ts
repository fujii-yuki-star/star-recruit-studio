// 区切りの見た目の使いどころを AI へ渡す（#1424）。書かないと、指示文の「構成（章立て）」に引っ張られて
// 全部の場面を区切りの見た目（最長 6 秒・文字だけ）で組み、尺に届かなかった。
import { describe, expect, it } from 'vitest';
import { buildVideoPlanMessages } from '../domain/ai/buildVideoPlanRequest';
import { buildTemplateSummaries } from '../domain/ai/videoPlanInput';
import type { GenerateVideoPlanInput } from '../domain/ai/aiProvider';
import { sampleTemplates } from './sampleData';

describe('区切りの見た目の使いどころ（#1424）', () => {
  const chapters = sampleTemplates.filter((t) => t.category === 'chapter');

  it('同梱の区切りの見た目は、どれも使いどころを持つ（横も縦も）', () => {
    expect(chapters.length).toBeGreaterThanOrEqual(4);
    for (const t of chapters) expect(t.aiHint?.useCase, t.templateId).toContain('各章の頭に1つまで');
  });

  it('AI への依頼文に、その使いどころが載る', () => {
    const templates = buildTemplateSummaries(sampleTemplates, '16:9');
    const input = { videoKind: 'general', generalBrief: { title: 't', agenda: ['a'] }, purpose: 'general_announcement', targetDurationSec: 30, templates, assets: [], yukoPoseTags: [] } as unknown as GenerateVideoPlanInput;
    const { user } = buildVideoPlanMessages(input);
    expect(user).toContain('templateId=chapter_v1');
    expect(user).toContain('useCase=章の始まりに題名だけを短く見せる区切り');
  });
});
