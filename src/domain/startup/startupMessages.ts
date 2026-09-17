import type { StartupArgError } from './startupRequest';

/**
 * 引数が読めなかったときに出す文（ADR-0042 ④・§2-5＝次の行動）。
 *
 * ⚠️ **印の名前は出す**＝直すのは頼んだ側（人か、その人の AI）なので、**どれが悪いか**が要る。
 * ⚠️ **技術語は出さない**（§2-3）＝画面に出るのは「起動のときの指定」。
 */
export function startupArgErrorMessage(e: StartupArgError): string {
  switch (e.kind) {
    case 'missingValue':
      return `起動のときの指定「${e.flag ?? ''}」に、続きが書かれていませんでした。指定のうしろに場所や名前を続けてください。`;
    case 'unknown':
      return `起動のときの指定「${e.flag ?? ''}」は分かりませんでした。綴りを確かめてください。`;
    case 'incompleteExport':
      return '書き出しの指定が足りませんでした。どの動画を、どこへ書き出すかの両方を指定してください。';
    case 'conflicting':
      return '取り込みと書き出しは同時に指定できません。どちらか一方にしてください。';
  }
}

/**
 * 取り込めたときの知らせ（落としたぶんがあれば、**黙って減らさずに**言う）。
 *
 * ⚠️ **0 件のときは言わない**＝毎回「0個ありました」と出ると、本当に落ちた回が埋もれる。
 */
export function importDoneMessage(copied: number, skipped: number): string {
  const base = `動画を取り込みました（${copied} 個のファイル）。`;
  return skipped > 0
    ? `${base}${skipped} 個は取り込めなかったので、元のフォルダを確かめてください。`
    : base;
}
