// グループの拡大率（内部・1=等倍）と UI の「大きさ(%)」（100=等倍）の相互変換（#554）。
// 濃さ(%)（format/opacity）と同じ流儀＝非技術者に見せる単位は % に寄せる（§2-3）。
// opacity と違い **上限は設けない**：グループ拡縮ドラッグ（FreeLayoutOverlay / TemplateLayerOverlay）にも
// 上限が無く、schema（project.schema.json `$defs/Group.transform.scale`）も `exclusiveMinimum: 0` だけ＝
// 上限を足すと「ドラッグでは行けるのに数値では行けない」非対称を新造してしまう（#554 の趣旨・ADR-0026②）。
// 下限だけ GROUP_MIN_SCALE で揃え、ドラッグ・数値入力・schema の三者が同じ到達範囲になるようにする。
import { GROUP_MIN_SCALE } from '../constants';

/** 内部の拡大率（1=等倍）→ UI の「大きさ(%)」（100=等倍）。表示用に整数％へ丸める。 */
export function scaleToPercent(scale: number): number {
  return Math.round(clampScale(scale) * 100);
}

/** UI の「大きさ(%)」（100=等倍）→ 内部の拡大率。下限は GROUP_MIN_SCALE（schema の scale>0 を満たす）。 */
export function percentToScale(percent: number): number {
  return clampScale(percent / 100);
}

/** 数値入力欄に渡す下限（%）。GROUP_MIN_SCALE から導出＝直書きしない（§2-7）。 */
export const SCALE_PERCENT_MIN = Math.round(GROUP_MIN_SCALE * 100);

function clampScale(v: number): number {
  if (!Number.isFinite(v)) return 1; // NaN/Infinity は等倍へ（opacity の clampRatio と同じ流儀）
  return Math.max(GROUP_MIN_SCALE, v);
}
