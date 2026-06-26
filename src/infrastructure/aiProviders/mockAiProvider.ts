// AIに接続せず固定のサンプル構成案を返す Provider。全フローをオフラインで通すための初期実装（CLAUDE.md §4 / 12 §2,§3）。
import { VIDEO_KIND } from '../../domain/enums';
import type { AiProvider, GenerateVideoPlanInput } from '../../domain/ai/aiProvider';
import type { AiVideoPlan } from '../../domain/ai/types';
import { GENERAL_SAMPLE_VIDEO_PLAN, SAMPLE_VIDEO_PLAN } from './sampleVideoPlan';

export class MockAiProvider implements AiProvider {
  // videoKind に合わせて採用/一般の固定サンプルを返す（ADR-0011）。
  // 呼び出し側が変更しても元データを汚さないよう複製して返す。
  async generateVideoPlan(input: GenerateVideoPlanInput): Promise<AiVideoPlan> {
    const sample = input.videoKind === VIDEO_KIND.general ? GENERAL_SAMPLE_VIDEO_PLAN : SAMPLE_VIDEO_PLAN;
    return JSON.parse(JSON.stringify(sample)) as AiVideoPlan;
  }
}
