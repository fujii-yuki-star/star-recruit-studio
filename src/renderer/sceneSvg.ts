// SceneLayout → SVG文字列。SVGを「描画の中間表現」とし、プレビュー（WebViewでそのまま表示）と
// 出力（同じSVGをラスタライズしてPNG化）で同一にすることでパリティを保証する（ADR-0001）。
// 注: テキスト折返しは暫定で文字幅概算（半角≈0.55em・全角≈1em）。フォント実測への置換は将来（05 §10 / ADR-0001 未解決論点）。
import { TEXT_ALIGN, type Fit } from '../domain/enums';
import { fontFamilyForId, isKnownFontId } from '../domain/font/fontCatalog';
import type { ImageItem, LayoutItem, SceneLayout, TextItem } from './layout';
import { DEFAULT_LINE_HEIGHT } from './layout';
import { freeShapeSvg } from './freeShapes';

// 既定の font-family（opts.fontFamily 未指定時のフォールバック＝同梱の既定フォント）。
const DEFAULT_FONT_FAMILY = fontFamilyForId(undefined);

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 文字幅の概算（フォント実測の代替・05 §10 / ADR-0001 未解決）。半角(ASCII)は約0.55em、
// それ以外（日本語など全角）はほぼ1em。全角を 0.58em 一律とみなすと縦型の狭幅で折返し不足＝見切れるため区別する。
export function charWidthEm(ch: string): number {
  return ch.charCodeAt(0) <= 0xff ? 0.55 : 1.0;
}

// 幅(px)に収まるよう行へ分割する（全角/半角を区別）。maxLines を超える分は末尾を … で切る。
// 明示改行（\n）はハード改行として尊重する（同時字幕の2行表示など・ADR-0031）＝各段落を幅で折り、全体を maxLines で打ち切る。
export function wrapText(text: string, maxWidth: number, fontSize: number, maxLines: number): string[] {
  if (maxWidth < fontSize || maxLines < 1) return [text];
  const paragraphs = text.split('\n');
  const lines: string[] = [];
  const truncateLast = (): string[] => {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = `${last.slice(0, Math.max(0, last.length - 1))}…`;
    return lines;
  };
  for (let p = 0; p < paragraphs.length; p += 1) {
    const chars = [...paragraphs[p]];
    let line = '';
    let lineW = 0;
    for (let i = 0; i < chars.length; i += 1) {
      const w = charWidthEm(chars[i]) * fontSize;
      if (lineW + w > maxWidth && line.length > 0) {
        lines.push(line);
        line = '';
        lineW = 0;
        if (lines.length >= maxLines) {
          // 行数上限に到達。まだ文字（この段落の残り or 後続段落）があれば直前の行末を … にする。
          if (chars.slice(i).join('').length > 0 || p + 1 < paragraphs.length) return truncateLast();
          return lines;
        }
      }
      line += chars[i];
      lineW += w;
    }
    if (line.length > 0) {
      lines.push(line);
      // 段落末で上限到達＝後続段落が残るなら … で打ち切る（同時字幕の3人目以降が溢れたら省略）。
      if (lines.length >= maxLines && p + 1 < paragraphs.length) return truncateLast();
    }
  }
  return lines;
}

