// SceneLayout → SVG文字列。SVGを「描画の中間表現」とし、プレビュー（WebViewでそのまま表示）と
// 出力（同じSVGをラスタライズしてPNG化）で同一にすることでパリティを保証する（ADR-0001）。
// 注: テキスト折返しは暫定で文字数概算。プレビュー実装ではフォント実測に置換する（05 §10 / ADR-0001 未解決論点）。
import { FREE_SHAPE_TYPE } from '../domain/enums';
import type { Fit } from '../domain/enums';
import type { ImageItem, LayoutItem, SceneLayout, TextItem } from './layout';

const FONT_FAMILY = 'Noto Sans JP, sans-serif';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  if (maxChars < 1) return [text];
  const lines: string[] = [];
  let rest = text;
  while (rest.length > 0 && lines.length < maxLines) {
    lines.push(rest.slice(0, maxChars));
    rest = rest.slice(maxChars);
  }
  if (rest.length > 0 && lines.length > 0) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = `${last.slice(0, Math.max(0, maxChars - 1))}…`;
  }
  return lines;
}

function textToSvg(item: TextItem): string {
  const parts: string[] = [];
  const approxCharWidth = item.fontSize * 0.58; // 全角想定の概算
  const maxChars = Math.max(1, Math.floor(item.w / approxCharWidth));
  const lines = wrapText(item.text, maxChars, item.maxLines);
  const lineHeight = item.fontSize * 1.3;

  if (item.background) {
    const bgHeight = lineHeight * lines.length + item.fontSize * 0.6;
    parts.push(
      `<rect x="${item.x}" y="${item.y}" width="${item.w}" height="${bgHeight}" rx="${item.background.radius}" fill="${item.background.color}" fill-opacity="${item.background.opacity}"/>`,
    );
  }

  const baseY = item.y + item.fontSize;
  lines.forEach((line, i) => {
    parts.push(
      `<text x="${item.x}" y="${baseY + i * lineHeight}" font-family="${FONT_FAMILY}" font-size="${item.fontSize}" font-weight="${item.fontWeight}" fill="${item.color}">${escapeXml(line)}</text>`,
    );
  });
  return parts.join('\n');
}

/** SVG生成オプション。assetSrc は assetId→表示用src(data URL)。未解決ならプレースホルダ枠。 */
export interface LayoutToSvgOptions {
  assetSrc?: (assetId: string | null) => string | undefined;
  /** true なら背景の全面塗りを描かない（透過PNG用＝動画スロットより上のレイヤー。ADR-0006）。 */
  transparent?: boolean;
  /** 描画するアイテムを絞る（動画ありシーンの下/上分割用）。未指定なら全件。 */
  itemFilter?: (item: LayoutItem) => boolean;
}

// fit を <image> の preserveAspectRatio へ（cover=slice / contain=meet / stretch=none）。
function fitToPreserveAspectRatio(fit: Fit): string {
  if (fit === 'contain') return 'xMidYMid meet';
  if (fit === 'stretch') return 'none';
  return 'xMidYMid slice';
}

function imageToSvg(item: ImageItem, src: string | undefined): string {
  if (item.assetId && src) {
    // <image> は x/y/width/height の矩形にクリップされ、preserveAspectRatio で fit を表現する。
    // プレビューと出力で同一SVGを共有する（ADR-0004：WebView Canvas でラスタライズ）。
    return `<image x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" href="${escapeXml(src)}" preserveAspectRatio="${fitToPreserveAspectRatio(item.fit)}"/>`;
  }
  // 未設定 or src未解決：枠＋ラベルのプレースホルダ。
  const fill = item.role === 'character' ? '#eef3fb' : '#e8e8e8';
  const caption = item.assetId ? item.label : `${item.label}（未設定）`;
  return [
    `<g>`,
    `<rect x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" fill="${fill}" stroke="#c8c8c8"/>`,
    `<text x="${item.x + item.w / 2}" y="${item.y + item.h / 2}" font-family="${FONT_FAMILY}" font-size="28" fill="#888888" text-anchor="middle">${escapeXml(caption)}</text>`,
    `</g>`,
  ].join('');
}

function itemToSvg(item: LayoutItem, opts: LayoutToSvgOptions): string {
  switch (item.kind) {
    case 'fill':
      if (item.shapeType === FREE_SHAPE_TYPE.ellipse) {
        return `<ellipse cx="${item.x + item.w / 2}" cy="${item.y + item.h / 2}" rx="${item.w / 2}" ry="${item.h / 2}" fill="${item.color}" fill-opacity="${item.opacity}"/>`;
      }
      return `<rect x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" rx="${item.radius}" fill="${item.color}" fill-opacity="${item.opacity}"/>`;
    case 'image':
      return imageToSvg(item, item.assetId ? opts.assetSrc?.(item.assetId) : undefined);
    case 'text':
      return textToSvg(item);
  }
}

export function layoutToSvg(layout: SceneLayout, opts: LayoutToSvgOptions = {}): string {
  const items = opts.itemFilter ? layout.items.filter(opts.itemFilter) : layout.items;
  const body = items.map((item) => itemToSvg(item, opts)).join('\n');
  // transparent 時は背景の全面塗りを出さない（動画が透けて見える上レイヤー用）。
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">`,
  ];
  if (!opts.transparent) {
    lines.push(
      `<rect x="0" y="0" width="${layout.width}" height="${layout.height}" fill="${layout.backgroundColor}"/>`,
    );
  }
  lines.push(body, `</svg>`);
  return lines.join('\n');
}
