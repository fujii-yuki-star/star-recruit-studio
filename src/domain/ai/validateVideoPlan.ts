// AI応答（ai-video-plan）の構造検証（V1/V2＝型・必須・enum・範囲）。
// 正典スキーマ ai-video-plan.schema.json に ajv(draft 2020-12) で適合検証し、ここを通った plan のみ
// transformVideoPlan(V3–V11) へ渡す（§2-2「検証してから内部データへ」/ 12§9）。
// 検証エラー（errors）は技術的内容なので**ログ・デバッグ用**。利用者には UI 層が「次の行動」を示す文言
// （15§6・概念コード AI_RESPONSE_INVALID / §2-5）へ変換して表示する＝domain は UI 文言を持たない（§6）。
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import aiVideoPlanSchema from '../../../docs/yuko_recruit_docs/schemas/ai-video-plan.schema.json';
import type { AiVideoPlan } from './types';

// validate-schemas.mjs（CIゲート）と同設定（draft 2020-12・strict:false・allErrors）にして挙動を揃える。
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(aiVideoPlanSchema as object);

export interface VideoPlanValidationOk {
  valid: true;
  plan: AiVideoPlan;
}
export interface VideoPlanValidationFailure {
  valid: false;
  /** ajv 等の技術的エラー（ログ・デバッグ用。UI には出さない＝§2-3/§2-5）。 */
  errors: string[];
}
export type VideoPlanValidationResult = VideoPlanValidationOk | VideoPlanValidationFailure;

/** ajv の検証エラーを読みやすい1行へ整形（ログ用）。 */
function formatAjvErrors(): string[] {
  return (validate.errors ?? []).map((e) => `${e.instancePath || '(root)'} ${e.message ?? ''}`.trim());
}

/**
 * パース済みデータ（unknown）を ai-video-plan スキーマで検証（V1/V2）。
 * 適合すれば AiVideoPlan へ narrowing して返す。不適合は valid:false＋技術エラー。
 */
export function validateAiVideoPlan(data: unknown): VideoPlanValidationResult {
  if (validate(data)) {
    return { valid: true, plan: data as AiVideoPlan };
  }
  return { valid: false, errors: formatAjvErrors() };
}

/**
 * ```json … ``` などのコードフェンスと前後空白を除去する。
 * §5 では「コードフェンスを付けない」よう指示し JSON モードでも素の JSON が返る想定だが、保険的に剥がす。
 */
export function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

/**
 * AI応答テキスト → パース（フェンス除去＋JSON.parse）→ スキーマ検証（V1/V2）。
 * 空文字・JSON でない・スキーマ不適合はすべて valid:false（呼び出し側で AI_RESPONSE_INVALID 扱い＝再生成 or 手動）。
 * 通った plan は transformVideoPlan(V3–V11) へ渡す。
 */
export function parseAndValidateVideoPlan(raw: string): VideoPlanValidationResult {
  const text = stripCodeFence(raw ?? '');
  if (text.length === 0) {
    return { valid: false, errors: ['応答が空です'] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { valid: false, errors: [`JSON として解釈できません: ${(e as Error).message}`] };
  }
  return validateAiVideoPlan(parsed);
}
