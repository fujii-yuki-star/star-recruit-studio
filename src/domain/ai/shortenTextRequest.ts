// 上限を越えた1文を同梱の AI に短く言い直させる指示文（ADR-0052 段階1・12 §8.7／§10「もっと短く」と同じ趣旨）。
// 純粋関数。呼び出し（llama-server）は infrastructure、長さの確かめ直しは `refineVideoPlan.shortenOne`。
import { COMPANY_NAME_PLACEHOLDER } from './refineVideoPlan';

export interface ShortenMessages {
  system: string;
  user: string;
  /** 出力の形を縛る schema（`{ "text": "…" }`・字数の上限つき）。 */
  schema: Record<string, unknown>;
}

export const SHORTEN_SYSTEM_PROMPT = `あなたは動画のセリフと字幕を整える編集者です。渡された日本語の文を、意味と要点を保ったまま、指定の字数以内に短く言い直します。

【厳守事項】
- 指定の字数を超えない。文の途中で切らず、自然な一文（または二文）にする。
- ${COMPANY_NAME_PLACEHOLDER} はそのまま残す（言い換えない・消さない）。
- 事実を足さない。誇張しない。
- 出力は {"text": "言い直した文"} の JSON だけ。説明を付けない。`;

/** 1文を `maxLength` 字以内に短くする指示文と出力の形。 */
export function buildShortenMessages(text: string, maxLength: number): ShortenMessages {
  return {
    system: SHORTEN_SYSTEM_PROMPT,
    user: [`# 字数の上限`, `${maxLength}字以内`, '', '# 元の文', text].join('\n'),
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: { text: { type: 'string', minLength: 1, maxLength } },
    },
  };
}

/** AI の応答（JSON 文字列）から言い直した文を取り出す。形が違えば null。 */
export function parseShortenResponse(raw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(raw.trim());
    if (typeof parsed === 'object' && parsed !== null && 'text' in parsed) {
      const t = (parsed as { text: unknown }).text;
      return typeof t === 'string' ? t : null;
    }
  } catch {
    // JSON でない＝言い直せなかった（呼び出し側は元の文を残す）。
  }
  return null;
}
