import { CROP_ALIGN_DEFAULT_X, CROP_ALIGN_DEFAULT_Y, CROP_ALIGN_X, CROP_ALIGN_Y, FIT } from '../enums';
import type { CropAlignX, CropAlignY, Fit } from '../enums';

/** 素材の実寸（px）。**絵を測って分かるものだけ**を渡す（分からないときは `undefined`）。 */
export interface SourceSize {
  w: number;
  h: number;
}

/** 切り抜きの割合（`TimelineClip.crop` と同じ意味＝各辺を素材のどれだけ隠すか）。 */
export interface CropFractions {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/** 素材を置く矩形（クリップの箱の左上を原点とした相対座標）。 */
export interface FillPlacement {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * **残った素材を枠いっぱいに映し直す**ときの、素材全体を置く矩形（#634・`11 §7.6.4.1`）。
 *
 * `mask`（既定）が「箱の辺を隠す」のに対し、`fill` は**切り抜いて残った部分が枠を満たす**ように
 * 素材そのものを拡大して置き直す。素材の**実寸**が要るのは、`cover`/`contain` の当てはまり方が
 * 素材の縦横比で決まるため（実寸が分からないときは呼び出し側が `mask` として描く）。
 *
 * 返すのは**素材全体**の矩形で、はみ出した分は呼び出し側が箱で切る（既存の切り抜きと同じ仕組み）。
 * `<image>` には `preserveAspectRatio="none"` を使う前提＝ここで出した矩形がそのまま絵の大きさになる
 * （SVG 側に当てはめを任せると二重に効いてしまう）。
 */
export function fillPlacement(
  source: SourceSize,
  box: { w: number; h: number },
  crop: CropFractions | undefined,
  fit: Fit,
  align?: { x?: CropAlignX; y?: CropAlignY },
): FillPlacement {
  const left = Math.max(0, crop?.left ?? 0);
  const right = Math.max(0, crop?.right ?? 0);
  const top = Math.max(0, crop?.top ?? 0);
  const bottom = Math.max(0, crop?.bottom ?? 0);
  // 壊れたデータ（合計 1 以上）でも 0 で割らない＝わずかに残す（絵が消えるより切れて見える方を採る）。
  // 壊れたデータ（合計 1 以上）でも 0 で割らない＝**素材の 1px を残す**（`cropRectOf` の 1px 規則と同じ形）。
  const cw = Math.max(1, source.w * (1 - left - right));
  const ch = Math.max(1, source.h * (1 - top - bottom));
  // 残った部分を枠へ当てはめる倍率。`stretch` だけ縦横が別（意図的に比率が崩れる）。
  const sx = fit === FIT.stretch ? box.w / cw : fitScale(fit, box.w / cw, box.h / ch);
  const sy = fit === FIT.stretch ? box.h / ch : sx;
  // 残った部分の左上（素材座標）を、枠の中の寄せ位置へ合わせる。
  const x = offset(box.w, cw * sx, source.w * left * sx, align?.x ?? CROP_ALIGN_DEFAULT_X, CROP_ALIGN_X.left, CROP_ALIGN_X.right);
  const y = offset(box.h, ch * sy, source.h * top * sy, align?.y ?? CROP_ALIGN_DEFAULT_Y, CROP_ALIGN_Y.top, CROP_ALIGN_Y.bottom);
  return { x, y, w: source.w * sx, h: source.h * sy };
}

/** `cover`＝枠を満たす（大きい方）／`contain`＝枠に収める（小さい方）。 */
function fitScale(fit: Fit, byWidth: number, byHeight: number): number {
  return fit === FIT.contain ? Math.min(byWidth, byHeight) : Math.max(byWidth, byHeight);
}

/**
 * 1 軸ぶんの位置。`visible`（残った部分の表示上の長さ）を枠 `boxLen` の中で寄せ、
 * そこから隠した分（`hidden`）を戻して**素材全体の左上**にする。
 */
function offset<T extends string>(boxLen: number, visible: number, hidden: number, align: T, atStart: T, atEnd: T): number {
  const slack = boxLen - visible;
  const placed = align === atStart ? 0 : align === atEnd ? slack : slack / 2;
  return placed - hidden;
}
