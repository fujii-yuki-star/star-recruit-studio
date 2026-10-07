// まとめて取り込みの**回し方**（#1024 ③／PR #1034 レビュー 🔴）。
//
// ⚠️ **写して増やしたのが原因だった**＝この回し方は場面形式（`projectStore`）と
// タイムライン形式（`timelineStore`）に**そっくり同じものが2つ**あり、中止の仕組みを
// 片方（場面形式）にだけ足した。画面のボタンは**もう片方の store の中止**を呼んでいたので、
// タイムライン編集では**押しても何も起きない**（レビューで見つかった）。
// そこで**回し方を1つにする**＝どちらの形式でも同じ振る舞いになる（ADR-0026②）。
//
// ⚠️ **入口の断り方は寄せない**＝場面形式は「書き出し中／取り込み中」を自分で見て、
// タイムライン形式は `canStartImport` を通す（見る順番に意味がある）。**違うものを混ぜない**。
import { fileNameOf, UNNAMED_ASSET_NAME } from "../../domain/asset/assetFile";
import { IMPORT_BUSY_MESSAGE, importCancelledMessage, importPartlyFailedMessage } from "../uiLabels";

/** store 側から渡す取り出し口（`get`/`set` をそのまま渡さないので、検査で直接叩ける）。 */
export type BulkImportPort = {
  /** いま1件ぶんの取り込みが走っているか（横取りの検知に使う）。 */
  isImporting: () => boolean;
  /** 直前の1件の結果（`null`＝成功）。 */
  importError: () => string | null;
  setImportError: (message: string | null) => void;
  setProgress: (progress: { done: number; total: number } | null) => void;
  /** 取り込みの世代番号。**中止で進む**＝次の1件へ進む前に、自分がもう現行でないと分かる。 */
  runSeq: () => number;
  /** 1件ぶんを取り込む（結果は `importError` に出る）。 */
  importOne: (item: File | string) => Promise<void>;
};

/**
 * まとめて取り込みを回す。**入口の断りは呼ぶ側**（形式ごとに違う）。
 *
 * ⚠️ **必ず `await` で1件ずつ**（11.2）＝`asset_NNN` は現在の一覧を見て採るので、
 * 並列にすると**同じ番号を2つ採る**か、ロックに**黙って弾かれて消える**。
 * ⚠️ **失敗しても止めない**＝成功した分は残す（§2-5）。
 * ⚠️ **中止は「失敗」ではない**＝入ったものは残っているので、何件入ったかを言う。
 */
export async function runBulkImport(port: BulkImportPort, items: File[] | string[]): Promise<void> {
  // ⚠️ **1件だけのときは進み具合を出さない**＝一瞬出て消える表示は雑音になる。
  const many = items.length > 1;
  if (many) port.setProgress({ done: 0, total: items.length });
  // ⚠️ **この回の世代を控える**（声の一括作成と同じ仕組み）。
  const runSeq = port.runSeq();
  const failedNames: string[] = [];
  let firstMessage: string | null = null;
  let cancelled = false;
  let doneCount = 0;
  try {
    for (const [i, item] of items.entries()) {
      // ⚠️ **中止されたら、次の1件へ進まない**＝残りは名前に挙げない（入らなかっただけで失敗ではない）。
      // ⚠️ **いま運んでいる1件は止まらない**（IPC の往復は途中で切れない）＝入ったものは残す。
      if (port.runSeq() !== runSeq) {
        cancelled = true;
        doneCount = i; // ここまでに回した件数（失敗した分は下で差し引く）
        break;
      }
      // ⚠️ **別の取り込みに横取りされていたら、そこで止める**（#858 レビュー ℹ️）＝
      // 一括の**途中は無ロック**なので、隙に BGM 取り込み等がロックを取ると、次の1件は
      // **黙って return** し `importError` も立たないため**成功として数えてしまう**。
      if (port.isImporting()) {
        for (const rest of items.slice(i)) failedNames.push(fileNameOf(typeof rest === "string" ? rest : rest.name) || UNNAMED_ASSET_NAME);
        firstMessage ??= IMPORT_BUSY_MESSAGE;
        break;
      }
      // 1件ぶんの結果を見分けるため、直前に消してから通す（成功時は取り込み側が null にする）。
      port.setImportError(null);
      await port.importOne(item);
      const message = port.importError();
      if (message) {
        failedNames.push(fileNameOf(typeof item === "string" ? item : item.name) || UNNAMED_ASSET_NAME);
        firstMessage ??= message;
      }
      if (many) port.setProgress({ done: i + 1, total: items.length });
    }
  } finally {
    port.setProgress(null);
  }

  // ⚠️ **全部入ったときにここで消し直さない**＝各件の**直前**で消しているので、最後の1件が成功した
  // 時点で既に空（変異チェックで「消す」行を外しても挙動が変わらなかった＝死んだ枝だった）。
  if (cancelled) {
    port.setImportError(importCancelledMessage(doneCount - failedNames.length));
    return;
  }
  // ⚠️ **1件だけ失敗したときは、その理由をそのまま出す**＝単発で取り込んだときと同じ文言（ADR-0026②）。
  if (failedNames.length === 1) port.setImportError(firstMessage);
  else if (failedNames.length > 1) port.setImportError(importPartlyFailedMessage(failedNames, firstMessage));
}
