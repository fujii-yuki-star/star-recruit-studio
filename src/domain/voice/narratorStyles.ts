// ナレーターの声（ずんだもん）の選べるスタイル一覧（プロダクトデータ）。
// ADR-0003：ナレーター＝ずんだもんに限定する（「VOICEVOX:ずんだもん」クレジットを保つため、他キャラは選ばせない）。
// speaker は VOICEVOX の speaker(スタイル)番号。UI はこの一覧から選び、設定（appSettings）へ保存する。
// domain に置くことで app（UI）が infrastructure を直接 import せずに済む（CLAUDE.md §4）。
export interface NarratorStyle {
  /** VOICEVOX の speaker(スタイル)番号。 */
  speaker: number;
  /** ユーザー表示名。 */
  label: string;
}

export const NARRATOR_STYLES: NarratorStyle[] = [
  { speaker: 3, label: 'ノーマル' },
  { speaker: 1, label: 'あまあま' },
  { speaker: 7, label: 'ツンツン' },
  { speaker: 5, label: 'セクシー' },
  { speaker: 22, label: 'ささやき' },
];
