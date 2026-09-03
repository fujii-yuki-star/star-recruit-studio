// 書き出しが終わったあとの導線（`06 §13` 完了時・#404／#991 で2形式へ共有）。
//
// ⚠️ **場面形式にしか無かった**（#991）＝タイムライン形式は「動画を保存しました。」と
// **「閉じる」だけ**で、保存先も、開く道も無かった。`06 §12.1` は結果の文言しか決めておらず、
// **導線を落とす理由はどこにも書かれていない**（ADR-0026②＝同じ概念は同じ挙動）。
//
// ⚠️ **1か所に置く**＝画面ごとに書くと、片方だけ直る（このリポジトリで繰り返している型）。
// 開けなかったときの断りも**同じ文**から出す。
import { useState } from "react";
import { ArrowLeftIcon } from "./icons";
import { openSavedFile, revealSavedFile } from "../../infrastructure/opener";

/**
 * 開けなかったときの断り（§2-5＝原因の候補と、次にできること）。
 *
 * ⚠️ **`export` しない**＝部品のファイルから関数も出すと、開発中の差し替え（Fast Refresh）が効かなくなる。
 * 外から見たいときは `uiLabels` 側へ移す（いまは使う相手がここだけ）。
 */
function openFailedMessage(kind: "open" | "reveal"): string {
  return kind === "open"
    ? "動画を再生できませんでした。ファイルが移動・削除されていないか確かめて、もう一度お試しください。"
    : "保存した場所を開けませんでした。ファイルが移動・削除されていないか確かめて、もう一度お試しください。";
}

/**
 * 保存先の表示と、そこへ辿る導線。
 *
 * @param path 保存したファイルの場所（`null` のときは何も出さない＝**嘘の導線を出さない**）。
 * @param onBack 一覧へ戻る（渡さなければ「戻る」を出さない＝画面によっては別の戻り道がある）。
 */
export function ExportDoneActions({ path, onBack }: { path: string | null; onBack?: () => void }) {
  const [failed, setFailed] = useState<"open" | "reveal" | null>(null);
  // ⚠️ **場所が分からないときは何も出さない**＝押しても何も起きないボタンを作らない（§2-5）。
  if (!path) return null;
  return (
    <>
      <div className="notice notice-info mt">
        <span>保存先：{path}</span>
      </div>
      {/* 長いパスを自力で辿らずワンクリックで開ける（#404）。 */}
      <div className="row gap-sm mt" style={{ justifyContent: "center", flexWrap: "wrap" }}>
        <button
          className="btn btn-secondary"
          onClick={() => { setFailed(null); void revealSavedFile(path).catch(() => setFailed("reveal")); }}
        >
          保存した場所を開く
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => { setFailed(null); void openSavedFile(path).catch(() => setFailed("open")); }}
        >
          動画を再生
        </button>
        {onBack && (
          <button className="btn btn-ghost btn-icon" onClick={onBack}>
            <ArrowLeftIcon size={16} />
            プロジェクト一覧へ戻る
          </button>
        )}
      </div>
      {failed && (
        <div className="notice notice-warn mt" role="alert">
          <span>{openFailedMessage(failed)}</span>
        </div>
      )}
    </>
  );
}
