// Gemini を使う AiProvider 実装（ADR-0010 P1）。
// 入力アセンブリ（プロンプト）＝domain（buildVideoPlanMessages）／呼び出し＝Rust 経由（aiGenerate・鍵は JS に出ない）／
// 応答検証＝domain（parseAndValidateVideoPlan）。映像生成はしない（§2-1）。
import { buildVideoPlanMessages } from '../../domain/ai/buildVideoPlanRequest';
import { parseAndValidateVideoPlan } from '../../domain/ai/validateVideoPlan';
import type { AiProvider, GenerateVideoPlanInput } from '../../domain/ai/aiProvider';
import type { AiVideoPlan } from '../../domain/ai/types';
import { DEFAULT_AI_MODEL } from '../appSettings';
import { GEMINI_PROVIDER, aiGenerate } from '../aiClient';

export class GeminiProvider implements AiProvider {
  // 既定モデルは appSettings.DEFAULT_AI_MODEL（設定で変更可＝ADR-0010 未解決#1）。
  // Rust 側で文字種検証（英数字・ハイフン・ドット）を通る値であること。
  constructor(private readonly model: string = DEFAULT_AI_MODEL) {}

  async generateVideoPlan(input: GenerateVideoPlanInput): Promise<AiVideoPlan> {
    const { system, user } = buildVideoPlanMessages(input);
    // Rust 経由で Gemini を呼ぶ。失敗（鍵未設定・ネットワーク・APIエラー）は文字列で reject される（§2-5 文言）。
    const raw = await aiGenerate(GEMINI_PROVIDER, this.model, system, user);
    const result = parseAndValidateVideoPlan(raw);
    if (!result.valid) {
      // 技術的エラー（ajv 詳細）はログのみ（UI には出さない・§2-3）。
      // throw する文言は §2-5 準拠の「次の行動」つき（store が status:"error" 時に表示）。
      console.warn('[ai] AI_RESPONSE_INVALID: 応答が構成スキーマに適合しませんでした:', result.errors);
      throw new Error('AIからの提案を読み取れませんでした。もう一度お試しください。');
    }
    return result.plan;
  }
}
