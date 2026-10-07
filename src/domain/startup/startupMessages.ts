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

/**
 * 声を作り終えたときの知らせ（#1204・§2-5＝残っていれば**次の行動**を出す）。
 *
 * ⚠️ **残りが 0 でないときは「できた」と言わない**＝途中で失敗した回を成功に見せない。
 */
export function makeVoicesDoneMessage(left: number): string {
  if (left <= 0) return "読み上げの声を作りました。";
  return `読み上げの声を${left}件、作れませんでした。文を確かめてから、もう一度お試しください。`;
}

/**
 * 起動の引数で書き出し終えたときの**注意**（#1366・§2-5）。成功は止めない＝終了コードは 0 のまま、
 * 画面なら「注意」として見せている中身を、頼んだ側（外の AI）へ1行ずつ渡す。
 *
 * ⚠️ **文は画面と同じものを渡す**（§6＝同じ文を2か所に持たない）＝ここは「注意：見出し：中身」へ並べるだけ。
 * ⚠️ **無ければ `null`**（何も出さない＝毎回「注意0件」と出すと本物が埋もれる）。
 */
export function startupExportNotes(items: readonly { label: string; detail: string }[]): string | null {
  if (items.length === 0) return null;
  return items.map((i) => `注意：${i.label}：${i.detail}`).join('\n');
}
