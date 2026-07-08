// 数値入力の共通コンポーネント（#459 item4）。全画面で clamp/空/NaN の挙動を揃える。
// - 入力中はドラフト（自由入力）＝多桁入力や一時的な範囲外・空欄を壊さない。
// - 確定（blur/Enter）で数値化：空/NaN は無視して元値へ戻す、数値は min/max にクランプして commit。
// これで「空→0 に化ける」「打っている途中で桁がクランプされる」問題を解消し、#411 の入力防御（範囲外を保存しない）とも整合。
import { useState, type CSSProperties } from "react";

export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  suffix,
  style,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  /** 単位表示（例: "%"）。ラベル末尾ではなく値の後ろに小さく出す。 */
  suffix?: string;
  /** 外側の flex 等（例: 横並びの基準幅）を呼び出し側で指定する。 */
  style?: CSSProperties;
}) {
  // draft=null は非編集中（value を表示）。編集中は自由入力文字列を保持する。
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);

  const commit = (): void => {
    if (draft == null) return;
    const n = Number(draft);
    // 空/NaN は無視（元値へ戻す）。数値なら min/max にクランプして反映（変化があるときだけ）。
    if (draft.trim() !== "" && !Number.isNaN(n)) {
      let c = n;
      if (min != null) c = Math.max(min, c);
      if (max != null) c = Math.min(max, c);
      if (c !== value) onChange(c);
    }
    setDraft(null); // 確定＝ドラフト破棄。value（or クランプ済み）表示へ戻る。
  };

  return (
    <label className="text-sm" style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, margin: 0, ...style }}>
      {label}
      <span className="row gap-sm" style={{ alignItems: "center" }}>
        <input
          className="input"
          type="number"
          min={min}
          max={max}
          step={step}
          value={shown}
          onFocus={() => setDraft(String(value))}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (!e.nativeEvent.isComposing && e.key === "Enter") commit();
          }}
        />
        {suffix && <span className="text-faint text-sm">{suffix}</span>}
      </span>
    </label>
  );
}
