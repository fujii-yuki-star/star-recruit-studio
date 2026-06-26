// FREE 図形（FillItem）の SVG 生成。プレビューと書き出しが同一の描画を共有する（ADR-0001）。
// 多角形/パスの座標は純粋関数で決定論的に計算する（§7 テスト対象）。座標は bbox(x,y,w,h) 基準・整数化。
import { FREE_SHAPE_TYPE } from '../domain/enums';
import type { FillItem } from './layout';

const r = (n: number): number => Math.round(n);

/** rounded_rect の角丸半径（短辺の 15%・整数）。旧 radius フィールドとは独立。 */
export function roundedRectRadius(w: number, h: number): number {
  return r(Math.min(w, h) * 0.15);
}

/** 上向き三角形（bbox 充填）の polygon points。 */
export function trianglePoints(x: number, y: number, w: number, h: number): string {
  return `${r(x + w / 2)},${r(y)} ${r(x)},${r(y + h)} ${r(x + w)},${r(y + h)}`;
}

/** spikes 個の星（bbox 充填・上頂点始まり）の polygon points。外/内半径は bbox 比に追従。 */
export function starPoints(x: number, y: number, w: number, h: number, spikes = 5): string {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const innerRatio = 0.5;
  const pts: string[] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const ratio = i % 2 === 0 ? 1 : innerRatio;
    const angle = -Math.PI / 2 + (Math.PI * i) / spikes;
    pts.push(`${r(cx + (w / 2) * ratio * Math.cos(angle))},${r(cy + (h / 2) * ratio * Math.sin(angle))}`);
  }
  return pts.join(' ');
}

/** 右向きブロック矢印（bbox 充填）の polygon points（軸は中央 1/2・矢じりは右 40%）。 */
export function arrowPoints(x: number, y: number, w: number, h: number): string {
  const headStartX = x + w * 0.6;
  const shaftTop = y + h * 0.25;
  const shaftBot = y + h * 0.75;
  return [
    `${r(x)},${r(shaftTop)}`,
    `${r(headStartX)},${r(shaftTop)}`,
    `${r(headStartX)},${r(y)}`,
    `${r(x + w)},${r(y + h / 2)}`,
    `${r(headStartX)},${r(y + h)}`,
    `${r(headStartX)},${r(shaftBot)}`,
    `${r(x)},${r(shaftBot)}`,
  ].join(' ');
}

/** 吹き出し（角丸の本体＋左下のしっぽ）の path d。本体は上 80%、しっぽは下 20%。 */
export function speechBubblePath(x: number, y: number, w: number, h: number): string {
  const bodyH = h * 0.8;
  const bottom = y + bodyH;
  const rad = Math.min(w, bodyH) * 0.15;
  const tailRightX = x + w * 0.4;
  const tailLeftX = x + w * 0.2;
  const tailTipX = x + w * 0.12;
  return [
    `M ${r(x + rad)} ${r(y)}`,
    `H ${r(x + w - rad)}`,
    `Q ${r(x + w)} ${r(y)} ${r(x + w)} ${r(y + rad)}`,
    `V ${r(bottom - rad)}`,
    `Q ${r(x + w)} ${r(bottom)} ${r(x + w - rad)} ${r(bottom)}`,
    `H ${r(tailRightX)}`,
    `L ${r(tailTipX)} ${r(y + h)}`,
    `L ${r(tailLeftX)} ${r(bottom)}`,
    `H ${r(x + rad)}`,
    `Q ${r(x)} ${r(bottom)} ${r(x)} ${r(bottom - rad)}`,
    `V ${r(y + rad)}`,
    `Q ${r(x)} ${r(y)} ${r(x + rad)} ${r(y)}`,
    'Z',
  ].join(' ');
}

/**
 * FillItem を SVG 図形要素へ。fill/opacity に加え、strokeWidth>0 のとき枠線を付与する。
 * rect/ellipse は枠線なし時に従来出力と完全一致（後方互換）。新図形は polygon/path で描く。
 */
export function freeShapeSvg(item: FillItem): string {
  const stroke =
    item.strokeWidth && item.strokeWidth > 0
      ? ` stroke="${item.strokeColor ?? '#000000'}" stroke-width="${item.strokeWidth}"`
      : '';
  const common = `fill="${item.color}" fill-opacity="${item.opacity}"${stroke}`;
  const { x, y, w, h } = item;
  switch (item.shapeType) {
    case FREE_SHAPE_TYPE.ellipse:
      return `<ellipse cx="${r(x + w / 2)}" cy="${r(y + h / 2)}" rx="${r(w / 2)}" ry="${r(h / 2)}" ${common}/>`;
    case FREE_SHAPE_TYPE.rounded_rect:
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${roundedRectRadius(w, h)}" ${common}/>`;
    case FREE_SHAPE_TYPE.triangle:
      return `<polygon points="${trianglePoints(x, y, w, h)}" ${common}/>`;
    case FREE_SHAPE_TYPE.star:
      return `<polygon points="${starPoints(x, y, w, h)}" ${common}/>`;
    case FREE_SHAPE_TYPE.arrow:
      return `<polygon points="${arrowPoints(x, y, w, h)}" ${common}/>`;
    case FREE_SHAPE_TYPE.speech_bubble:
      return `<path d="${speechBubblePath(x, y, w, h)}" ${common}/>`;
    case FREE_SHAPE_TYPE.rect:
    default:
      // 既存互換：rect は旧 radius フィールドを rx に反映（#185 で UI 廃止・データは残置）。
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${item.radius}" ${common}/>`;
  }
}
