// SceneLayout → SVG文字列。SVGを「描画の中間表現」とし、プレビュー（WebViewでそのまま表示）と
// 出力（同じSVGをラスタライズしてPNG化）で同一にすることでパリティを保証する（ADR-0001）。
// 注: テキスト折返しは暫定で文字幅概算（半角≈0.55em・全角≈1em）。フォント実測への置換は将来（05 §10 / ADR-0001 未解決論点）。
import { CROP_ALIGN_X, CROP_ALIGN_Y, FIT, TEXT_ALIGN, type CropAlignX, type CropAlignY, type Fit } from '../domain/enums';
import { fontFamilyForId, isKnownFontId } from '../domain/font/fontCatalog';
import type { ImageItem, LayoutItem, SceneLayout, TextItem } from './layout';
import { DEFAULT_LINE_HEIGHT } from './layout';
import { freeShapeSvg } from './freeShapes';
import { charWidthEm, wrapText } from '../domain/text/textWrap';

// 折返し（charWidthEm/wrapText）は layout（帯の段位置計算）と共有＝行数と描画を一致させる（textWrap）。
// 既存の import 元（'./sceneSvg'）を保つため再エクスポートする。
export { charWidthEm, wrapText } from '../domain/text/textWrap';

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

/** 同じ `<defs>` の行を1つに畳む（#264・影の filter は中身から id を作るので重複しうる）。 */
function dedupeDefs(svg: string): string {
  const seen = new Set<string>();
  return svg
    .split('\n')
    .filter((line) => {
      if (!line.startsWith('<defs>')) return true;
      if (seen.has(line)) return false;
      seen.add(line);
      return true;
    })
    .join('\n');
}

