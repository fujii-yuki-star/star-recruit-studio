// このパソコンの中で動画案を作る AiProvider 実装（ADR-0051 決定2）。
// 指示文＝domain（buildVideoPlanMessages・Gemini と共有）／生成＝Rust 経由（同梱の llama.cpp）／
// 応答検証＝domain（parseAndValidateVideoPlan・Gemini と共有）。**正典 schema は弱めない**＝同じ schema で出力の形を縛り、
// 最後は同じ ajv で検証する（縛って出したことを成功の証明にしない）。映像生成はしない（§2-1）。
// 検証に通った案は、ソフトが機械的に決められること（固有名詞・見た目の選び直し・言い直し・尺）で整え、
// **もう一度同じ検証を通してから**返す（ADR-0052 段階1・12 §8.7）。
import aiVideoPlanSchema from '../../../docs/yuko_recruit_docs/schemas/ai-video-plan.schema.json';
import { LOCAL_VIDEO_PLAN_OPTIONS, buildVideoPlanMessages } from '../../domain/ai/buildVideoPlanRequest';
import { parseAndValidateVideoPlan, validateAiVideoPlan } from '../../domain/ai/validateVideoPlan';
import { refineVideoPlan } from '../../domain/ai/refineVideoPlan';
import type { ShortenText } from '../../domain/ai/refineVideoPlan';
import { buildShortenMessages, parseShortenResponse } from '../../domain/ai/shortenTextRequest';
import { VIDEO_KIND } from '../../domain/enums';
import { templatesForAssets } from '../../domain/ai/videoPlanInput';
import type { AiProvider, GenerateVideoPlanInput } from '../../domain/ai/aiProvider';
import type { AiVideoPlan } from '../../domain/ai/types';
import { currentAiCancelEpoch, localAiGenerate } from '../aiClient';
import { AI_PLAN_HOLLOW_MESSAGE, AI_PLAN_UNREADABLE_MESSAGE } from './messages';
import { generationSchemaFor, isHollowPlan, planRunawayLimits } from '../../domain/ai/planSanity';

/** 中身が足りない案を作り直す回数（最初の1回を含む）。 */
const HOLLOW_ATTEMPTS = 2;

/** いちばん新しい動画案づくりの番号（この画面の中だけ）。古い回の言い直しが新しい回を追い越さないように見る。 */
let latestRun = 0;

/**
 * 1文を同梱の AI で短く言い直す。言い直せなかった文は元のまま残り、変換の長さの助言が出る（黙って切らない）。
 * ⚠️ **次のときは頼まない**（Rust の止める合図は走っている1回にしか効かず、呼ぶたびに新しい生成として数えられる）：
 * - 「やめる」が押された＝押した後に次の言い直しが走り出さないように
 * - 次の動画案づくりが始まった＝古い回の言い直しが新しい回を「やめた」扱いにして壊さないように
 * - 呼び出しが1回でも失敗した（止められた・時間切れ）＝同じ失敗を繰り返さない
 */
function createShortener(isStale: () => boolean): ShortenText {
  let stopped = false;
  return async (text, maxLength) => {
    if (stopped || isStale()) return null;
    const m = buildShortenMessages(text, maxLength);
    try {
      return parseShortenResponse(await localAiGenerate(m.system, m.user, JSON.stringify(m.schema)));
    } catch (e) {
      stopped = true;
      console.warn('[ai] 言い直しに失敗（残りの言い直しはしない）:', e instanceof Error ? e.message : e);
      return null;
    }
  };
}

export class LocalVideoPlanProvider implements AiProvider {
  async generateVideoPlan(original: GenerateVideoPlanInput): Promise<AiVideoPlan> {
    // 写真・動画が無ければ、差し込み口のある見た目を見せない（12 §8.9・ADR-0052 追補5）。整える段も同じ一覧を使う。
    const input: GenerateVideoPlanInput = { ...original, templates: templatesForAssets(original.templates, original.assets) };
    const run = ++latestRun;
    const cancelEpoch = currentAiCancelEpoch();
    const isStale = () => run !== latestRun || currentAiCancelEpoch() !== cancelEpoch;
    const { system, user } = buildVideoPlanMessages(input, LOCAL_VIDEO_PLAN_OPTIONS);
    // 止まらずに書き続けたら Rust が途中で止めて1度だけ作り直す（#1403）＝上限は尺から決める。
    const limits = planRunawayLimits(input.targetDurationSec);
    // ⚠️ **書かせるときだけ**パートと場面の数に上限を付ける（#1415）＝検証は元の schema（`parseAndValidateVideoPlan`）。
    const schemaText = JSON.stringify(generationSchemaFor(aiVideoPlanSchema, input.targetDurationSec));
    // ⚠️ **中身が足りない案は1度だけ作り直す**（#1403）＝同じ入力でも作り直すと多くは直る。
    for (let attempt = 0; attempt < HOLLOW_ATTEMPTS; attempt += 1) {
      let raw: string;
      try {
        raw = await localAiGenerate(system, user, schemaText, limits);
      } catch (e) {
        // 失敗の文は Rust が「次の行動」つきで返す（LOCAL_AI_*）。原因を追えるよう warn を残す（画面には出さない）。
        console.warn('[ai] このパソコンの中での生成に失敗:', e instanceof Error ? e.message : e);
        throw e;
      }
      const result = parseAndValidateVideoPlan(raw);
      if (!result.valid) {
        console.warn('[ai] AI_RESPONSE_INVALID（このパソコンの中）: 応答が構成スキーマに適合しませんでした。', {
          errors: result.errors,
          応答先頭: raw.length > 2000 ? `${raw.slice(0, 2000)}…(全${raw.length}字)` : raw,
        });
        throw new Error(AI_PLAN_UNREADABLE_MESSAGE);
      }
      if (!isHollowPlan(result.plan)) return this.refine(result.plan, input, isStale);
      console.warn('[ai] 話す内容がほとんど無い動画案でした（このパソコンの中）。', { 回: attempt + 1 });
      if (isStale()) break; // やめた・後から別の生成が始まった＝作り直さない
    }
    throw new Error(AI_PLAN_HOLLOW_MESSAGE);
  }

  private async refine(plan: AiVideoPlan, input: GenerateVideoPlanInput, isStale: () => boolean): Promise<AiVideoPlan> {
    const isGeneral = input.videoKind === VIDEO_KIND.general;
    const { plan: refined, report } = await refineVideoPlan(plan, {
      templates: input.templates,
      targetDurationSec: input.targetDurationSec,
      voiceSpeed: input.voiceSpeed,
      properNouns: isGeneral ? {} : {
        companyName: input.companyInfo?.companyName,
        recruitUrl: input.companyInfo?.recruitUrl,
      },
    }, createShortener(isStale));
    console.info('[ai] 動画案を整えました（このパソコンの中）:', report);
    // 整えた後も正典の検証を通す（§2-2）。形は変えない作りだが、通ったことを確かめてから返す。
    const again = validateAiVideoPlan(refined);
    if (again.valid) return again.plan;
    // 通らなければ**整える処理の不具合**＝利用者に「読み取れなかった」と言っても次の行動にならない（§2-5）。
    // 検証済みの整える前の案を返す（整えなかった分は変換の警告＝長さ・見た目の助言がそのまま出る）。
    console.warn('[ai] 整えた動画案が構成スキーマに適合しませんでした（不具合）。整える前の案を使います。', { errors: again.errors });
    return plan;
  }
}
