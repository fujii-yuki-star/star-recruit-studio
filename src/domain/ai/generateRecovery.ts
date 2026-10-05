import { isAiSceneLimitMessage } from '../project/sceneLimit';

/**
 * 動画案づくりに失敗したとき、画面が出す「次の行動」のボタンの型（UI/UX 監査 2026-10-02・§2-5）。
 *
 * - `retry`＝もう一度試す（既定）
 * - `editInput`＝入力を直す（同じ入力を送り直すとまた断られる＝上限の断り）
 * - `shortenInput`＝入力を直すのが先・もう一度試すも残す（時間切れ・長くなりすぎ）
 * - `settings`＝設定を開く（部品が無い・壊れている・接続キーが無い／受け付けられない＝**送り直しても直らない**）
 */
export type GenerateRecovery = 'retry' | 'editInput' | 'shortenInput' | 'settings';

/**
 * 断りの文が**名指ししている行き先**。
 *
 * ⚠️ **ボタンは文が言っていることに従う**＝以前は、文が「アプリを入れ直す／設定で Gemini を選ぶ」と言っているのに、
 * いちばん目立つボタンが「もう一度試す」だった（何度押しても同じ失敗）。文の種類を別のフィールドで持つと
 * 断りを作る所（Rust と TS の両方）を揃え続けることになるので、**文が指している画面の名前**で見分ける
 * （`isAiSceneLimitMessage` と同じ流儀＝文と見分けが同じ目印から来る）。表の全行との対応は検査で見る。
 */
export const SETTINGS_MARK = '設定の「動画案を作るAI」';
export const INPUT_MARK = '入力の「その他・伝えたいこと」';
/** 送った内容そのものを断られた（`AI_REJECTED`＝待っても直らない・PR3 レビュー 🟡）。入力を直すのが先。 */
export const INPUT_REJECTED_MARK = '入力した内容では';
/** 同梱の AI の部品が無い・壊れている（`LOCAL_AI_MISSING`／`LOCAL_AI_BROKEN`）＝入れ直すまで直らない。 */
export const REINSTALL_MARK = 'アプリを入れ直して';

/**
 * ⚠️ **見る順に意味がある**＝設定を名指しする文は、入力にも触れていても設定が先（接続できなければ入力を直しても作れない）。
 * 場面数の上限は文の形が別（`isAiSceneLimitMessage`）で、どの目印も含まない。
 */
export function generateRecovery(message: string | null | undefined): GenerateRecovery {
  if (isAiSceneLimitMessage(message)) return 'editInput';
  if (message == null) return 'retry';
  if (message.includes(SETTINGS_MARK)) return 'settings';
  if (message.includes(INPUT_MARK) || message.includes(INPUT_REJECTED_MARK)) return 'shortenInput';
  return 'retry';
}

/**
 * 編集の途中の手伝い（ADR-0053）で、**同梱の AI そのものが使えない**と分かったか。
 * ⚠️ 手伝いは同梱の AI だけに頼む（外部へ送らない）ので、設定を名指しする文（接続キー・モデル名）は来ない。
 * それでも「設定を名指し」で見分けると、来たときに「入れ直して」と言い切ってボタンを止めてしまう＝**入れ直しの文だけ**で見る（PR3 レビュー 🟡）。
 */
export function isLocalAiUnavailableMessage(message: string | null | undefined): boolean {
  return message != null && message.includes(REINSTALL_MARK);
}
