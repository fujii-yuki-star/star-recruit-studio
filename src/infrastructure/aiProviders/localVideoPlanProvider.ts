// このパソコンの中で動画案を作る AiProvider 実装（ADR-0051 決定2）。
// 指示文＝domain（buildVideoPlanMessages・Gemini と共有）／生成＝Rust 経由（同梱の llama.cpp）／
// 応答検証＝domain（parseAndValidateVideoPlan・Gemini と共有）。**正典 schema は弱めない**＝同じ schema で出力の形を縛り、
// 最後は同じ ajv で検証する（縛って出したことを成功の証明にしない）。映像生成はしない（§2-1）。
import aiVideoPlanSchema from '../../../docs/yuko_recruit_docs/schemas/ai-video-plan.schema.json';
import { buildVideoPlanMessages } from '../../domain/ai/buildVideoPlanRequest';
import { parseAndValidateVideoPlan } from '../../domain/ai/validateVideoPlan';
import type { AiProvider, GenerateVideoPlanInput } from '../../domain/ai/aiProvider';
import type { AiVideoPlan } from '../../domain/ai/types';
import { localAiGenerate } from '../aiClient';
import { AI_PLAN_UNREADABLE_MESSAGE } from './messages';

/** 出力の形を縛る schema（正典そのもの）。1回だけ文字列にする。 */
const SCHEMA_TEXT = JSON.stringify(aiVideoPlanSchema);

export class LocalVideoPlanProvider implements AiProvider {
  async generateVideoPlan(input: GenerateVideoPlanInput): Promise<AiVideoPlan> {
    const { system, user } = buildVideoPlanMessages(input);
    let raw: string;
    try {
      raw = await localAiGenerate(system, user, SCHEMA_TEXT);
    } catch (e) {
      // 失敗の文は Rust が「次の行動」つきで返す（LOCAL_AI_*）。原因を追えるよう warn を残す（画面には出さない）。
      console.warn('[ai] このパソコンの中での生成に失敗:', e instanceof Error ? e.message : e);
      throw e;
    }
    const result = parseAndValidateVideoPlan(raw);
    if (result.valid) return result.plan;
    console.warn('[ai] AI_RESPONSE_INVALID（このパソコンの中）: 応答が構成スキーマに適合しませんでした。', {
      errors: result.errors,
      応答先頭: raw.length > 2000 ? `${raw.slice(0, 2000)}…(全${raw.length}字)` : raw,
    });
    throw new Error(AI_PLAN_UNREADABLE_MESSAGE);
  }
}
