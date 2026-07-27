// Gemini を使う AiProvider 実装（ADR-0010 P1）。
// 入力アセンブリ（プロンプト）＝domain（buildVideoPlanMessages）／呼び出し＝Rust 経由（aiGenerate・鍵は JS に出ない）／
// 応答検証＝domain（parseAndValidateVideoPlan）。映像生成はしない（§2-1）。
import { buildVideoPlanMessages } from '../../domain/ai/buildVideoPlanRequest';
import { AI_ASSET_SEND_MAX } from '../../domain/constants';
import { parseAndValidateVideoPlan } from '../../domain/ai/validateVideoPlan';
import type { AiProvider, GenerateVideoPlanInput } from '../../domain/ai/aiProvider';
import type { AiVideoPlan } from '../../domain/ai/types';
import { DEFAULT_AI_MODEL } from '../appSettings';
import { GEMINI_PROVIDER, aiGenerate } from '../aiClient';

/** ログ用に生応答を安全な長さへ切り詰める（含まれるのは AI の構成案＝鍵や送信元データではない。巨大化を防ぐ）。 */
function headForLog(raw: string): string {
  const LIMIT = 2000;
  return raw.length > LIMIT ? `${raw.slice(0, LIMIT)}…(全${raw.length}字)` : raw;
}

export class GeminiProvider implements AiProvider {
  // 既定モデルは appSettings.DEFAULT_AI_MODEL（設定で変更可＝ADR-0010 未解決#1）。
  // Rust 側で文字種検証（英数字・ハイフン・ドット）を通る値であること。
  constructor(private readonly model: string = DEFAULT_AI_MODEL) {}

  // 1回の生成につき Gemini 呼び出しは1回だけ＝**自動リトライしない**。理由：無料枠を勝手な再送で消費させない／
  // 再試行は利用者が「もう一度試す」で明示的に行える（GeneratingScreen）。間欠失敗の主因（任意項目の null/[]）は
  // 受信前サニタイズ（sanitizeVideoPlan）が API 追加コストなしで吸収するため、1回でも通りやすい。
  async generateVideoPlan(input: GenerateVideoPlanInput): Promise<AiVideoPlan> {
    const { system, user, omittedAssetCount } = buildVideoPlanMessages(input);
    // 素材が上限（AI_ASSET_SEND_MAX）を超えたら**送らなかった件数を記録**する（12§6「超過分は送らない旨を log する
    // ＝無言の打ち切りをしない」）。利用者向けの明示は送信前確認（ConfirmScreen）が同じ選定関数で出す＝ここは診断用。
    // 件数は**いま組んだ user 本文と同じ選定結果**（buildVideoPlanMessages が1回だけ計算）なので、
    // 「ログの件数」と「実際に送った内容」がズレない。domain は副作用を持たない（§4）ので log はこの送信実行側に置く。
    if (omittedAssetCount > 0) {
      console.info(`[ai] 素材が多いため上位 ${AI_ASSET_SEND_MAX} 件のみ送信（送らなかった素材: ${omittedAssetCount} 件）`);
    }
    let raw: string;
    try {
      raw = await aiGenerate(GEMINI_PROVIDER, this.model, system, user);
    } catch (e) {
      // APIエラー（鍵未設定・ネットワーク・レート制限等）。UI に文言だけ出てログが無いと原因が分からないので warn を残す（§2-3）。
      console.warn('[ai] 生成API呼び出しに失敗:', e instanceof Error ? e.message : e);
      throw e;
    }
    const result = parseAndValidateVideoPlan(raw);
    if (result.valid) return result.plan;
    // 検証不適合。自動リトライはしない（無料枠節約）。診断用に生応答＋ajvエラーをログ（UI には出さない・§2-3）。
    console.warn('[ai] AI_RESPONSE_INVALID: 応答が構成スキーマに適合しませんでした。', {
      errors: result.errors,
      応答先頭: headForLog(raw),
    });
    // throw 文言は §2-5 準拠の「次の行動」つき（store が status:"error" 時に表示し、利用者が手動で再試行）。
    throw new Error('AIからの提案を読み取れませんでした。もう一度お試しください。');
  }
}
