// FREE 場面に置ける「見た目パーツ」＝再利用デザインブロック（ADR-0008・方式A・#175）。
// パーツは複数の FreeElement へ展開し、以後は通常の自由配置要素として移動/リサイズ/複製/削除/前面背面/
// テキスト編集できる（新スキーマ不要。slot/text/shape の既存フィールドのみ使用）。
import { FIT, FONT_WEIGHT, FREE_ELEMENT_KIND, FREE_SHAPE_TYPE } from '../enums';
import { createFreeElementId } from './persistence';
import { REF_CANVAS_W, REF_CANVAS_H } from './freeLayoutOps';
import type { FreeElement } from './types';

/** パーツの要素テンプレ。id は展開時に採番するため持たない。x/y はパーツ内の相対座標。 */
export type FreeComponentElement = Omit<FreeElement, 'id'>;

/** 見た目パーツ（id=内部キー・label=UI 表示・elements=展開する要素テンプレ）。 */
export interface FreeComponent {
  id: string;
  label: string;
  elements: FreeComponentElement[];
}

// 展開時の基準位置（canvas 1920×1080 の見やすい左上寄り）。相対座標 + 基点 + ずらし量で配置する。
const ANCHOR_X = 240;
const ANCHOR_Y = 220;
// 繰り返し追加で完全に重ならないよう、既存要素数に応じて少しずらす（一巡したら戻る）。
const STAGGER_STEP = 24;
const STAGGER_CYCLE = 6;

/** 見た目パーツのカタログ（初期5種・#175）。図形は #173 で追加したものを活用。 */
export const FREE_COMPONENTS: FreeComponent[] = [
  {
    id: 'speech_balloon',
    label: '吹き出し',
    elements: [
      { kind: FREE_ELEMENT_KIND.shape, x: 0, y: 0, w: 480, h: 240, shapeType: FREE_SHAPE_TYPE.speech_bubble, fillColor: '#fff4cc', opacity: 1, strokeColor: '#e0b84c', strokeWidth: 3 },
      { kind: FREE_ELEMENT_KIND.text, x: 40, y: 40, w: 400, h: 110, text: 'ここにセリフ', fontSize: 44, color: '#5a4a1a', fontWeight: FONT_WEIGHT.normal },
    ],
  },
  {
    id: 'number_card',
    label: '数字カード',
    elements: [
      { kind: FREE_ELEMENT_KIND.shape, x: 0, y: 0, w: 340, h: 340, shapeType: FREE_SHAPE_TYPE.rounded_rect, fillColor: '#e8f0ff', opacity: 1, strokeColor: '#4a78d0', strokeWidth: 3 },
      { kind: FREE_ELEMENT_KIND.text, x: 0, y: 50, w: 340, h: 180, text: '1', fontSize: 150, color: '#2a4a90', fontWeight: FONT_WEIGHT.bold },
      { kind: FREE_ELEMENT_KIND.text, x: 0, y: 240, w: 340, h: 70, text: 'ポイント', fontSize: 40, color: '#2a4a90', fontWeight: FONT_WEIGHT.normal },
    ],
  },
  {
    id: 'checklist',
    label: 'チェックリスト',
    elements: [
      { kind: FREE_ELEMENT_KIND.text, x: 0, y: 0, w: 560, h: 72, text: '✓ 項目その1', fontSize: 48, color: '#1a5a2a', fontWeight: FONT_WEIGHT.normal },
      { kind: FREE_ELEMENT_KIND.text, x: 0, y: 92, w: 560, h: 72, text: '✓ 項目その2', fontSize: 48, color: '#1a5a2a', fontWeight: FONT_WEIGHT.normal },
      { kind: FREE_ELEMENT_KIND.text, x: 0, y: 184, w: 560, h: 72, text: '✓ 項目その3', fontSize: 48, color: '#1a5a2a', fontWeight: FONT_WEIGHT.normal },
    ],
  },
  {
    id: 'before_after',
    label: 'ビフォーアフター',
    elements: [
      { kind: FREE_ELEMENT_KIND.text, x: 0, y: 0, w: 360, h: 56, text: 'ビフォー', fontSize: 40, color: '#666666', fontWeight: FONT_WEIGHT.bold },
      { kind: FREE_ELEMENT_KIND.slot, x: 0, y: 64, w: 360, h: 240, assetId: null, fit: FIT.cover },
      { kind: FREE_ELEMENT_KIND.shape, x: 384, y: 150, w: 112, h: 72, shapeType: FREE_SHAPE_TYPE.arrow, fillColor: '#888888', opacity: 1 },
      { kind: FREE_ELEMENT_KIND.text, x: 520, y: 0, w: 360, h: 56, text: 'アフター', fontSize: 40, color: '#666666', fontWeight: FONT_WEIGHT.bold },
      { kind: FREE_ELEMENT_KIND.slot, x: 520, y: 64, w: 360, h: 240, assetId: null, fit: FIT.cover },
    ],
  },
  {
    id: 'url_card',
    label: 'QR・URLカード',
    elements: [
      { kind: FREE_ELEMENT_KIND.shape, x: 0, y: 0, w: 560, h: 240, shapeType: FREE_SHAPE_TYPE.rounded_rect, fillColor: '#ffffff', opacity: 1, strokeColor: '#cccccc', strokeWidth: 2 },
      { kind: FREE_ELEMENT_KIND.slot, x: 24, y: 24, w: 192, h: 192, assetId: null, fit: FIT.contain },
      { kind: FREE_ELEMENT_KIND.text, x: 240, y: 64, w: 296, h: 56, text: 'https://example.com', fontSize: 30, color: '#333333', fontWeight: FONT_WEIGHT.normal },
      { kind: FREE_ELEMENT_KIND.text, x: 240, y: 130, w: 296, h: 50, text: '詳しくはこちら', fontSize: 28, color: '#666666', fontWeight: FONT_WEIGHT.normal },
    ],
  },
];

