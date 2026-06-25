// ナレーター音声のクレジット文言。ADR-0003「常時クレジット」の単一の参照元（CLAUDE.md §2-7/§6）。
// コロンは半角＝VOICEVOX 規約が指定する基本形式「VOICEVOX:キャラクター名」に合わせる（13§4 / ADR-0003）。
// 書き出し動画への焼き込み（renderer）と画面表示（About/Settings）で共有し、文言の散逸を防ぐ。
// #177：単一キャラ固定をやめ、選択した speaker のキャラを動的にクレジットする（creditForSpeaker）。
import { characterForSpeaker, DEFAULT_SPEAKER } from './voiceCatalog';

const CREDIT_PREFIX = 'VOICEVOX:';
const DEFAULT_CHARACTER = characterForSpeaker(DEFAULT_SPEAKER) ?? 'ずんだもん';

/** 既定キャラ（DEFAULT_SPEAKER＝ずんだもん）のクレジット。renderer の既定値・後方互換に使う。 */
export const NARRATOR_CREDIT = `${CREDIT_PREFIX}${DEFAULT_CHARACTER}`;

/** speaker 番号 → クレジット文言「VOICEVOX:<character>」。未指定/不明は既定キャラへ。 */
export function creditForSpeaker(speaker: number | null | undefined): string {
  return `${CREDIT_PREFIX}${characterForSpeaker(speaker) ?? DEFAULT_CHARACTER}`;
}
