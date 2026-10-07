// 頼まれた書き出しが「できた」と言えるか（ADR-0042 決定④・#1184）。**純粋関数**。
//
// ⚠️ **ここへ出す理由**＝画面の中に `phase === 'done'` と書くと、
// **その1行を壊しても検査が赤くならない**（書き出しを丸ごと動かさないと確かめられない形）。
// 判定だけ取り出せば、**中止・失敗・そもそも走らなかった**を机の上で固定できる。

import { EXPORT_RUN_PHASE, type ExportRunPhase } from '../export/exportProgress';

/**
 * 頼まれた書き出しの結果（`true`＝終了コード 0 で返してよい）。
 *
 * @param phase 書き出しが**終わったあとの姿**。
 * @param pendingLeft 頼まれた保存先が**まだ残っているか**＝`true` なら**一度も走っていない**
 *   （走れば `takePendingExport` が消す）。
 *
 * ⚠️ **中止も「できなかった」**＝人が止めた回を「できた」で返さない（場面形式と同じ判断）。
 * ⚠️ **走らずに弾かれた回を「できた」にしない**（PR #1202 レビュー）＝
 * ほかの書き出しが走っている等で門前払いされたとき、**たまたま前の回の `done` が残っていると**
 * 「できた」と返してしまう。**保存先が消えていないこと**がその見分けになる。
 */
export function startupExportSucceeded(phase: ExportRunPhase, pendingLeft: boolean): boolean {
  if (pendingLeft) return false;
  return phase === EXPORT_RUN_PHASE.done;
}
