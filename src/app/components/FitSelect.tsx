import { FIT, type Fit } from "../../domain/enums";

// 「枠への収め方」セレクト（動画クリップ＝asset.clip.fit と 画像スロット＝scene.slotFits で共用）。
// 文言は1か所に集約（§6）。ラベル（「枠への収め方」等）と field ラッパは呼び出し側が付ける。
export function FitSelect({ value, onChange }: { value: Fit; onChange: (fit: Fit) => void }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value as Fit)}>
      <option value={FIT.cover}>枠いっぱいに表示（はみ出しは切り取り）</option>
      <option value={FIT.contain}>全体を表示（余白が入る）</option>
      <option value={FIT.stretch}>枠に合わせて伸縮</option>
    </select>
  );
}
