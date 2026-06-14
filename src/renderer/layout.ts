// シーン＋テンプレ → 各レイヤーの配置（矩形・zIndex・内容・スタイル）を解決する純粋ロジック。
// preview / export の双方が共有する（ADR-0001：方式A2ハイブリッド。描画一致の根拠）。
// テキストの実描画（折返し・計測）は描画エンジンに委ねるが、配置はここで決定論的に決める。
import type { Fit, LayerType } from '../domain/enums';
import type { Scene } from '../domain/project/types';
import type { Layer, Template } from '../domain/template/types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ItemBase extends Rect {
  id: string;
  zIndex: number;
}

export interface FillItem extends ItemBase {
  kind: 'fill';
  color: string;
  opacity: number;
  radius: number;
}

export interface ImageItem extends ItemBase {
  kind: 'image';
  assetId: string | null;
  fit: Fit;
  role: 'background' | 'slot' | 'character' | 'logo';
  label: string;
}

export interface TextItem extends ItemBase {
  kind: 'text';
  text: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  color: string;
  maxLines: number;
  background?: { color: string; opacity: number; radius: number };
  /** subtitle レイヤー由来か（書き出しの「字幕を入れる」ON/OFFで判定に使う）。 */
  isSubtitle?: boolean;
}

export type LayoutItem = FillItem | ImageItem | TextItem;

export interface SceneLayout {
  width: number;
  height: number;
  backgroundColor: string;
  /** zIndex 昇順（描画順）。 */
  items: LayoutItem[];
}

// 標準描画順（05 §7）。テンプレに zIndex があればそれを優先。
const DEFAULT_Z: Record<LayerType, number> = {
  background: 0, slot: 10, shape: 20, decor: 20, text: 30, character: 40, subtitle: 50, logo: 60,
};
const DEFAULT_TEXT_COLOR = '#222222';
const DEFAULT_FONT_SIZE = 40;
const DEFAULT_BACKGROUND_COLOR = '#ffffff';

const zOf = (layer: Layer): number => layer.zIndex ?? DEFAULT_Z[layer.type];

/** シーンをテンプレに沿って配置解決する。 */
export function layoutScene(scene: Scene, template: Template): SceneLayout {
  const backgroundColor = template.defaults?.backgroundColor ?? DEFAULT_BACKGROUND_COLOR;
  const items: LayoutItem[] = [];

  for (const layer of template.layers) {
    const base: ItemBase = { id: layer.id, x: layer.x, y: layer.y, w: layer.w, h: layer.h, zIndex: zOf(layer) };

    switch (layer.type) {
      case 'background': {
        const assetId = scene.assetRefs[layer.id] ?? null;
        if (assetId) {
          items.push({ ...base, kind: 'image', assetId, fit: layer.fit ?? 'cover', role: 'background', label: '背景' });
        } else {
          items.push({ ...base, kind: 'fill', color: layer.fillColor ?? backgroundColor, opacity: layer.opacity ?? 1, radius: layer.radius ?? 0 });
        }
        break;
      }
      case 'slot': {
        const assetId = scene.assetRefs[layer.id] ?? null;
        items.push({ ...base, kind: 'image', assetId, fit: layer.fit ?? 'cover', role: 'slot', label: layer.id });
        break;
      }
      case 'logo': {
        const assetId = scene.assetRefs[layer.id] ?? null;
        if (assetId) {
          items.push({ ...base, kind: 'image', assetId, fit: layer.fit ?? 'contain', role: 'logo', label: 'ロゴ' });
        }
        break;
      }
      case 'character': {
        if (scene.character.enabled && scene.character.poseAssetId) {
          items.push({ ...base, kind: 'image', assetId: scene.character.poseAssetId, fit: layer.fit ?? 'contain', role: 'character', label: 'ゆうこ' });
        }
        break;
      }
      case 'shape':
      case 'decor': {
        items.push({ ...base, kind: 'fill', color: layer.fillColor ?? '#ffffff', opacity: layer.opacity ?? 1, radius: layer.radius ?? 0 });
        break;
      }
      case 'text':
      case 'subtitle': {
        const text = layer.textKey ? scene.texts[layer.textKey] ?? '' : '';
        if (text.length === 0) break;
        const bg = layer.type === 'subtitle' && layer.background?.enabled
          ? {
              color: layer.background.color ?? '#000000',
              opacity: layer.background.opacity ?? 0.55,
              radius: layer.background.radius ?? 16,
            }
          : undefined;
        items.push({
          ...base,
          kind: 'text',
          text,
          fontSize: layer.fontSize ?? DEFAULT_FONT_SIZE,
          fontWeight: layer.fontWeight ?? 'normal',
          color: layer.color ?? DEFAULT_TEXT_COLOR,
          maxLines: layer.maxLines ?? 2,
          background: bg,
          isSubtitle: layer.type === 'subtitle',
        });
        break;
      }
    }
  }

  items.sort((a, b) => a.zIndex - b.zIndex);
  return { width: template.canvas.width, height: template.canvas.height, backgroundColor, items };
}
