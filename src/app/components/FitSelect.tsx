import { FIT, type Fit } from "../../domain/enums";

// 「枠への収め方」セレクト（動画クリップ＝asset.clip.fit と 画像スロット＝scene.slotFits で共用）。文言は1か所（§6）。
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
      <option value={FIT.cover}>枠いっぱいに表示（はみ出しは切り取り）</option>
      <option value={FIT.contain}>全体を表示（余白が入る）</option>
      <option value={FIT.stretch}>枠に合わせて伸縮</option>
    </select>
  );
}
