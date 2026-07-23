import { FITS, type Fit } from "../../domain/enums";
import { fitLabel } from "../uiLabels";

// 「枠への収め方」セレクト（動画クリップ＝asset.clip.fit と 画像スロット＝scene.slotFits で共用）。
// 文言は共有 fitLabel（uiLabels）1か所に集約＝テンプレ編集の「収め方」セレクトと同じ語（§6・#547 P2-10）。
// inheritLabel を渡すと先頭に「継承（テンプレ既定に合わせる）」を出し、選ぶと undefined を返す
// ＝画像スロットの slotFits キー削除（テンプレ層の fit に戻す）に使う。fontId/textFontIds の継承UXと同型。
export function FitSelect({
  value,
  onChange,
  inheritLabel,
}: {
  value: Fit | undefined;
  onChange: (fit: Fit | undefined) => void;
  inheritLabel?: string;
}) {
  return (
    <select
      className="select"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? undefined : (e.target.value as Fit))}
    >
      {inheritLabel && <option value="">{inheritLabel}</option>}
      {FITS.map((f) => (
        <option key={f} value={f}>{fitLabel[f]}</option>
      ))}
    </select>
  );
}
