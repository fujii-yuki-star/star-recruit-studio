// ナレーター音声のクレジット文言。ADR-0003「常時クレジット」の単一の参照元（CLAUDE.md §2-7/§6）。
// コロンは半角＝VOICEVOX 規約が指定する基本形式「VOICEVOX:キャラクター名」に合わせる（13§4 / ADR-0003）。
// 書き出し動画への焼き込み（renderer）と画面表示（About/Settings）で共有し、文言の散逸を防ぐ。
// #177：単一キャラ固定をやめ、選択した speaker のキャラを動的にクレジットする（creditForSpeaker）。
import { creditListsAllVoices, stackedCreditText } from './creditDisplay';
import type { CreditDisplay } from './creditDisplay';
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

/** クレジットを数えるのに要る形（文が無い行・場面は声が作られないので数えない）。 */
type CreditScene = {
  lines?: { speaker?: number | null; text?: string }[] | null;
  narration?: { text?: string } | null;
};

/**
 * プロジェクトで実際に使う VOICEVOX クレジットを重複なく集める（#251 About の全列挙・ADR-0025 クレジット集約で共有）。
 * 掛け合いの場面は行ごとの話者、単一 narration の場面は既定話者（defaultSpeaker）を採用する（実際に合成される声と一致）。
 * 場面が無い/空でも既定話者のクレジットは1件返す（About 後方互換・プロジェクト未読込時＝選択話者のみ）。
 * @param defaultSpeaker アプリ設定の選択話者（getVoicevoxSpeaker）。
 */
export function usedVoiceCredits(
  scenes: ReadonlyArray<CreditScene>,
  defaultSpeaker: number | null | undefined,
): string[] {
  return sceneVoiceCredits(scenes, creditForSpeaker(defaultSpeaker));
}

/**
 * `usedVoiceCredits` の、既定の声を**文言で**受ける版（書き出しは文言しか持っていない＝`opts.credit`）。
 * 並びは**場面と行の順に、最初に出てきた順**。
 */
export function sceneVoiceCredits(
  scenes: ReadonlyArray<CreditScene>,
  baseCredit: string,
): string[] {
  // ⚠️ **文が無いものは数えない**（PR レビュー 🟡・2026-10-01）＝声は文が空だと作られない（`projectStore` の生成が飛ばす）。
  //   数えると、題字だけの場面の既定の声のように**鳴らない声の名乗りが動画に焼かれる**（タイムライン形式は鳴らない読み上げを数えない＝ADR-0026②）。
  //   ⚠️ 文の欄を持たない呼び出し（形だけ渡す古い呼び出し）は従来どおり数える＝空文字列だけを外す。
  const hasText = (t: string | undefined) => t === undefined || t.trim().length > 0;
  const set = new Set<string>();
  for (const sc of scenes) {
    if (sc.lines && sc.lines.length > 0) {
      for (const l of sc.lines) if (hasText(l.text)) set.add(creditForLine(l, baseCredit));
    } else if (hasText(sc.narration?.text)) {
      set.add(baseCredit); // 単一 narration の場面は既定話者
    }
  }
  if (set.size === 0) set.add(baseCredit);
  return Array.from(set);
}

/**
 * **場面形式**で、その場面（その行）に焼くクレジットの文（ADR-0025 追補・2026-10-01）。
 * - 「最初」「最後」「最初と最後」＝**使った声を全員、縦に**（`creditListsAllVoices`）
 * - 「ずっと表示」＝話している行のキャラ（行が無ければ既定の声）＝従来どおり
 *
 * ⚠️ **プレビュー（場面・切り替え）と書き出しはこの1つを通す**（ADR-0001）＝4か所で組み立てていた頃は、
 *   1か所だけ直すと「プレビューでは全員なのに動画は1人」になる形だった。
 */
export function sceneCreditText(
  display: CreditDisplay | undefined,
  scenes: ReadonlyArray<CreditScene>,
  line: { speaker?: number | null } | null | undefined,
  baseCredit: string,
): string {
  if (creditListsAllVoices(display)) return stackedCreditText(sceneVoiceCredits(scenes, baseCredit));
  return line ? creditForLine(line, baseCredit) : baseCredit;
}
