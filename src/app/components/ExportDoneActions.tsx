// 書き出しが終わったあとの導線（`06 §13` 完了時・#404／#991 で2形式へ共有）。
//
// ⚠️ **場面形式にしか無かった**（#991）＝タイムライン形式は「動画を保存しました。」と
// **「閉じる」だけ**で、保存先も、開く道も無かった。`06 §12.1` は結果の文言しか決めておらず、
// **導線を落とす理由はどこにも書かれていない**（ADR-0026②＝同じ概念は同じ挙動）。
//
// ⚠️ **1か所に置く**＝画面ごとに書くと、片方だけ直る（このリポジトリで繰り返している型）。
// 開けなかったときの断りも**同じ文**から出す。
import { useState } from "react";
import { BACK_TO_HOME_LABEL } from "../uiLabels";
import { ArrowLeftIcon } from "./icons";
import { openSavedFile, revealSavedFile } from "../../infrastructure/opener";
import { userFacingMessage } from "../userFacingError";

/**
 * 開けなかったときに画面が持つもの。
 *
 * - `builtin` … こちらの定型文を出す合図（理由が言葉で返らなかったとき）
 * - `reason` … **Rust が書き分けた断り**（「覚えていない」「もう無い」「開くアプリが無い」）
 */
type OpenFailure = { kind: "builtin"; which: "open" | "reveal" } | { kind: "reason"; text: string } | null;

/**
 * 開けなかったときの断り（§2-5＝原因の候補と、次にできること）。
 *
 * ⚠️ **`export` しない**＝部品のファイルから関数も出すと、開発中の差し替え（Fast Refresh）が効かなくなる。
 * 外から見たいときは `uiLabels` 側へ移す（いまは使う相手がここだけ）。
 */
function openFailedMessage(kind: "open" | "reveal", path: string): string {
  // ⚠️ **元の文をそのまま持ってくる**（PR #1020 レビュー 🟡2）＝部品へ寄せたとき、
  // **再生の側にだけあった手がかり**（「再生できるアプリがあるかご確認ください」）と
  // **保存先の再掲**を落としていた。共有は**言い方を弱めるためではない**。
  // ⚠️ **保存先をもう一度出す**＝断りが出た時点で上の「保存先：…」から目が離れているので、
  // 探しに行く先をその場に置く。
  return kind === "open"
    ? `動画を再生できませんでした。ファイルが移動・削除されていないか、再生できるアプリがあるかご確認ください（保存先：${path}）。`
    : `保存した場所を開けませんでした。ファイルが移動・削除されていないかご確認ください（保存先：${path}）。`;
}

/**
 * 保存先の表示と、そこへ辿る導線。
 *
 * @param path 保存したファイルの場所（`null` のときは何も出さない＝**嘘の導線を出さない**）。
 * @param onBack 一覧へ戻る（渡さなければ「戻る」を出さない＝画面によっては別の戻り道がある）。
 */
export function ExportDoneActions({ path, onBack }: { path: string | null; onBack?: () => void }) {
  // ⚠️ **合図と本文を型で分ける**（レビュー由来 ℹ️）＝以前は `"open" | "reveal" | string` と
  // 書いていたが、TypeScript ではリテラルの union は `string` に**吸収される**ので、
  // 「合図」と「Rust が書き分けた断り」の区別は**型では守られていなかった**
  //（いま衝突する値は無いが、合図の文字列が本文として出る形を作れてしまう）。
  const [failed, setFailed] = useState<OpenFailure>(null);
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
          // ⚠️ **理由を捨てない**（#1155 ④）＝隣の「動画を再生」は #1118 で関門へ通したのに、
          // こちらだけ**中身を丸ごと捨てて**いた（同じ「開く」が場所で割れていた・ADR-0026②）。
          // ⚠️ **`rawErrorDisplayGuard` はこの形を拾えない**＝関門の呼び出し数の側でしか見ていない。
          onClick={() => {
            setFailed(null);
            void revealSavedFile(path).catch((e: unknown) => {
              const reason = userFacingMessage(e, "reveal");
              setFailed(reason ? { kind: "reason", text: reason } : { kind: "builtin", which: "reveal" });
            });
          }}
        >
          保存した場所を開く
        </button>
        <button
          className="btn btn-ghost"
          // ⚠️ **理由も捨てない**（レビュー由来 🟡・#1118）＝Rust が書き分けた断りを優先して出す。
          onClick={() => {
            setFailed(null);
            void openSavedFile(path).catch((e: unknown) => {
              const reason = userFacingMessage(e, "open-video");
              setFailed(reason ? { kind: "reason", text: reason } : { kind: "builtin", which: "open" });
            });
          }}
        >
          動画を再生
        </button>
        {onBack && (
          <button className="btn btn-ghost btn-icon" onClick={onBack}>
            <ArrowLeftIcon size={16} />
            {BACK_TO_HOME_LABEL}
          </button>
        )}
      </div>
      {failed && (
        <div className="notice notice-warn mt" role="alert">
          {/* ⚠️ **保存先はどちらの道でも出す**（レビュー由来 🟡）＝Rust の断りを優先した結果、
              自前の定型文にだけ付いていた**保存先の再掲**が落ちると、探しに行く先がその場から消える
              （上の「保存先：…」からは目が離れている）。言っていることの差を残さない。 */}
          <span>
            {failed.kind === "builtin"
              ? openFailedMessage(failed.which, path)
              : `${failed.text}（保存先：${path}）`}
          </span>
        </div>
      )}
    </>
  );
}
