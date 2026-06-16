// Gemini を使う AiProvider 実装（ADR-0010 P1）。
// 入力アセンブリ（プロンプト）＝domain（buildVideoPlanMessages）／呼び出し＝Rust 経由（aiGenerate・鍵は JS に出ない）／
// 応答検証＝domain（parseAndValidateVideoPlan）。映像生成はしない（§2-1）。
import { buildVideoPlanMessages } from '../../domain/ai/buildVideoPlanRequest';
import { parseAndValidateVideoPlan } from '../../domain/ai/validateVideoPlan';
import type { AiProvider, GenerateVideoPlanInput } from '../../domain/ai/aiProvider';
import type { AiVideoPlan } from '../../domain/ai/types';
import { GEMINI_PROVIDER, aiGenerate } from '../aiClient';

/**
 * MVP 既定モデル（無料枠想定）。確定はモデル選定＝ADR-0010 未解決#1。
 * 将来は設定画面で選択可にする。Rust 側で文字種検証（英数字・ハイフン・ドット）を通る値であること。
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';

export class GeminiProvider implements AiProvider {
  constructor(private readonly model: string = DEFAULT_GEMINI_MODEL) {}

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
