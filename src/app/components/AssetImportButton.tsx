// 素材を取り込むボタン（#712）。**両方の形式が同じ押し心地で使う**ための共有部品（§2-7・ADR-0026②）。
// 選び方の分岐そのものは `useAssetPicker`（見た目の違う入口＝はじめの入力の大きな枠とも共有する）。
import { UploadIcon } from "./icons";
import { useAssetPicker } from "../hooks/useAssetPicker";

type Props = {
  /** ブラウザで選んだファイルを取り込む。 */
  onFile: (file: File) => void | Promise<void>;
  /** ネイティブの「開く」で選んだパスを取り込む。 */
  onPath: (path: string) => void | Promise<void>;
  /** 取り込み中（押せなくし、そう見せる）。 */
  isImporting: boolean;
  /** 押せない理由（あれば押せなくし、指したときに出す）。 */
  disabledReason?: string | null;
  /** 見た目（既定＝目立つボタン）。 */
  variant?: "primary" | "secondary" | "ghost";
  /** 表示する文言（既定＝「素材を追加」）。 */
  label?: string;
};

export function AssetImportButton({ onFile, onPath, isImporting, disabledReason, variant = "primary", label = "素材を追加" }: Props) {
  const disabled = isImporting || !!disabledReason;
  const { picking, labelProps, inputProps } = useAssetPicker({ onFile, onPath, disabled });
  const off = disabled || picking;

  return (
    <label
      {...labelProps}
      className={`btn btn-${variant}`}
      style={{ cursor: off ? "default" : "pointer", opacity: off ? 0.6 : 1 }}
      title={disabledReason ?? undefined}
    >
      <UploadIcon size={18} />
      {isImporting ? "取り込み中…" : label}
      <input {...inputProps} />
    </label>
  );
}
