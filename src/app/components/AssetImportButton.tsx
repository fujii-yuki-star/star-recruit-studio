// 素材を取り込むボタン（#712）。**両方の形式が同じ押し心地で使う**ための共有部品（§2-7・ADR-0026②）。
// 選び方の分岐そのものは `useAssetPicker`（見た目の違う入口＝はじめの入力の大きな枠とも共有する）。
import { UploadIcon } from "./icons";
import { useAssetPicker } from "../hooks/useAssetPicker";

type Props = {
  /**
   * 選んだものを**まとめて**取り込む（#858・store の `addAssets`）。
   * ブラウザは `File[]`、アプリの中は絶対パスの `string[]`。
   */
  onPick: (items: File[] | string[]) => void | Promise<void>;
  /** 音も選べるようにするか（タイムライン形式だけ・差分再監査 3巡目）。 */
  withAudio?: boolean;
  /** 取り込み中（押せなくし、そう見せる）。 */
  isImporting: boolean;
  /**
   * まとめて取り込んでいるときの進み具合（store の `importProgress`）。`null`＝出さない。
   *
   * ⚠️ **失敗の案内はここに置かない**＝4画面とも `importError` を自分で出しているので、
   * ここでも出すと**同じ失敗が二重に見える**（#858 のレビュー中に気づいて寄せた）。
   */
  progress?: { done: number; total: number } | null;
  /** 押せない理由（あれば押せなくし、指したときに出す）。 */
  disabledReason?: string | null;
  /**
   * まとめて取り込みを中止する（#1024 ③）。渡さなければ中止のボタンを出さない。
   *
   * ⚠️ **いま運んでいる1件は止まらない**（IPC の往復は途中で切れない）＝
   * **入ったものは残す**（取り消しではない）。
   */
  onCancel?: () => void;
  /** 見た目（既定＝目立つボタン）。 */
  variant?: "primary" | "secondary" | "ghost";
  /** 表示する文言（既定＝「素材を追加」）。 */
  label?: string;
  /**
   * 置き場所ごとの見た目（`btn-block`＝全幅・`mt`＝上の余白など）。**足すだけ**で `btn` は消さない
   * ＝置き換えで**幅や余白が黙って変わる**のを防ぐ（#712 レビュー）。
   */
  className?: string;
};

export function AssetImportButton({ onPick, isImporting, progress = null, disabledReason, onCancel, variant = "primary", label = "素材を追加", className, withAudio = false }: Props) {
  const disabled = isImporting || !!disabledReason;
  const { picking, labelProps, inputProps } = useAssetPicker({ onPick, disabled, withAudio });
  const off = disabled || picking;

  const button = (
    <label
      {...labelProps}
      className={`btn btn-${variant}${className ? ` ${className}` : ""}`}
      style={{ cursor: off ? "default" : "pointer", opacity: off ? 0.6 : 1 }}
      title={disabledReason ?? undefined}
    >
      <UploadIcon size={18} />
      {/* ⚠️ **一括のときは何件目かを出す**（#858）＝10枚入れている間「取り込み中…」だけだと
          進んでいるのか止まっているのか分からない。1件だけのときは出さない（一瞬の表示は雑音）。 */}
      {progress ? `取り込み中… ${progress.done}/${progress.total}` : isImporting ? "取り込み中…" : label}
      <input {...inputProps} />
    </label>
  );
  // ⚠️ **やめられるようにする**（#1024 ③）＝書き出しと声には中止があるのに、
  // 取り込みだけ**打ち切る入口が無かった**（大きな動画を10件入れたら終わるまで待つしかない）。
  // ⚠️ **まとめてのときだけ出す**＝1件は一瞬で終わるので、押す間もない。
  // ⚠️ **入ったものは残す**（取り消しではない）＝言い方も「中止」で揃える。
  if (!progress || !onCancel) return button;
  return (
    <span className="row gap-sm" style={{ alignItems: "center" }}>
      {button}
      <button type="button" className="btn btn-ghost text-sm" onClick={onCancel}>
        取り込みを中止
      </button>
    </span>
  );
}
