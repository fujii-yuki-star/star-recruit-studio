// 数値入力の共通コンポーネント（#459 item4）。全画面で clamp/空/NaN の挙動を揃える。
// - 入力中はドラフト（自由入力）＝多桁入力や一時的な範囲外・空欄を壊さない。
// - 確定（blur/Enter）で数値化：数値は min/max にクランプして commit。
//   空/NaN は、onClear ありなら「クリア（例: クリップ終了=最後まで／掛け合い開始秒=自動）」、無しなら無視して元値へ戻す。
// これで「空→0 に化ける」「打っている途中で桁がクランプされる」を解消し、#411 の入力防御（範囲外を保存しない）とも整合。
import { useState, type CSSProperties } from "react";

export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onClear,
  placeholder,
  suffix,
  style,
  inputStyle,
  inputClassName = "input",
  title,
}: {
  /** ラベル。省略時は input だけを返す（「開始 〜 終了」のようなインライン配置用）。 */
  label?: string;
  /** 値。null/undefined は空欄表示（クリア可能な欄で使う）。 */
  value: number | null | undefined;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  /** 指定すると「空欄で確定＝クリア」を許す（onClear を呼ぶ）。未指定なら空欄は元値へ戻す。 */
  onClear?: () => void;
  placeholder?: string;
  /** 単位表示（例: "%"）。 */
  suffix?: string;
  /** 外側（ラベル付き時）の flex 等。 */
  style?: CSSProperties;
  /** input 自体のスタイル（幅指定など）。 */
  inputStyle?: CSSProperties;
  inputClassName?: string;
  title?: string;
}) {
  const isEmpty = value == null;
  // draft=null は非編集中（value を表示）。編集中は自由入力文字列を保持する。
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (isEmpty ? "" : String(value));

  const commit = (): void => {
    if (draft == null) return;
    const t = draft.trim();
    if (t === "") {
      // 空で確定：クリア可能な欄はクリア、そうでなければ何もしない（＝元値へ戻る）。
      onClear?.();
    } else {
      const n = Number(t);
      if (!Number.isNaN(n)) {
        let c = n;
        if (min != null) c = Math.max(min, c);
        if (max != null) c = Math.min(max, c);
        if (c !== value) onChange(c);
      }
    }
    setDraft(null);
  };

  const input = (
    <input
      className={inputClassName}
      type="number"
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      title={title}
      style={inputStyle}
      value={shown}
      onFocus={() => setDraft(isEmpty ? "" : String(value))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (!e.nativeEvent.isComposing && e.key === "Enter") commit();
      }}
    />
  );

  // ラベル無し＝インライン配置用に input だけ返す。
  if (!label) return input;

  return (
    <label className="text-sm" style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, margin: 0, ...style }}>
      {label}
      <span className="row gap-sm" style={{ alignItems: "center" }}>
        {input}
        {suffix && <span className="text-faint text-sm">{suffix}</span>}
      </span>
    </label>
  );
}