/**
 * 指定パーツを freeLayout へ一括展開した配列と、追加した要素 id を返す（partId が無ければ変化なし）。
 * 各要素は新 id を採番し、基準位置＋相対座標＋ずらし量で配置、zIndex は既存最前面より上にテンプレ順で積む。
 */
export function addFreeComponentGroup(
  freeLayout: FreeElement[], componentId: string, canvasW: number = REF_CANVAS_W, canvasH: number = REF_CANVAS_H,
): { freeLayout: FreeElement[]; newIds: string[] } {
  const part = FREE_COMPONENTS.find((c) => c.id === componentId);
  if (!part) return { freeLayout, newIds: [] };
  const baseZ = freeLayout.reduce((max, e) => Math.max(max, e.zIndex ?? 0), 0);
  const stagger = (freeLayout.length % STAGGER_CYCLE) * STAGGER_STEP;
  // canvas に合わせる（#281）：パーツ内は等倍（widget の縦横比とレイアウトを保つ＝非等倍だと吹き出し等が歪む）＝canvasW 基準。
  // 基点は縦/横それぞれの比で proportional に置く（縦型でも同じ相対位置）。横型(1920×1080)は係数1＝従来どおり。
  const groupScale = canvasW / REF_CANVAS_W;
  const anchorX = Math.round((ANCHOR_X * canvasW) / REF_CANVAS_W);
  const anchorY = Math.round((ANCHOR_Y * canvasH) / REF_CANVAS_H);
  const next = [...freeLayout];
  const newIds: string[] = [];
  part.elements.forEach((tmpl, i) => {
    const id = createFreeElementId(next.map((e) => e.id));
    next.push({
      ...tmpl,
      id,
      x: Math.round(anchorX + (tmpl.x + stagger) * groupScale),
      y: Math.round(anchorY + (tmpl.y + stagger) * groupScale),
      w: Math.round(tmpl.w * groupScale),
      h: Math.round(tmpl.h * groupScale),
      ...(tmpl.fontSize != null ? { fontSize: Math.round(tmpl.fontSize * groupScale) } : {}),
      zIndex: baseZ + 1 + i,
    });
    newIds.push(id);
  });
  return { freeLayout: next, newIds };
}
