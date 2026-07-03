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

/**
 * 掛け合いの1行のクレジット文言（#243）。行に**有効な**話者があればそのキャラ、無ければ（未指定/継承/不明）
 * 場面/動画の話者のクレジット（fallbackCredit）を使う＝実際に合成される声（resolveLineVoice）とクレジットを一致させる。
 */
export function creditForLine(line: { speaker?: number | null }, fallbackCredit: string): string {
  return line.speaker != null && characterForSpeaker(line.speaker) != null
    ? creditForSpeaker(line.speaker)
    : fallbackCredit;
}

/**
 * プロジェクトで実際に使う VOICEVOX クレジットを重複なく集める（#251 About の全列挙・ADR-0025 クレジット集約で共有）。
 * 掛け合いの場面は行ごとの話者、単一 narration の場面は既定話者（defaultSpeaker）を採用する（実際に合成される声と一致）。
 * 場面が無い/空でも既定話者のクレジットは1件返す（About 後方互換・プロジェクト未読込時＝選択話者のみ）。
 * @param defaultSpeaker アプリ設定の選択話者（getVoicevoxSpeaker）。
 */
export function usedVoiceCredits(
  scenes: ReadonlyArray<{ lines?: { speaker?: number | null }[] | null }>,
  defaultSpeaker: number | null | undefined,
): string[] {
  const base = creditForSpeaker(defaultSpeaker);
  const set = new Set<string>();
  for (const sc of scenes) {
    if (sc.lines && sc.lines.length > 0) {
      for (const l of sc.lines) set.add(creditForLine(l, base));
    } else {
      set.add(base); // 単一 narration の場面は既定話者
    }
  }
  if (set.size === 0) set.add(base);
  return Array.from(set);
}
