// SceneLayout → SVG文字列。SVGを「描画の中間表現」とし、プレビュー（WebViewでそのまま表示）と
// 出力（同じSVGをラスタライズしてPNG化）で同一にすることでパリティを保証する（ADR-0001）。
// 注: テキスト折返しは暫定で文字数概算。プレビュー実装ではフォント実測に置換する（05 §10 / ADR-0001 未解決論点）。
import type { LayoutItem, SceneLayout, TextItem } from './layout';

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

function itemToSvg(item: LayoutItem): string {
  switch (item.kind) {
    case 'fill':
      return `<rect x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" rx="${item.radius}" fill="${item.color}" fill-opacity="${item.opacity}"/>`;
    case 'image': {
      // 実画像はプレビュー実装で <image href> に差し替え。ここでは枠＋ラベルのプレースホルダ。
      const fill = item.role === 'character' ? '#eef3fb' : '#e8e8e8';
      const caption = item.assetId ? item.label : `${item.label}（未設定）`;
      return [
        `<g>`,
        `<rect x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" fill="${fill}" stroke="#c8c8c8"/>`,
        `<text x="${item.x + item.w / 2}" y="${item.y + item.h / 2}" font-family="${FONT_FAMILY}" font-size="28" fill="#888888" text-anchor="middle">${escapeXml(caption)}</text>`,
        `</g>`,
      ].join('');
    }
    case 'text':
      return textToSvg(item);
  }
}

export function layoutToSvg(layout: SceneLayout): string {
  const body = layout.items.map(itemToSvg).join('\n');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">`,
    `<rect x="0" y="0" width="${layout.width}" height="${layout.height}" fill="${layout.backgroundColor}"/>`,
    body,
    `</svg>`,
  ].join('\n');
}
