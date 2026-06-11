// AIに接続せず固定のサンプル構成案を返す Provider。全フローをオフラインで通すための初期実装（CLAUDE.md §4 / 12 §2,§3）。
import type { AiProvider, GenerateVideoPlanInput } from '../../domain/ai/aiProvider';
import type { AiVideoPlan } from '../../domain/ai/types';
import { SAMPLE_VIDEO_PLAN } from './sampleVideoPlan';

export class MockAiProvider implements AiProvider {
  // 入力内容に関わらず固定サンプルを返す。呼び出し側が変更しても元データを汚さないよう複製して返す。
  async generateVideoPlan(_input: GenerateVideoPlanInput): Promise<AiVideoPlan> {
    return JSON.parse(JSON.stringify(SAMPLE_VIDEO_PLAN)) as AiVideoPlan;
  }
}
