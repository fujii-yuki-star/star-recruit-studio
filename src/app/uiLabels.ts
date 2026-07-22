// 複数画面で共有するユーザー向けラベル（§6：文言は1か所に集約／§2-3：技術用語を出さない）。
import type { TextKey } from "../domain/enums";
import { formatSceneNumbers } from "./adapters";

/** テキスト種別（textKey）のユーザー向け名称。テンプレ編集・場面編集の双方で使う。全値必須＝enum 追加漏れをコンパイル検知。 */
export const textKeyLabel: Record<TextKey, string> = {
  title: "見出し",
  main: "本文",
  subtitle: "字幕",
  caption: "キャプション",
  url: "URL",
};

/**
 * マイ見た目の削除確認に出す文言（#547）。
 *
 * 削除は**場面の見た目が変わる**という副作用を伴う（開いているプロジェクトで使用中の場面は標準の見た目へ
 * 置き換わる＝`substituteDeletedTemplateInScenes`・#458）。「元に戻せません」だけでは何がどれだけ変わるのか
 * 分からず、**黙って別の見た目に差し替わったのと同じ**になるため、影響を先に示す
 * （§2-5／`15_ERROR_STATE_MODEL` の `TEMPLATE_NOT_FOUND` ③＝納得のうえ行う明示操作にする）。
 *
 * 数は `templateDeleteImpact` で置換と同じ規則から出す＝「変わります」と言った場面が実際に変わる。
 * 他プロジェクトの場面はここでは直せない（マイ見た目はプロジェクト横断で共有＝ADR-0017）。そちらは開いたときに
 * 「見つからない」として書き出しが止まる（同 ②）ので、選び直しが要ることを併せて伝える。
 */
export function deleteLookConfirmMessage(
  impact: { changing: number; losingContent: number; unresolved: number } = { changing: 0, losingContent: 0, unresolved: 0 },
): string {
  const parts = ["この見た目パターンを削除しますか？元に戻せません。"];
  if (impact.changing > 0) parts.push(`この見た目を使っている${impact.changing}個の場面は、標準の見た目に変わります。`);
  // 標準に同じ差し込み先・文字枠が無いと、写真や文字が動画に出なくなる。削除は取り消せないので**先に**知らせる。
  if (impact.losingContent > 0) parts.push(`うち${impact.losingContent}個の場面は写真・文字などが動画に出なくなります。`);
  // 合う標準が無い場面は変わらず「見つからない」まま残る＝そのままでは書き出せない（§2-5）。
  if (impact.unresolved > 0) parts.push(`${impact.unresolved}個の場面は合う標準が無いため、見た目を選び直すまで書き出せません。`);
  parts.push("他のプロジェクトで使っている場面は、開いたときに見た目を選び直してください。");
  return parts.join("");
}

/**
 * 「まとめて標準にする」（#547）が押せない理由。押せないのに理由が出ない／実行内容の説明が出続ける、を作らない（§2-5）。
 */
export function standardLookButtonReason(fixableCount: number, isExporting: boolean): string {
  if (isExporting) return "動画の書き出し中は変更できません。書き出しが終わってから、もう一度お試しください。";
  if (fixableCount === 0) return "この向き・種類に合う標準の見た目がありません。場面編集で選び直してください。";
  return "見つからない見た目の場面を、標準の見た目にまとめて変えます（取り消せます）";
}

/**
 * 「まとめて標準にする」の結果（#547）。
 *
 * 件数だけを見せると、**動画に出なくなった中身のある場面**（マイ見た目は層 id・層構成が標準と違うことが多い）に気づけないまま
 * 「チェックOK」で書き出せてしまう。15 §5 の表示原則（「3件を自動調整、1件は確認が必要」）どおり、
 * 直した件数・**選び直しが要る場面**・直せなかった場面を分けて示す（ADR-0026④）。
 */
export function standardLookResultMessage(r: { fixed: number[]; unfixable: number[]; lostContent: number[] }): string {
  const parts: string[] = [];
  if (r.fixed.length > 0) parts.push(`${r.fixed.length}個の場面を標準の見た目にしました。`);
  if (r.lostContent.length > 0) {
    parts.push(`このうち${formatSceneNumbers(r.lostContent)}は写真・文字などが動画に出なくなったので、場面編集で入れ直してください。`);
  }
  if (r.unfixable.length > 0) {
    parts.push(`${formatSceneNumbers(r.unfixable)}は合う標準の見た目が無いため、場面編集で選び直してください。`);
  }
  return parts.join("");
}
