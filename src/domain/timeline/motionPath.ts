// 動きの道筋と点（ADR-0054 段階2）。純粋関数（副作用なし・§7 テスト対象）。
//
// 選んだ部品が**どこを通るか**を線で、位置を決めているキーフレームを**点**で、キャンバスの上に重ねて描くための形を作る。
// ⚠️ **編集用の重ね描き**＝仕上がり確認の上だけに出す。描画核（`layoutTimelineAt`）にも書き出しにも入れない（ADR-0001 の外）。
// ⚠️ **補間の規則は書かない**＝位置は `interpolateKeyframes`（描画と同じ）から取る＝線は実際に描かれる軌跡と一致する。
//   ⚠️ ただし**喋っている間の動き**（ADR-0056）は線に入れない＝声が鳴っている間は、描かれた部品が線から縦にずれる
//   （手で付けた動きの道筋を見せるための線なので、声で足される揺れは描かない）。
//
// 道筋は**動きの支点**で描く（既定は部品の中心）＝動きの拡縮・回転は**支点まわり**（`applyInterpolatedTransform`・ADR-0059）
// なので、支点は素の箱の支点に**位置のずれ（x/y）を足しただけ**の所にある（拡縮・回転の動きがあっても線は曲がらない）。
// ⚠️ 支点を外した部品で**中心**を描くと、回転で中心が弧を描くのに線はまっすぐ＝線と実際の動きが割れる。
import { interpolateKeyframes } from '../project/keyframes';
import type { Keyframe } from '../project/types';
import type { ClipBox } from './box';

/** 道筋を何等分して線にするか（キーフレームの時刻は別に必ず通る）。 */
export const MOTION_PATH_SAMPLES = 60;

/** 位置を決めているキーフレームの点。 */
export interface MotionPathKey {
  /** クリップの先頭からの秒（`Keyframe.timeSec`）。 */
  timeSec: number;
  /** その時刻の部品の中心（キャンバスの座標）。 */
  x: number;
  y: number;
}

export interface MotionPath {
  /** 中心が通る線（時刻順）。 */
  line: { x: number; y: number }[];
  /** 位置（x か y）を持つキーフレームの点。 */
  keys: MotionPathKey[];
}

/**
 * 部品の動きの道筋と点。位置を動かす動き（x か y を持つキーフレーム）が無ければ `null`＝何も描かない。
 *
 * ⚠️ **点はクリップの長さの中にあるものだけ**＝縮めた帯の外に残ったキーフレームは描かれない時刻なので、掴ませない
 * （掴んで直すと、置ける範囲へ寄せられて**別の時刻に点が増える**＝`setKeyframe` は時刻を範囲へ収める）。
 */
export function motionPathOf(
  box: ClipBox,
  keyframes: readonly Keyframe[],
  durationSec: number,
  pivot?: { x: number; y: number },
): MotionPath | null {
  const posKeys = keyframes.filter((k) => (k.x != null || k.y != null) && k.timeSec >= 0 && k.timeSec <= durationSec);
  if (posKeys.length === 0) return null;
  // 支点（素の箱の向きで測る＝描画と同じ）。未指定＝中心。
  const ox = ((pivot?.x ?? 0.5) - 0.5) * box.w;
  const oy = ((pivot?.y ?? 0.5) - 0.5) * box.h;
  const r = ((box.rotation ?? 0) * Math.PI) / 180;
  const cx = box.x + box.w / 2 + ox * Math.cos(r) - oy * Math.sin(r);
  const cy = box.y + box.h / 2 + ox * Math.sin(r) + oy * Math.cos(r);
  const centerAt = (t: number): { x: number; y: number } => {
    const tr = interpolateKeyframes(keyframes, t);
    return { x: cx + (tr.x ?? 0), y: cy + (tr.y ?? 0) };
  };
  const times = new Set<number>();
  for (let i = 0; i <= MOTION_PATH_SAMPLES; i += 1) times.add((durationSec * i) / MOTION_PATH_SAMPLES);
  for (const k of posKeys) times.add(k.timeSec);
  const line = [...times].sort((a, b) => a - b).map(centerAt);
  const keys = [...posKeys].sort((a, b) => a.timeSec - b.timeSec).map((k) => ({ timeSec: k.timeSec, ...centerAt(k.timeSec) }));
  return { line, keys };
}

/** 掴んだ点を動かしたとき、軸を書き足すと見なす最小の動き（キャンバスの px）の既定。画面からは `DRAG_START_PX` を倍率で直した値が来る。 */
export const MOTION_KEY_AXIS_MIN_PX = 1;

/**
 * 点を `dx`/`dy`（キャンバスの px）だけ動かしたときに、そのキーフレームへ書く位置（`setKeyframe` に渡す形）。
 *
 * - 値は「本来の位置からのずれ」なので、**元のずれに足す**だけ（時刻は変えない＝ADR-0054 決定2）。
 * - ⚠️ **そのキーが持っていない軸は、実際に動かしたとき（`axisMinPx` 以上）だけ書き足す**＝横へ引いただけで縦の値まで書くと、
 *   縦の動きの区切りが1つ増え、その前後の**緩急（イージング）の付き方が変わる**（触っていない縦の動きが変わる）。
 *   書き足すときの元の値は、その時刻に実際に描かれているずれ（補間の値）＝掴んだ瞬間に点が飛ばない。
 * - ⚠️ **持っていない軸は、動かさなければ `null`（外す）を返す**＝掴んだまま一度引いて戻したとき、途中で書き足した
 *   値を残さない（ドラッグの間は掴んだ時点のキーフレームと合計の動きで毎回計算し直す＝足し込まない）。
 */
export function keyPositionAfterDrag(
  keyframes: readonly Keyframe[],
  timeSec: number,
  dx: number,
  dy: number,
  axisMinPx: number = MOTION_KEY_AXIS_MIN_PX,
): { x?: number | null; y?: number | null } {
  const key = keyframes.find((k) => k.timeSec === timeSec);
  if (!key) return {};
  const tr = interpolateKeyframes(keyframes, timeSec);
  const out: { x?: number | null; y?: number | null } = {};
  if (key.x != null) out.x = key.x + dx;
  else out.x = Math.abs(dx) >= axisMinPx ? (tr.x ?? 0) + dx : null;
  if (key.y != null) out.y = key.y + dy;
  else out.y = Math.abs(dy) >= axisMinPx ? (tr.y ?? 0) + dy : null;
  return out;
}
