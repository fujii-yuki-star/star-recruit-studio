// 設定UIの 0-100 スライダー ↔ voiceSettings の値（話速・高さ・抑揚）の相互変換（純粋）。
// 値域は schemas/project.schema.json の VoiceSettings（§7.1）、既定値（スライダー中央=50）は 11 §6。
// 既定をスライダー中央に置くため、min→def→max の二段線形でマップする（speed は非対称なので必須）。
export interface ParamRange {
  min: number;
  def: number;
  max: number;
}

export const SPEED_RANGE: ParamRange = { min: 0.5, def: 1.0, max: 2.0 };
export const PITCH_RANGE: ParamRange = { min: -1.0, def: 0.0, max: 1.0 };
export const INTONATION_RANGE: ParamRange = { min: 0.0, def: 1.0, max: 2.0 };

function clampSlider(v: number): number {
  return Math.max(0, Math.min(100, v));
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** スライダー(0-100) → 値。0→min / 50→def / 100→max の二段線形。 */
export function sliderToValue(slider: number, r: ParamRange): number {
  const s = clampSlider(slider);
  const v =
    s <= 50
      ? r.min + (s / 50) * (r.def - r.min)
      : r.def + ((s - 50) / 50) * (r.max - r.def);
  return round2(v);
}

/** 値 → スライダー(0-100)。min→0 / def→50 / max→100。 */
export function valueToSlider(value: number, r: ParamRange): number {
  const v = Math.max(r.min, Math.min(r.max, value));
  const s =
    v <= r.def
      ? ((v - r.min) / (r.def - r.min)) * 50
      : 50 + ((v - r.def) / (r.max - r.def)) * 50;
  return Math.round(s);
}
