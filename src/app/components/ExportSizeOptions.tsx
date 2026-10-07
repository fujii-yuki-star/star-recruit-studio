import { EXPORT_SIZE } from "../../domain/constants";
import { EXPORT_SIZE_LABEL, EXPORT_SIZE_STANDARD_NOTE } from "../uiLabels";

type Dims = { width: number; height: number };

/**
 * 動画サイズの選択肢（#1218・3択）。**場面形式の書き出し画面とタイムラインの書き出し欄が同じ部品を使う**
 * ＝並び・名前・数を2か所に書かない（ADR-0026②）。`<select>` の中に置く。
 */
export function ExportSizeOptions({ full, light }: { full: Dims; light: Dims }) {
  return (
    <>
      <option value={EXPORT_SIZE.full}>{EXPORT_SIZE_LABEL[EXPORT_SIZE.full]}（{full.width}×{full.height}）</option>
      <option value={EXPORT_SIZE.standard}>
        {EXPORT_SIZE_LABEL[EXPORT_SIZE.standard]}（{full.width}×{full.height}・{EXPORT_SIZE_STANDARD_NOTE}）
      </option>
      <option value={EXPORT_SIZE.light}>{EXPORT_SIZE_LABEL[EXPORT_SIZE.light]}（{light.width}×{light.height}）</option>
    </>
  );
}
