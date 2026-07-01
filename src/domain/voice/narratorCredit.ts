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
 * 複数行の使用話者をまとめたクレジット文言（#243）。掛け合いを1フレームで焼くとき（動画スロットあり等で
 * 行ごとに分割できない場合）に使用キャラを全て併記して網羅する。重複は除き「 / 」で連結。
 */
export function creditForLines(lines: { speaker?: number | null }[], fallbackCredit: string): string {
  const set = new Set<string>();
  for (const l of lines) set.add(creditForLine(l, fallbackCredit));
  return set.size > 0 ? Array.from(set).join(' / ') : fallbackCredit;
}
