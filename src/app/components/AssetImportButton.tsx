// 素材を取り込むボタン（#712）。**両方の形式が同じ押し心地で使う**ための共有部品（§2-7・ADR-0026②）。
// 選び方の分岐そのものは `useAssetPicker`（見た目の違う入口＝はじめの入力の大きな枠とも共有する）。
import { UploadIcon } from "./icons";
import { useAssetPicker } from "../hooks/useAssetPicker";

/**
 * 取り込みの**一式**（store が持つ4つ）。
 *
 * ⚠️ **バラバラに受け取っていたのが事故のもとだった**（PR #1034 レビュー 🔴）＝
 * タイムライン編集の画面は、取り込みを**タイムライン形式の store** から取りながら、
 * 中止だけ**場面形式の store** から渡していた（押しても止まらない）。
 * 型は合うので気づけない＝**store を1つ受け取って4つとも自分で取り出す**形にして、
 * 混ざりようがなくした。
 */
export type AssetImportStore = {
  addAssets: (items: File[] | string[]) => void | Promise<void>;
  isImporting: boolean;
  importProgress: { done: number; total: number } | null;
  cancelAssetImport: () => void;
};

type Props = {
  /**
   * 取り込みを持っている store（`useProjectStore` / `useTimelineStore`）。
   * **選ぶ・進み具合・中止**をここから取り出す＝別々の store が混ざらない。
   */
  store: <T>(selector: (state: AssetImportStore) => T) => T;
  /** 音も選べるようにするか（タイムライン形式だけ・差分再監査 3巡目）。 */
  withAudio?: boolean;
  /** 押せない理由（あれば押せなくし、指したときに出す）。 */
  disabledReason?: string | null;
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

export function AssetImportButton({ store, disabledReason, variant = "primary", label = "素材を追加", className, withAudio = false }: Props) {
  // ⚠️ **4つとも同じ store から取る**＝渡し歩くと配り忘れる／別の store が混ざる（上の注記）。
  const onPick = store((s) => s.addAssets);
  const isImporting = store((s) => s.isImporting);
  const progress = store((s) => s.importProgress);
  const onCancel = store((s) => s.cancelAssetImport);
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
  // ⚠️ **失敗の案内はここに置かない**＝4画面とも `importError` を自分で出しているので、
  // ここでも出すと**同じ失敗が二重に見える**（#858 のレビュー中に気づいて寄せた）。
  // ⚠️ **やめられるようにする**（#1024 ③）＝書き出しと声には中止があるのに、
  // 取り込みだけ**打ち切る入口が無かった**（大きな動画を10件入れたら終わるまで待つしかない）。
  // ⚠️ **まとめてのときだけ出す**＝1件は一瞬で終わるので、押す間もない。
  // ⚠️ **入ったものは残す**（取り消しではない）＝言い方も「中止」で揃える。
  // **まとめてのときだけ**中止を出す（1件は一瞬で終わるので、押す間もない）。
  if (!progress) return button;
  return (
    <span className="row gap-sm" style={{ alignItems: "center" }}>
      {button}
      <button type="button" className="btn btn-ghost text-sm" onClick={onCancel}>
        取り込みを中止
      </button>
    </span>
  );
}
