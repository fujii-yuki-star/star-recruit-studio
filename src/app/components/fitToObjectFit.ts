// 収め方（`Fit`）→ CSS の `object-fit`（#512 段1 レビュー＝2画面で別の絵にしない）。
//
// ⚠️ **書き出しは SVG の `preserveAspectRatio`**（`sceneSvg.fitToPreserveAspectRatio`）で同じことを表す。
// 実映像（`video` 要素）だけは CSS で書くしかないので、**写し方をここ1か所**に置く
// （場面形式のプレビューとタイムライン形式のプレビューが別々に書くと、`Fit` に値が増えたとき片方だけ直る）。
import { FIT } from '../../domain/enums';
import type { Fit } from '../../domain/enums';

export function fitToObjectFit(fit: Fit): 'cover' | 'contain' | 'fill' {
  return fit === FIT.contain ? 'contain' : fit === FIT.stretch ? 'fill' : 'cover';
}