function textToSvg(item: TextItem, fontFamily: string): string {
  const parts: string[] = [];
  // 要素自身の fontId（既知）を優先し、未指定/不明は場面既定（fontFamily＝場面→動画全体→既定の解決済み）へ（#178）。
  const family = isKnownFontId(item.fontId) ? fontFamilyForId(item.fontId) : fontFamily;
  const lines = wrapText(item.text, item.w, item.fontSize, item.maxLines);
  const lineHeight = item.fontSize * (item.lineHeight ?? DEFAULT_LINE_HEIGHT); // 行間（#209）

  if (item.background) {
    const bgHeight = lineHeight * lines.length + item.fontSize * 0.6;
    parts.push(
      `<rect x="${item.x}" y="${item.y}" width="${item.w}" height="${bgHeight}" rx="${item.background.radius}" fill="${item.background.color}" fill-opacity="${item.background.opacity}"/>`,
    );
  }

  // 揃え（#209）：text-anchor と x を決める。未指定=left。背景の矩形は要素幅のまま。
  // ※ 'middle'/'end'/'start' は SVG text-anchor の値（外部API）であり TextAlign enum とは別物。
  const align = item.textAlign ?? TEXT_ALIGN.left;
  const anchor = align === TEXT_ALIGN.center ? 'middle' : align === TEXT_ALIGN.right ? 'end' : 'start';
  const textX = align === TEXT_ALIGN.center ? item.x + item.w / 2 : align === TEXT_ALIGN.right ? item.x + item.w : item.x;
  // 縁取り（#209）：strokeWidth>0 のとき文字に stroke を敷く。paint-order=stroke で塗りの下に置き可読性を保つ。
  const stroke = item.strokeColor && item.strokeWidth && item.strokeWidth > 0
    ? ` stroke="${item.strokeColor}" stroke-width="${item.strokeWidth}" paint-order="stroke"`
    : '';

  const baseY = item.y + item.fontSize;
  lines.forEach((line, i) => {
    parts.push(
      `<text x="${textX}" y="${baseY + i * lineHeight}" font-family="${family}" font-size="${item.fontSize}" font-weight="${item.fontWeight}" fill="${item.color}" text-anchor="${anchor}"${stroke}>${escapeXml(line)}</text>`,
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
  /** true なら SVG ルートの width/height を 100% にする（viewBox は保持＝コンテナにフィット・プレビュー用）。
   *  既定 false：layout 実寸を width/height に出す（resvg/Canvas でのラスタライズ＝書き出し用）。 */
  responsive?: boolean;
  /** 設定時、最前面に常時クレジット（ADR-0003）を焼き込む。書き出し・プレビュー共通。
   *  動画ありシーンは上レイヤーのみに付けて二重化を防ぐ（videoSceneSplit）。 */
  credit?: string;
  /** 描画に使う font-family（同梱フォント選択）。未指定は既定フォント。fontCatalog.fontFamilyForId の戻り値を渡す。 */
  fontFamily?: string;
}

// fit を <image> の preserveAspectRatio へ（cover=slice / contain=meet / stretch=none）。
function fitToPreserveAspectRatio(fit: Fit): string {
  if (fit === 'contain') return 'xMidYMid meet';
  if (fit === 'stretch') return 'none';
  return 'xMidYMid slice';
}

function imageToSvg(item: ImageItem, src: string | undefined, fontFamily: string): string {
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
    `<text x="${item.x + item.w / 2}" y="${item.y + item.h / 2}" font-family="${fontFamily}" font-size="28" fill="#888888" text-anchor="middle">${escapeXml(caption)}</text>`,
    `</g>`,
  ].join('');
}

function renderItemInner(item: LayoutItem, opts: LayoutToSvgOptions, fontFamily: string): string {
  switch (item.kind) {
    case 'fill':
      return freeShapeSvg(item);
    case 'image':
      return imageToSvg(item, item.assetId ? opts.assetSrc?.(item.assetId) : undefined, fontFamily);
    case 'text':
      return textToSvg(item, fontFamily);
  }
}

function itemToSvg(item: LayoutItem, opts: LayoutToSvgOptions, fontFamily: string): string {
  const inner = renderItemInner(item, opts, fontFamily);
  // 回転（#208）：中心(cx,cy)を軸に rotate でくるむ。未指定/0 は包まない（出力 SVG の差分を最小化）。
  const rot = item.rotation;
  // 要素の不透明度（④・ADR-0019 アニメ）：image/text は要素全体を <g opacity> で敷く。
  // fill は figure 側（freeShapeSvg）が opacity を描くのでここでは包まない（二重適用を避ける）。
  const elemOpacity =
    (item.kind === 'image' || item.kind === 'text') && item.opacity != null && item.opacity < 1
      ? item.opacity
      : undefined;
  const rotated = rot != null && rot !== 0;
  if (!rotated && elemOpacity == null) return inner;
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  const transform = rotated ? ` transform="rotate(${rot} ${cx} ${cy})"` : '';
  const opacityAttr = elemOpacity != null ? ` opacity="${elemOpacity}"` : '';
  return `<g${transform}${opacityAttr}>${inner}</g>`;
}

// 常時クレジット（ADR-0003）。背景に依らず読めるよう半透明の暗いピルを敷き、右下に白文字で最前面へ。
// フォントは固定（既定フォント）＝ユーザーのフォント選択の影響を受けない（権利表示なので演出フォントで崩さない）。
// サイズ/位置は canvas 短辺基準＝viewBox 座標で描くので出力解像度（16:9/9:16）に比例スケールする。
function creditToSvg(width: number, height: number, text: string): string {
  const fontSize = Math.round(Math.min(width, height) * 0.022);
  const margin = Math.round(fontSize * 0.7);
  const padX = Math.round(fontSize * 0.6);
  const padY = Math.round(fontSize * 0.35);
  const textW = [...text].reduce((w, ch) => w + charWidthEm(ch) * fontSize, 0);
  const boxW = Math.round(textW + padX * 2);
  const boxH = Math.round(fontSize + padY * 2);
  const boxX = width - margin - boxW;
  const boxY = height - margin - boxH;
  // テキストのベースライン：ピル内で概ね縦中央に来るよう実機調整した係数（Noto Sans JP のキャップ比相当）。
  const baselineY = boxY + padY + Math.round(fontSize * 0.82);
  return [
    `<g>`,
    `<rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="${Math.round(fontSize * 0.3)}" fill="#000000" fill-opacity="0.45"/>`,
    `<text x="${boxX + padX}" y="${baselineY}" font-family="${DEFAULT_FONT_FAMILY}" font-size="${fontSize}" fill="#ffffff">${escapeXml(text)}</text>`,
    `</g>`,
  ].join('');
}

export function layoutToSvg(layout: SceneLayout, opts: LayoutToSvgOptions = {}): string {
  const fontFamily = opts.fontFamily ?? DEFAULT_FONT_FAMILY;
  const items = opts.itemFilter ? layout.items.filter(opts.itemFilter) : layout.items;
  const body = items.map((item) => itemToSvg(item, opts, fontFamily)).join('\n');
  // transparent 時は背景の全面塗りを出さない（動画が透けて見える上レイヤー用）。
  // responsive: ルート寸法を 100% にしてコンテナへフィットさせる（viewBox で座標系を保持）。
  // 既定は layout 実寸（書き出しのラスタライズは固定px が要るため）。
  const size = opts.responsive
    ? 'width="100%" height="100%"'
    : `width="${layout.width}" height="${layout.height}"`;
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" ${size} viewBox="0 0 ${layout.width} ${layout.height}">`,
  ];
  if (!opts.transparent) {
    lines.push(
      `<rect x="0" y="0" width="${layout.width}" height="${layout.height}" fill="${layout.backgroundColor}"/>`,
    );
  }
  lines.push(body);
  // 常時クレジット（ADR-0003）は最前面＝body の後に置く。
  if (opts.credit) lines.push(creditToSvg(layout.width, layout.height, opts.credit));
  lines.push(`</svg>`);
  return lines.join('\n');
}