function textToSvg(item: TextItem, fontFamily: string): string {
  const parts: string[] = [];
  // 要素自身の fontId（既知）を優先し、未指定/不明は場面既定（fontFamily＝場面→動画全体→既定の解決済み）へ（#178）。
  const family = isKnownFontId(item.fontId) ? fontFamilyForId(item.fontId) : fontFamily;
  const lines = wrapText(item.text, item.w, item.fontSize, item.maxLines);
  const lineHeight = item.fontSize * (item.lineHeight ?? DEFAULT_LINE_HEIGHT); // 行間（#209）
  // 下端基準（テンプレ字幕・ADR-0031）：行が増えたぶんを上へずらし、最終行は1行時の位置に留める＝画面下端に
  // 置いた字幕帯が2行で画面外へはみ出さない。anchorBottom でないもの（見出し・FREE text）は 0＝従来どおり上端起点。
  const shiftUp = item.anchorBottom ? Math.max(0, lines.length - 1) * lineHeight : 0;

  if (item.background) {
    const bgHeight = lineHeight * lines.length + item.fontSize * 0.6;
    parts.push(
      `<rect x="${item.x}" y="${item.y - shiftUp}" width="${item.w}" height="${bgHeight}" rx="${item.background.radius}" fill="${item.background.color}" fill-opacity="${item.background.opacity}"/>`,
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

  // 字間（#264）＝**em で持つ**ので px へ直す（文字サイズを変えても詰め具合が変わらない）。
  // ⚠️ 0 のときは属性を出さない＝**従来の出力は1バイトも変わらない**（golden が動かない）。
  const spacingPx = (item.letterSpacing ?? 0) * item.fontSize;
  const spacing = spacingPx !== 0 ? ` letter-spacing="${spacingPx}"` : '';

  // 影（#264）。⚠️ **プレビューと書き出しは同じ Blink で描く**（`rasterize.ts`）ので、
  // `feDropShadow` はどちらでも同じ絵になる（パリティは構造で保たれる）。
  //
  // ⚠️ **id は「影の中身」から作る**（要素の id ではない・PR #879 レビューで気づいた）＝
  // ① 中身が違えば id も違うので、**同じ id の filter が混ざって全部が最後の影になる**ことが無い。
  // ② **要素の id が変わっても絵が変わらない**＝「バラす」（ADR-0032 決定23）は要素に新しい id を
  //    振るので、要素 id から作ると**中身が同じなのに SVG が変わり**、前後一致の検査が落ちる。
  // ③ 同じ影を使う要素は**同じ filter を共有**する（重複する `<defs>` は `layoutToSvg` が畳む）。
  let shadowAttr = '';
  if (item.shadow) {
    const dx = item.shadow.dx ?? 0;
    const dy = item.shadow.dy ?? 0;
    const sd = (item.shadow.blur ?? 0) / 2;
    const color = item.shadow.color ?? '#000000';
    const opacity = item.shadow.opacity ?? 0.5;
    const filterId = `shadow-${[dx, dy, sd, color.replace('#', ''), opacity].join('_').replace(/[^A-Za-z0-9_-]/g, '_')}`;
    parts.push(
      `<defs><filter id="${filterId}" x="-50%" y="-50%" width="200%" height="200%">`
      + `<feDropShadow dx="${dx}" dy="${dy}" stdDeviation="${sd}"`
      + ` flood-color="${color}" flood-opacity="${opacity}"/>`
      + `</filter></defs>`,
    );
    shadowAttr = ` filter="url(#${filterId})"`;
  }

  const baseY = item.y + item.fontSize - shiftUp;
  lines.forEach((line, i) => {
    parts.push(
      `<text x="${textX}" y="${baseY + i * lineHeight}" font-family="${family}" font-size="${item.fontSize}" font-weight="${item.fontWeight}" fill="${item.color}" text-anchor="${anchor}"${stroke}${spacing}${shadowAttr}>${escapeXml(line)}</text>`,
    );
  });
  return parts.join('\n');
}

/** SVG生成オプション。assetSrc は assetId→表示用src(data URL)。未解決ならプレースホルダ枠。 */
export interface LayoutToSvgOptions {
  assetSrc?: (assetId: string | null) => string | undefined;
  /**
   * **その部品だけの絵**（#512 段1）。返せば `assetSrc` より優先する。
   *
   * ⚠️ 動画は**フレームごとに絵が変わる**ので、素材 id を鍵にする `assetSrc` では足りない
   * （同じ動画を別の時刻に2つ置くと、両方が同じコマになる）。部品ごとに解く口をここに持つ。
   */
  itemSrc?: (item: LayoutItem) => string | undefined;
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

/**
 * fit と**寄せ**を `<image>` の `preserveAspectRatio` へ（cover=slice / contain=meet / stretch=none）。
 *
 * 寄せ（#634・`05 §8`）＝`cover` で枠に収まらない側を**どこで切るか**。SVG の `preserveAspectRatio` の
 * 前半（`xMinYMin` 等）がそのまま「寄せ」なので、値を差し替えるだけで表せる（未指定＝中央＝従来どおり）。
 * `stretch` は伸縮するので寄せの意味が無い（`none` のまま）。
 */
function fitToPreserveAspectRatio(fit: Fit, align?: { x?: CropAlignX; y?: CropAlignY }): string {
  if (fit === FIT.stretch) return 'none';
  const x = align?.x === CROP_ALIGN_X.left ? 'xMin' : align?.x === CROP_ALIGN_X.right ? 'xMax' : 'xMid';
  const y = align?.y === CROP_ALIGN_Y.top ? 'YMin' : align?.y === CROP_ALIGN_Y.bottom ? 'YMax' : 'YMid';
  return `${x}${y} ${fit === FIT.contain ? 'meet' : 'slice'}`;
}

function imageToSvg(item: ImageItem, src: string | undefined, fontFamily: string): string {
  if (item.assetId && src) {
    // <image> は x/y/width/height の矩形にクリップされ、preserveAspectRatio で fit を表現する。
    // プレビューと出力で同一SVGを共有する（ADR-0004：WebView Canvas でラスタライズ）。
    return `<image x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" href="${escapeXml(src)}" preserveAspectRatio="${fitToPreserveAspectRatio(item.fit, item.align)}"/>`;
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
      return imageToSvg(
        item,
        opts.itemSrc?.(item) ?? (item.assetId ? opts.assetSrc?.(item.assetId) : undefined),
        fontFamily,
      );
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

/**
 * **合成の単位**（`compositeKey`）ごとに `<g opacity>` で包む（ADR-0032 決定19・#631）。
 *
 * 連続する同じキーのアイテムを1つの `<g>` にまとめる＝**1枚に合成してから不透明度を掛ける**ので、
 * 層が重なる所で下が透けない（アイテムごとに α を掛けると透ける）。キーを持たないアイテム
 * （場面形式はすべてこちら）は素通し＝出力は従来と1バイトも変わらない。
 * **連続でまとめる**のは、`items` が既に描画順（重ね順）に並んでいるため＝並びを崩さない。
 */
/**
 * 切り抜き（`clipRect`）で1かたまりを包む（#634）。矩形の外は描かない。
 * `<clipPath>` の id はアイテム側が持つ（クリップ id 由来＝同じ矩形を何度も定義しない）。
 */
function wrapClipRect(inner: string, rect: NonNullable<LayoutItem['clipRect']>): string {
  const id = `crop_${rect.id}`;
  // 箱が回っているときは**矩形も同じだけ回す**＝箱の辺に沿って切れる（回転で外へ出た角を一律に落とさない）。
  const rot = rect.rotation ?? 0;
  const spin = rot === 0 ? '' : ` transform="rotate(${rot} ${rect.x + rect.w / 2} ${rect.y + rect.h / 2})"`;
  return [
    `<g clip-path="url(#${id})">`,
    `<defs><clipPath id="${id}"><rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}"${spin}/></clipPath></defs>`,
    inner,
    `</g>`,
  ].join('\n');
}

/**
 * 連続したアイテムを**切り抜きごとに小分けして**包む（#634）。切り抜きはクリップごとに違うので、
 * 同じ矩形が続く区間だけを `<g clip-path>` で包む＝隣のクリップへ効かせない・持っているのに落とさない。
 */
function clippedRuns(items: readonly LayoutItem[], opts: LayoutToSvgOptions, fontFamily: string): string {
  const out: string[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const rect = items[i].clipRect;
    let j = i;
    while (j + 1 < items.length && sameClipRect(items[j + 1].clipRect, rect)) j += 1;
    const inner = items.slice(i, j + 1).map((it) => itemToSvg(it, opts, fontFamily)).join('\n');
    out.push(rect ? wrapClipRect(inner, rect) : inner);
    i = j;
  }
  return out.join('\n');
}

/** 2つの切り抜き矩形が同じか（`undefined` 同士も同じ）。 */
function sameClipRect(a: LayoutItem['clipRect'], b: LayoutItem['clipRect']): boolean {
  if (a == null || b == null) return a == null && b == null;
  return a.id === b.id && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && (a.rotation ?? 0) === (b.rotation ?? 0);
}

function itemsToSvg(items: readonly LayoutItem[], opts: LayoutToSvgOptions, fontFamily: string): string {
  const out: string[] = [];
  const closed = new Set<string>();
  for (let i = 0; i < items.length; i += 1) {
    const composite = items[i].composite;
    if (composite == null) {
      // 合成の単位が無い区間（クリップ全体の濃さが 1）。切り抜きごとの小分けは `clippedRuns` に任せる。
      let j = i;
      while (j + 1 < items.length && items[j + 1].composite == null) j += 1;
      out.push(clippedRuns(items.slice(i, j + 1), opts, fontFamily));
      i = j;
      continue;
    }
    // **同じ単位は連続している前提**（作る側が1かたまりで並べる）。離れて再び現れたら合成が静かに
    // 割れて別の絵になるので、開発時に気づけるようにする（本番は包み直して描画自体は続ける）。
    if (closed.has(composite.key) && import.meta.env?.DEV) {
      console.warn('[sceneSvg] 合成の単位が連続していません（絵が変わります）:', composite.key);
    }
    closed.add(composite.key);
    let j = i;
    while (j + 1 < items.length && items[j + 1].composite?.key === composite.key) j += 1;
    // 合成の単位は**複数のクリップに跨る**ことがある（グループのフェード）。切り抜きはクリップごとなので、
    // かたまりの**中**で切り抜きごとに小分けして包む＝ほかのクリップへ効かせない・黙って落とさない。
    // 矩形で切るので「切ってから薄める／薄めてから切る」は同じ絵になる（`11 §7.6.4.1`）。
    const inner = clippedRuns(items.slice(i, j + 1), opts, fontFamily);
    // 不透明（1 以上）なら `<g>` で包む意味が無い＝余計な要素を出さない。
    out.push(composite.opacity >= 1 ? inner : `<g opacity="${composite.opacity}">\n${inner}\n</g>`);
    i = j;
  }
  return out.join('\n');
}

export function layoutToSvg(layout: SceneLayout, opts: LayoutToSvgOptions = {}): string {
  const fontFamily = opts.fontFamily ?? DEFAULT_FONT_FAMILY;
  const items = opts.itemFilter ? layout.items.filter(opts.itemFilter) : layout.items;
  // ⚠️ **同じ影の `<defs>` は1つに畳む**（#264）＝影の filter の id は**中身から**作るので、
  // 同じ影を使う要素が複数あると同じ定義が並ぶ（同じ id が重複するのは行儀が悪い）。
  // 中身が同じなので**どれを残しても絵は変わらない**＝先に出たものを残す。
  const body = dedupeDefs(itemsToSvg(items, opts, fontFamily));
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
