// 選べるナレーター音声のカタログ（VOICEVOX 標準キャラ・スタイル）。プロダクトデータ（#177）。
// ADR-0003（更新）：単一キャラ固定をやめ、規約確認済みの VOICEVOX 標準キャラから選べる。使用キャラを常時クレジットする。
// speaker は VOICEVOX の speaker(スタイル)番号。UI はこの一覧から選び、設定（appSettings）へ speaker 番号を保存する。
// クレジットは「VOICEVOX:<character>」（13§4 / narratorCredit）。character はクレジット表記の単一参照元。

export interface VoiceStyle {
  /** VOICEVOX の speaker(スタイル)番号。 */
  speaker: number;
  /** スタイル名（UI 表示）。 */
  label: string;
}

export interface VoiceCharacter {
  /** キャラクター名（クレジット「VOICEVOX:<character>」に使う）。 */
  character: string;
  /** 選べるスタイル。 */
  styles: VoiceStyle[];
}

/** 既定 speaker（ずんだもん・ノーマル）。未設定/不明時のフォールバック。 */
export const DEFAULT_SPEAKER = 3;

/**
 * 選べる VOICEVOX 標準キャラのカタログ（規約確認済みの主要キャラ・段階的に追加可）。
 * speaker 番号は VOICEVOX 標準エンジンの値。
 */
export const VOICE_CATALOG: VoiceCharacter[] = [
  {
    character: '四国めたん',
    styles: [
      { speaker: 2, label: 'ノーマル' }, { speaker: 0, label: 'あまあま' },
      { speaker: 6, label: 'ツンツン' }, { speaker: 4, label: 'セクシー' }, { speaker: 36, label: 'ささやき' },
    ],
  },
  {
    character: 'ずんだもん',
    styles: [
      { speaker: 3, label: 'ノーマル' }, { speaker: 1, label: 'あまあま' },
      { speaker: 7, label: 'ツンツン' }, { speaker: 5, label: 'セクシー' }, { speaker: 22, label: 'ささやき' },
    ],
  },
  { character: '春日部つむぎ', styles: [{ speaker: 8, label: 'ノーマル' }] },
  {
    character: '九州そら',
    styles: [
      { speaker: 16, label: 'ノーマル' }, { speaker: 15, label: 'あまあま' },
      { speaker: 18, label: 'ツンツン' }, { speaker: 17, label: 'セクシー' }, { speaker: 19, label: 'ささやき' },
    ],
  },
  { character: '雨晴はう', styles: [{ speaker: 10, label: 'ノーマル' }] },
  { character: '波音リツ', styles: [{ speaker: 9, label: 'ノーマル' }] },
  {
    character: '玄野武宏',
    styles: [
      { speaker: 11, label: 'ノーマル' }, { speaker: 39, label: '喜び' },
      { speaker: 40, label: 'ツンギレ' }, { speaker: 41, label: '悲しみ' },
    ],
  },
  { character: '白上虎太郎', styles: [{ speaker: 12, label: 'ふつう' }, { speaker: 32, label: 'わーい' }] },
  { character: '青山龍星', styles: [{ speaker: 13, label: 'ノーマル' }] },
  { character: '冥鳴ひまり', styles: [{ speaker: 14, label: 'ノーマル' }] },
  { character: 'もち子さん', styles: [{ speaker: 20, label: 'ノーマル' }] },
  { character: '剣崎雌雄', styles: [{ speaker: 21, label: 'ノーマル' }] },
];

/** speaker 番号 → キャラクター名（カタログ外/未指定は null）。 */
export function characterForSpeaker(speaker: number | null | undefined): string | null {
  if (speaker == null) return null;
  for (const c of VOICE_CATALOG) {
    if (c.styles.some((s) => s.speaker === speaker)) return c.character;
  }
  return null;
}
