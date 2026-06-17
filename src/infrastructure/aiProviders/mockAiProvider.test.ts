import { describe, expect, it } from 'vitest';
import { MockAiProvider } from './mockAiProvider';
import { parseAndValidateVideoPlan } from '../../domain/ai/validateVideoPlan';
import { VIDEO_KIND } from '../../domain/enums';
import type { GenerateVideoPlanInput } from '../../domain/ai/aiProvider';

function input(over: Partial<GenerateVideoPlanInput> = {}): GenerateVideoPlanInput {
  return { purpose: 'new_graduate', targetDurationSec: 60, templates: [], assets: [], yukoPoseTags: [], ...over };
}

describe('MockAiProvider', () => {
  const provider = new MockAiProvider();

  it('videoKind=general は一般サンプル（purpose=report・発表調パート）を返す', async () => {
    const plan = await provider.generateVideoPlan(input({ videoKind: VIDEO_KIND.general, purpose: 'report' }));
    expect(plan.videoPlan.purpose).toBe('report');
    expect(plan.parts.map((p) => p.partTitle)).toContain('今期の報告');
  });

  it('videoKind 省略・recruit は採用サンプル（purpose=new_graduate）を返す', async () => {
    expect((await provider.generateVideoPlan(input())).videoPlan.purpose).toBe('new_graduate');
    expect(
      (await provider.generateVideoPlan(input({ videoKind: VIDEO_KIND.recruit }))).videoPlan.purpose,
    ).toBe('new_graduate');
  });

  it('採用・一般どちらのサンプルも ai-video-plan スキーマに適合する', async () => {
    const general = await provider.generateVideoPlan(input({ videoKind: VIDEO_KIND.general, purpose: 'report' }));
    const recruit = await provider.generateVideoPlan(input());
    expect(parseAndValidateVideoPlan(JSON.stringify(general)).valid).toBe(true);
    expect(parseAndValidateVideoPlan(JSON.stringify(recruit)).valid).toBe(true);
  });

  it('一般サンプルは全シーンの durationSec 合計が targetDurationSec に整合する', async () => {
    const plan = await provider.generateVideoPlan(input({ videoKind: VIDEO_KIND.general }));
    const sceneSum = plan.parts.flatMap((p) => p.scenes).reduce((acc, s) => acc + s.durationSec, 0);
    expect(sceneSum).toBe(plan.videoPlan.targetDurationSec);
  });

  it('返り値は複製（変更しても次回呼び出しに影響しない）', async () => {
    const a = await provider.generateVideoPlan(input({ videoKind: VIDEO_KIND.general }));
    a.videoPlan.title = 'CHANGED';
    const b = await provider.generateVideoPlan(input({ videoKind: VIDEO_KIND.general }));
    expect(b.videoPlan.title).not.toBe('CHANGED');
  });
});
